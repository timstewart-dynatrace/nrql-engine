/**
 * SLO Transformer - Converts New Relic SLOs to Dynatrace format.
 *
 * New Relic SLO concepts:
 * - SLI (Service Level Indicator): Defined by good/valid events queries
 * - SLO: Target percentage over a time window
 * - Time Window: Rolling period (days, weeks, months)
 *
 * Dynatrace SLO concepts:
 * - SLO: Combined indicator and objective
 * - Metric Expression: Defines the success rate calculation
 * - Evaluation Type: Rolling or calendar-based
 */

import { SLO_TIME_UNIT_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

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
  readonly validEvents?: { where?: string };
  readonly goodEvents?: { where?: string };
  readonly badEvents?: { where?: string };
}

export interface DTSlo {
  name: string;
  description: string;
  metricName: string;
  metricExpression: string;
  evaluationType: string;
  filter: string;
  target: number;
  warning: number;
  timeframe: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// SLOTransformer
// ---------------------------------------------------------------------------

export class SLOTransformer {
  transform(nrSlo: NRSloInput): TransformResult<DTSlo> {
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

      const dtSlo = this.buildDynatraceSlo(
        sloName,
        description,
        target,
        windowCount,
        windowUnit,
        events,
        warnings,
      );

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
      let timeframe = '-7d';
      if (input.timeWindow?.rolling) {
        const unit = SLO_TIME_UNIT_MAP[input.timeWindow.rolling.unit] ?? 'DAY';
        timeframe = this.buildTimeframe(input.timeWindow.rolling.count, unit);
      } else if (input.timeWindow?.calendarAligned) {
        const calUnit = input.timeWindow.calendarAligned.unit.toUpperCase();
        // DT calendar-aligned evaluation uses the `@<unit>` snap suffix.
        const snap: Record<string, string> = { DAY: '-1d@d', WEEK: '-1w@w', MONTH: '-1M@M' };
        timeframe = snap[calUnit] ?? '-30d';
        warnings.push(
          `Calendar-aligned time window '${input.timeWindow.calendarAligned.unit}' mapped to DQL snap expression '${timeframe}'. Verify month-boundary semantics match NR's v3 calendar alignment.`,
        );
      }

      // SLI heuristic: reuse v1 event-type detection by routing the nrql
      // through detectSloType against the nrql+badEventsNrql pair.
      const validQuery = input.sli.nrql;
      const goodQuery = input.sli.badEventsNrql
        ? `NOT (${input.sli.badEventsNrql})`
        : input.sli.nrql;
      const metricExpression = this.buildMetricExpression(
        { validEvents: { where: validQuery }, goodEvents: { where: goodQuery } },
        warnings,
      );

      warnings.push(
        'Service Levels v3 is a newer NR API shape — the engine maps it to the same DT SLO schema as v1/v2. Validate the emitted metricExpression against your Grail data model before enabling.',
      );

      const dtSlo: DTSlo = {
        name: `[Migrated SLv3] ${name}`,
        description: description || 'Migrated from New Relic Service Levels v3',
        metricName: this.sanitizeMetricName(name),
        metricExpression,
        evaluationType: 'AGGREGATE',
        filter: input.entityGuid ? `entityId("${input.entityGuid}")` : '',
        target,
        warning: Math.min(target + 0.4, 99.9),
        timeframe,
        enabled: true,
      };

      return success(dtSlo, warnings);
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

  private buildDynatraceSlo(
    name: string,
    description: string,
    target: number,
    windowCount: number,
    windowUnit: string,
    events: NRSloEvents,
    warnings: string[],
  ): DTSlo {
    const dtTimeUnit = SLO_TIME_UNIT_MAP[windowUnit] ?? 'DAY';
    const timeframe = this.buildTimeframe(windowCount, dtTimeUnit);
    const metricExpression = this.buildMetricExpression(events, warnings);

    return {
      name: `[Migrated] ${name}`,
      description: description || 'Migrated from New Relic',
      metricName: this.sanitizeMetricName(name),
      metricExpression,
      evaluationType: 'AGGREGATE',
      filter: '',
      target,
      warning: target - 1.0,
      timeframe,
      enabled: true,
    };
  }

  private buildTimeframe(count: number, unit: string): string {
    const unitMap: Record<string, string> = {
      DAY: 'd',
      WEEK: 'w',
      MONTH: 'M',
    };
    const suffix = unitMap[unit] ?? 'd';
    return `-${count}${suffix}`;
  }

  private buildMetricExpression(events: NRSloEvents, warnings: string[]): string {
    const validEvents = events.validEvents ?? {};
    const goodEvents = events.goodEvents ?? {};

    const validQuery = validEvents.where ?? '';
    const goodQuery = goodEvents.where ?? '';

    const sloType = this.detectSloType(validQuery, goodQuery);

    if (sloType === 'availability') {
      warnings.push(
        'SLO appears to be availability-based. Using builtin service availability metric.',
      );
      return '(100)*(builtin:service.availability:filter(and(in("dt.entity.service",entitySelector("type(service)")))))';
    }

    if (sloType === 'error_rate') {
      warnings.push(
        'SLO appears to be error-rate based. Using builtin service error rate metric.',
      );
      return '(100)*(builtin:service.errors.total.successRate:filter(and(in("dt.entity.service",entitySelector("type(service)")))))';
    }

    if (sloType === 'latency') {
      warnings.push(
        'SLO appears to be latency-based. Manual configuration recommended for specific thresholds.',
      );
      return (
        '(100)*((builtin:service.response.time:avg:partition("latency",value("good",lt(1000000))):' +
        'filter(and(in("dt.entity.service",entitySelector("type(service)"))))):splitBy():count:default(0))/' +
        '(builtin:service.requestCount.total:filter(and(in("dt.entity.service",entitySelector("type(service)"))))):splitBy():sum)'
      );
    }

    // Unknown type
    warnings.push(
      `Could not automatically determine SLO metric type. ` +
        `Original queries - Valid: ${validQuery.slice(0, 50)}..., Good: ${goodQuery.slice(0, 50)}... ` +
        'Manual configuration required.',
    );
    return '(100)*(builtin:service.availability)';
  }

  private detectSloType(validQuery: string, goodQuery: string): string {
    const queries = `${validQuery} ${goodQuery}`.toLowerCase();

    if (queries.includes('error')) return 'error_rate';
    if (queries.includes('duration') || queries.includes('latency') || queries.includes('response'))
      return 'latency';
    if (queries.includes('status') || queries.includes('available')) return 'availability';
    return 'unknown';
  }

  private sanitizeMetricName(name: string): string {
    let sanitized = name.toLowerCase();
    sanitized = sanitized.replace(/ /g, '_');
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '');
    return `slo.migrated.${sanitized}`;
  }
}
