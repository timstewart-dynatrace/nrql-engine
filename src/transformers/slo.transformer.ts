/**
 * SLO Transformer — Converts New Relic SLOs to Dynatrace Platform SLOs.
 *
 * Emits `POST /platform/slo/v1/slos` bodies with a DQL `customSli.indicator`
 * grouped by `dt.smartscape.service`. Classic `builtin:monitoring.slo`
 * metric-selector SLOs are no longer emitted. Mirrors Python
 * `transformers/slo_transformer.py`.
 *
 * New Relic SLO concepts:
 * - SLI (Service Level Indicator): Defined by good/valid events queries
 * - SLO: Target percentage over a time window
 * - Time Window: Rolling period (days, weeks, months)
 */

import { SLO_TIME_UNIT_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import {
  DEFAULT_LATENCY_THRESHOLD_MS,
  availabilityIndicator,
  buildPlatformSlo,
  extractLatencyThresholdMs,
  extractServiceName,
  latencyIndicator,
  type DTPlatformSlo,
  type ServiceScope,
} from './slo-utils.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRSloInput {
  readonly name?: string;
  readonly description?: string;
  readonly objectives?: NRSloObjective[];
  readonly events?: NRSloEvents;
}

/**
 * Service Levels v3 API input shape. Distinct from the classic SLO
 * events-based shape — v3 expresses SLIs as a single NRQL query and
 * an optional bad-events query rather than good+valid pair. Rolling
 * time window is a count plus unit; calendar windows carry a
 * `calendarAligned` flag.
 */
export interface NRServiceLevelV3Input {
  readonly name?: string;
  readonly description?: string;
  readonly sli: {
    readonly nrql: string;
    readonly badEventsNrql?: string;
  };
  readonly target?: number;
  readonly timeWindow?: {
    readonly rolling?: { readonly count: number; readonly unit: string };
    readonly calendarAligned?: { readonly unit: string };
  };
  readonly entityGuid?: string;
}

export interface NRSloObjective {
  readonly target?: number;
  readonly timeWindow?: {
    rolling?: { count?: number; unit?: string };
  };
}

export interface NRSloEvents {
  readonly validEvents?: { from?: string; where?: string };
  readonly goodEvents?: { from?: string; where?: string };
  readonly badEvents?: { from?: string; where?: string };
}

/** Gen3 Platform SLO request body (was classic builtin:monitoring.slo). */
export type DTSlo = DTPlatformSlo;

// ---------------------------------------------------------------------------
// SLOTransformer
// ---------------------------------------------------------------------------

