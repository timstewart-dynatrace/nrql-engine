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
