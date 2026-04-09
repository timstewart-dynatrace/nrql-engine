/**
 * Alert Transformer - Converts New Relic alert policies to Dynatrace format.
 *
 * Mapping:
 * - New Relic Alert Policy -> Dynatrace Alerting Profile
 * - New Relic NRQL Condition -> Dynatrace Metric Event (Custom Alert)
 * - New Relic APM Condition -> Dynatrace Auto-Adaptive Baseline Alert
 */

import { OPERATOR_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRAlertPolicyInput {
  readonly name?: string;
  readonly id?: string;
  readonly incidentPreference?: string;
  readonly conditions?: NRAlertCondition[];
}

export interface NRAlertCondition {
  readonly name?: string;
  readonly conditionType?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly nrql?: { query?: string };
  readonly signal?: {
    aggregationWindow?: number;
    aggregationMethod?: string;
  };
  readonly terms?: NRAlertTerm[];
  readonly runbookUrl?: string;
}

export interface NRAlertTerm {
  readonly priority?: string;
  readonly operator?: string;
  readonly threshold?: number;
  readonly thresholdDuration?: number;
  readonly thresholdOccurrences?: string;
}

export interface AlertTransformData {
  alertingProfile: Record<string, unknown>;
  metricEvents: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// AlertTransformer
// ---------------------------------------------------------------------------

export class AlertTransformer {
  transform(nrPolicy: NRAlertPolicyInput): TransformResult<AlertTransformData> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      const policyName = nrPolicy.name ?? 'Unnamed Policy';

      const alertingProfile = this.createAlertingProfile(nrPolicy);

      const conditions = nrPolicy.conditions ?? [];
      const metricEvents: Record<string, unknown>[] = [];

      for (const condition of conditions) {
        const eventResult = this.transformCondition(condition, policyName);

        if (eventResult.metricEvent) {
          metricEvents.push(eventResult.metricEvent);
        }
        warnings.push(...eventResult.warnings);
        errors.push(...eventResult.errors);
      }

      return {
        success: true,
        data: { alertingProfile, metricEvents },
        warnings,
        errors,
      };
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(policies: NRAlertPolicyInput[]): TransformResult<AlertTransformData>[] {
    return policies.map((p) => this.transform(p));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private createAlertingProfile(nrPolicy: NRAlertPolicyInput): Record<string, unknown> {
    const policyName = nrPolicy.name ?? 'Unnamed Policy';

    return {
      name: `[Migrated] ${policyName}`,
      managementZone: null,
      severityRules: [
        {
          severityLevel: 'AVAILABILITY',
          tagFilter: { includeMode: 'NONE' },
          delayInMinutes: 0,
        },
        {
          severityLevel: 'ERROR',
          tagFilter: { includeMode: 'NONE' },
          delayInMinutes: 0,
        },
        {
          severityLevel: 'PERFORMANCE',
          tagFilter: { includeMode: 'NONE' },
          delayInMinutes: 0,
        },
        {
          severityLevel: 'RESOURCE_CONTENTION',
          tagFilter: { includeMode: 'NONE' },
          delayInMinutes: 0,
        },
        {
          severityLevel: 'CUSTOM_ALERT',
          tagFilter: { includeMode: 'NONE' },
          delayInMinutes: 0,
        },
      ],
      eventTypeFilters: [],
    };
  }

  private transformCondition(
    condition: NRAlertCondition,
    _policyName: string,
  ): { metricEvent: Record<string, unknown> | undefined; warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];
    let metricEvent: Record<string, unknown> | undefined;

    const conditionType = condition.conditionType ?? 'NRQL';
    const conditionName = condition.name ?? 'Unnamed Condition';

    if (conditionType === 'NRQL') {
      metricEvent = this.transformNrqlCondition(condition, warnings);
    } else {
      warnings.push(
        `Condition type '${conditionType}' for '${conditionName}' ` +
          'may require manual configuration',
      );
      metricEvent = this.createPlaceholderEvent(condition);
    }

    return { metricEvent, warnings, errors };
  }

  private transformNrqlCondition(
    condition: NRAlertCondition,
    warnings: string[],
  ): Record<string, unknown> {
    const conditionName = condition.name ?? 'Unnamed Condition';
    const description = condition.description ?? '';
    const enabled = condition.enabled ?? true;

    const nrql = condition.nrql ?? {};
    const query = nrql.query ?? '';

    const signal = condition.signal ?? {};
    const aggregationWindow = signal.aggregationWindow ?? 60;

    const terms = condition.terms ?? [];

    const metricEvent: Record<string, unknown> = {
      summary: `[Migrated] ${conditionName}`,
      description: description || `Migrated from New Relic. Original NRQL: ${query.slice(0, 200)}`,
      enabled,
      alertingScope: [
        {
          filterType: 'ENTITY_ID',
          entityId: null,
        },
      ],
      monitoringStrategy: this.buildMonitoringStrategy(terms, aggregationWindow, query, warnings),
      primaryDimensionKey: null,
      queryDefinition: this.buildQueryDefinition(query, warnings),
    };

    const runbookUrl = condition.runbookUrl;
    if (runbookUrl) {
      metricEvent['description'] =
        `${metricEvent['description'] as string}\n\nRunbook: ${runbookUrl}`;
    }

    return metricEvent;
  }

  private buildMonitoringStrategy(
    terms: readonly NRAlertTerm[],
    _aggregationWindow: number,
    _query: string,
    _warnings: string[],
  ): Record<string, unknown> {
    const strategy: Record<string, unknown> = {
      type: 'STATIC_THRESHOLD',
      alertCondition: 'ABOVE',
      alertingOnMissingData: false,
      dealingWithGapsStrategy: 'DROP_DATA',
      samples: 3,
      violatingSamples: 3,
      threshold: 0,
      unit: 'UNSPECIFIED',
    };

    if (terms.length > 0) {
      let criticalTerm: NRAlertTerm | undefined;
      let warningTerm: NRAlertTerm | undefined;

      for (const term of terms) {
        const priority = (term.priority ?? 'critical').toLowerCase();
        if (priority === 'critical') {
          criticalTerm = term;
        } else if (priority === 'warning') {
          warningTerm = term;
        }
      }

      const activeTerm = criticalTerm ?? warningTerm;

      if (activeTerm) {
        const operator = activeTerm.operator ?? 'ABOVE';
        strategy['alertCondition'] = OPERATOR_MAP[operator] ?? 'ABOVE';

        strategy['threshold'] = activeTerm.threshold ?? 0;

        const durationSeconds = activeTerm.thresholdDuration ?? 300;
        const samples = Math.max(1, Math.floor(durationSeconds / 60));
        strategy['samples'] = samples;
        strategy['violatingSamples'] = samples;

        const occurrences = activeTerm.thresholdOccurrences ?? 'ALL';
        if (occurrences === 'AT_LEAST_ONCE') {
          strategy['violatingSamples'] = 1;
        }
      }
    }

    return strategy;
  }

  private buildQueryDefinition(
    nrqlQuery: string,
    warnings: string[],
  ): Record<string, unknown> {
    let metricKey = this.extractMetricFromNrql(nrqlQuery);

    if (!metricKey) {
      warnings.push(
        `Could not extract metric from NRQL: ${nrqlQuery.slice(0, 100)}... ` +
          'Manual configuration required.',
      );
      metricKey = 'builtin:tech.generic.placeholder';
    }

    return {
      type: 'METRIC_KEY',
      metricKey,
      aggregation: 'AVG',
      entityFilter: {
        dimensionKey: 'dt.entity.service',
        conditions: [],
      },
      dimensionFilter: [],
    };
  }

  private extractMetricFromNrql(query: string): string | undefined {
    const queryLower = query.toLowerCase();

    const metricMappings: Record<string, string> = {
      transactionduration: 'builtin:service.response.time',
      duration: 'builtin:service.response.time',
      apdex: 'builtin:service.response.time',
      error: 'builtin:service.errors.total.rate',
      errorrate: 'builtin:service.errors.total.rate',
      throughput: 'builtin:service.requestCount.total',
      requestcount: 'builtin:service.requestCount.total',
      cpupercent: 'builtin:host.cpu.usage',
      cpu: 'builtin:host.cpu.usage',
      memorypercent: 'builtin:host.mem.usage',
      memory: 'builtin:host.mem.usage',
      diskpercent: 'builtin:host.disk.usedPct',
      disk: 'builtin:host.disk.usedPct',
    };

    for (const [nrqlMetric, dtMetric] of Object.entries(metricMappings)) {
      if (queryLower.includes(nrqlMetric)) {
        return dtMetric;
      }
    }

    return undefined;
  }

  private createPlaceholderEvent(condition: NRAlertCondition): Record<string, unknown> {
    return {
      summary: `[Migrated - Manual Config Required] ${condition.name ?? 'Unknown'}`,
      description:
        `This alert was migrated from New Relic but requires manual configuration.\n` +
        `Original condition type: ${condition.conditionType ?? 'Unknown'}`,
      enabled: false,
      alertingScope: [],
      monitoringStrategy: {
        type: 'STATIC_THRESHOLD',
        alertCondition: 'ABOVE',
        threshold: 0,
        samples: 3,
        violatingSamples: 3,
      },
    };
  }
}