export class SLOTransformer {
  transform(nrSlo: NRSloInput & { guid?: string; id?: string }): TransformResult<DTSlo> {
    const warnings: string[] = [];

    try {
      const sloName = nrSlo.name ?? 'Unnamed SLO';
      const description = nrSlo.description ?? '';

      const objectives = nrSlo.objectives ?? [];
      if (objectives.length === 0) {
        return failure([`SLO '${sloName}' has no objectives defined`]);
      }

      // Safe: we checked objectives.length > 0 above
      const objective = objectives[0] as NRSloObjective;
      const target = objective.target ?? 99.0;

      const timeWindow = objective.timeWindow ?? {};
      const rolling = timeWindow.rolling ?? {};
      const windowCount = rolling.count ?? 7;
      const windowUnit = rolling.unit ?? 'DAY';

      const events = nrSlo.events ?? {};
      const guid = nrSlo.guid ?? nrSlo.id;

      const original = this.originalNrql(events);
      const dtSlo = buildPlatformSlo({
        name: `[Migrated] ${sloName}`,
        description:
          (description || 'Migrated from New Relic') +
          (original ? `\n\n--- Original NR SLI ---\n${original}` : ''),
        target,
        indicator: this.buildIndicator(events, warnings),
        timeframeFrom: this.buildTimeframe(
          windowCount,
          SLO_TIME_UNIT_MAP[windowUnit] ?? 'DAY',
          warnings,
        ),
        tags: ['MigratedFromNR:true'],
        ...(guid ? { externalId: `nr-slo-${guid}` } : {}),
      });

      return success(dtSlo, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(slos: NRSloInput[]): TransformResult<DTSlo>[] {
    return slos.map((s) => this.transform(s));
  }

  // ─── Service Levels v3 ─────────────────────────────────────────────────

  transformV3(input: NRServiceLevelV3Input): TransformResult<DTSlo> {
    try {
      const name = input.name?.trim();
      if (!name) return failure(['Service Level v3 name is required']);
      if (!input.sli?.nrql) {
        return failure([`Service Level '${name}' has no sli.nrql query`]);
      }

      const warnings: string[] = [];
      const description = input.description ?? '';
      const target = input.target ?? 99.0;

      // Time window: rolling (count+unit) or calendar-aligned.
      let timeframeFrom = 'now-7d';
      if (input.timeWindow?.rolling) {
        const unit = SLO_TIME_UNIT_MAP[input.timeWindow.rolling.unit] ?? 'DAY';
        timeframeFrom = this.buildTimeframe(input.timeWindow.rolling.count, unit, warnings);
      } else if (input.timeWindow?.calendarAligned) {
        const calUnit = input.timeWindow.calendarAligned.unit.toUpperCase();
        const snap: Record<string, string> = {
          DAY: 'now-1d@d',
          WEEK: 'now-1w@w',
          MONTH: 'now-1M@M',
        };
        timeframeFrom = snap[calUnit] ?? 'now-30d';
        warnings.push(
          `Calendar-aligned time window '${input.timeWindow.calendarAligned.unit}' mapped to timeframe '${timeframeFrom}'. Verify month-boundary semantics match NR's v3 calendar alignment.`,
        );
      }

      // SLI heuristic: reuse v1 event-type detection on the nrql + badEventsNrql pair.
      const validQuery = input.sli.nrql;
      const goodQuery = input.sli.badEventsNrql
        ? `NOT (${input.sli.badEventsNrql})`
        : input.sli.nrql;

      const scope: ServiceScope = {};
      if (input.entityGuid && /^SERVICE-[0-9A-F]+$/.test(input.entityGuid)) {
        Object.assign(scope, { serviceId: input.entityGuid });
      } else if (input.entityGuid) {
        warnings.push(
          `entityGuid '${input.entityGuid}' is not a Dynatrace SERVICE id; scope the indicator manually (e.g. dt.smartscape.service == toSmartscapeId("SERVICE-…")).`,
        );
      }

      const indicator = this.buildIndicator(
        { validEvents: { where: validQuery }, goodEvents: { where: goodQuery } },
        warnings,
        scope,
      );

      warnings.push(
        'Service Levels v3 is a newer NR API shape — the engine maps it to the same Platform SLO as v1/v2. Validate the emitted DQL indicator against your Grail data before enabling.',
      );

      return success(
        buildPlatformSlo({
          name: `[Migrated SLv3] ${name}`,
          description: description || 'Migrated from New Relic Service Levels v3',
          target,
          indicator,
          timeframeFrom,
          tags: ['MigratedFromNR:true'],
        }),
        warnings,
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAllV3(inputs: NRServiceLevelV3Input[]): TransformResult<DTSlo>[] {
    return inputs.map((i) => this.transformV3(i));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildTimeframe(count: number, unit: string, warnings: string[] = []): string {
    if (unit === 'WEEK') return `now-${count}w`;
    if (unit === 'MONTH') {
      warnings.push(`NR SLO window of ${count} month(s) approximated as ${count * 30} days.`);
      return `now-${count * 30}d`;
    }
    return `now-${count}d`;
  }

  private buildIndicator(
    events: NRSloEvents,
    warnings: string[],
    scope: ServiceScope = {},
  ): string {
    const validQuery = events.validEvents?.where ?? '';
    const goodQuery = events.goodEvents?.where ?? '';
    const badQuery = events.badEvents?.where ?? '';

    const serviceName = extractServiceName([validQuery, goodQuery, badQuery].join(' '));
    const effective: ServiceScope = { ...scope, ...(serviceName ? { serviceName } : {}) };
    if (!effective.serviceName && !effective.serviceId) {
      warnings.push(
        'Could not determine the service from the NR SLI; the indicator covers all services. Add a filter (e.g. contains(entityName, "<service>")).',
      );
    }

    const sloType = this.detectSloType(validQuery, goodQuery);

    if (sloType === 'availability' || sloType === 'error_rate') {
      warnings.push(
        `SLO appears to be ${sloType.replace('_', '-')} based. Using service success-rate SLI (dt.service.request.count / failure_count).`,
      );
      return availabilityIndicator(effective);
    }

    if (sloType === 'latency') {
      let thresholdMs = extractLatencyThresholdMs(goodQuery);
      if (thresholdMs === undefined) {
        thresholdMs = DEFAULT_LATENCY_THRESHOLD_MS;
        warnings.push(
          `SLO appears to be latency-based but no duration threshold was found; defaulted to ${thresholdMs}ms.`,
        );
      } else {
        warnings.push(
          `SLO appears to be latency-based. Using ${thresholdMs}ms response-time threshold.`,
        );
      }
      return latencyIndicator(thresholdMs, effective);
    }

    warnings.push(
      `Could not automatically determine SLO type. ` +
        `Original queries - Valid: ${validQuery.slice(0, 50)}..., Good: ${goodQuery.slice(0, 50)}... ` +
        'Defaulted to service success-rate SLI; manual review required.',
    );
    return availabilityIndicator(effective);
  }

  private originalNrql(events: NRSloEvents): string {
    const lines: string[] = [];
    for (const [key, label] of [
      ['validEvents', 'Valid'],
      ['goodEvents', 'Good'],
      ['badEvents', 'Bad'],
    ] as const) {
      const ev = events[key];
      if (ev?.from || ev?.where) {
        lines.push(`${label}: FROM ${ev.from ?? '?'} WHERE ${ev.where || 'N/A'}`);
      }
    }
    return lines.join('\n');
  }

  private detectSloType(validQuery: string, goodQuery: string): string {
    const queries = `${validQuery} ${goodQuery}`.toLowerCase();

    if (queries.includes('error')) return 'error_rate';
    if (queries.includes('duration') || queries.includes('latency') || queries.includes('response'))
      return 'latency';
    if (queries.includes('status') || queries.includes('available')) return 'availability';
    return 'unknown';
  }
}
