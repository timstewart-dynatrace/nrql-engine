/**
 * Non-NRQL Alert Condition Transformer — Translates NR alert conditions
 * whose signal is NOT a NRQL query (APM, Infrastructure, Synthetic,
 * Browser, Mobile, External Service) to Dynatrace Gen3 Metric Events
 * wired to the policy's companion Workflow via `nr-migrated` entity
 * tags (same convention as AlertTransformer).
 *
 * Mapping strategy: each condition carries a builtin metric name; the
 * transformer maps it through a per-product lookup table to a DT
 * `builtin:*` metric key and builds a STATIC_THRESHOLD monitoring
 * strategy from the NR term(s). Unmapped metrics emit a warning and
 * produce a disabled placeholder event (so operators are explicitly
 * prompted to finish the mapping).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { DTMetricEvent, NRAlertTerm } from './alert.transformer.js';
import { OPERATOR_MAP } from './mapping-rules.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRNonNrqlConditionType =
  | 'APM'
  | 'APM_APP'
  | 'INFRA_METRIC'
  | 'INFRA_PROCESS'
  | 'SYNTHETIC'
  | 'BROWSER'
  | 'MOBILE'
  | 'EXTERNAL_SERVICE';

export interface NRNonNrqlConditionInput {
  readonly conditionType: NRNonNrqlConditionType;
  readonly name?: string;
  readonly enabled?: boolean;
  /** NR metric name (e.g. apm.service.responseTime, system.cpu.usagePct, synthetic.success). */
  readonly metric?: string;
  readonly entityGuids?: string[];
  readonly terms?: NRAlertTerm[];
  readonly policyName?: string;
}

// ---------------------------------------------------------------------------
// Per-product NR metric → DT metric key
// ---------------------------------------------------------------------------

const METRIC_MAP: Record<NRNonNrqlConditionType, Record<string, string>> = {
  APM: {
    'apm.service.responseTime': 'builtin:service.response.time',
    'apm.service.apdex': 'builtin:service.response.time',
    'apm.service.errorRate': 'builtin:service.errors.total.rate',
    'apm.service.throughput': 'builtin:service.requestCount.total',
  },
  APM_APP: {
    'apm.application.responseTime': 'builtin:service.response.time',
    'apm.application.errorRate': 'builtin:service.errors.total.rate',
  },
  INFRA_METRIC: {
    'system.cpu.usagePct': 'builtin:host.cpu.usage',
    'system.memoryUsedPct': 'builtin:host.mem.usage',
    'system.diskUsedPct': 'builtin:host.disk.usedPct',
    'system.network.receiveBytesPerSec': 'builtin:host.net.bytesRx',
    'system.network.transmitBytesPerSec': 'builtin:host.net.bytesTx',
  },
  INFRA_PROCESS: {
    'process.cpuPercent': 'builtin:tech.generic.cpu.usage',
    'process.memoryResidentSizeBytes': 'builtin:tech.generic.mem.workingSetSize',
  },
  SYNTHETIC: {
    'synthetic.success': 'builtin:synthetic.http.availability',
    'synthetic.duration': 'builtin:synthetic.http.duration.geo',
  },
  BROWSER: {
    'browser.pageLoad': 'builtin:apps.web.userActionDuration',
    'browser.jsErrors': 'builtin:apps.web.errors.count',
    'browser.lcp': 'builtin:apps.web.largestContentfulPaint',
    'browser.cls': 'builtin:apps.web.cumulativeLayoutShift',
  },
  MOBILE: {
    'mobile.crashRate': 'builtin:apps.mobile.crash.rate',
    'mobile.sessionCount': 'builtin:apps.mobile.session.count',
    'mobile.httpRequestDuration': 'builtin:apps.mobile.request.duration',
  },
  EXTERNAL_SERVICE: {
    'external.responseTime': 'builtin:service.response.time',
    'external.errorRate': 'builtin:service.errors.total.rate',
  },
};

const DEFAULT_ENTITY_DIMENSION: Record<NRNonNrqlConditionType, string> = {
  APM: 'dt.entity.service',
  APM_APP: 'dt.entity.service',
  INFRA_METRIC: 'dt.entity.host',
  INFRA_PROCESS: 'dt.entity.process_group_instance',
  SYNTHETIC: 'dt.entity.synthetic_test',
  BROWSER: 'dt.entity.application',
  MOBILE: 'dt.entity.mobile_application',
  EXTERNAL_SERVICE: 'dt.entity.service',
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface NonNrqlAlertTransformData {
  readonly metricEvent: DTMetricEvent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function migrationTag(policyName: string | undefined): string {
  return (
    (policyName ?? 'migrated-policy')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'migrated-policy'
  );
}

function buildStrategy(terms: readonly NRAlertTerm[]): DTMetricEvent['monitoringStrategy'] {
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
  if (terms.length === 0) return strategy;

  const critical = terms.find((t) => (t.priority ?? 'critical').toLowerCase() === 'critical');
  const warning = terms.find((t) => (t.priority ?? '').toLowerCase() === 'warning');
  const active = critical ?? warning ?? terms[0]!;

  strategy['alertCondition'] = OPERATOR_MAP[active.operator ?? 'ABOVE'] ?? 'ABOVE';
  strategy['threshold'] = active.threshold ?? 0;
  const samples = Math.max(1, Math.floor((active.thresholdDuration ?? 300) / 60));
  strategy['samples'] = samples;
  strategy['violatingSamples'] = samples;
  if ((active.thresholdOccurrences ?? '').toUpperCase() === 'AT_LEAST_ONCE') {
    strategy['violatingSamples'] = 1;
  }
  return strategy;
}

// ---------------------------------------------------------------------------
// NonNrqlAlertConditionTransformer
// ---------------------------------------------------------------------------

export class NonNrqlAlertConditionTransformer {
  transform(input: NRNonNrqlConditionInput): TransformResult<NonNrqlAlertTransformData> {
    try {
      if (!input.conditionType) {
        return failure(['conditionType is required']);
      }
      const warnings: string[] = [];
      const conditionName = input.name ?? 'Unnamed Condition';
      const enabled = input.enabled ?? true;
      const tag = migrationTag(input.policyName);
      const entityTags = { 'nr-migrated': tag };
      const metricLookup = METRIC_MAP[input.conditionType];
      const dimensionKey = DEFAULT_ENTITY_DIMENSION[input.conditionType];

      let metricKey: string | undefined;
      if (input.metric && metricLookup) {
        metricKey = metricLookup[input.metric];
      }

      if (!metricKey) {
        warnings.push(
          `NR ${input.conditionType} metric '${input.metric ?? '<unset>'}' has no direct Gen3 mapping; emitted a disabled placeholder Metric Event. Finish the metric selection in Dynatrace before enabling.`,
        );
        return success({
          metricEvent: {
            schemaId: 'builtin:anomaly-detection.metric-events',
            summary: `[Migrated - Manual Config Required] ${conditionName}`,
            description: `Migrated from NR ${input.conditionType} condition. Original metric: '${input.metric ?? ''}'. Map to a DT builtin:* metric before enabling.`,
            enabled: false,
            severity: 'CUSTOM_ALERT',
            queryDefinition: {
              type: 'METRIC_KEY',
              metricKey: 'builtin:tech.generic.placeholder',
              aggregation: 'AVG',
              entityFilter: { dimensionKey, conditions: [] },
              dimensionFilter: [],
            },
            monitoringStrategy: buildStrategy(input.terms ?? []),
            eventTemplate: {
              title: `[Migrated] ${conditionName}`,
              description: 'Manual configuration required — unmapped metric.',
            },
            entityTags,
          },
        }, warnings);
      }

      const entityConditions = (input.entityGuids ?? []).map((guid) => ({
        type: 'ENTITY_ID',
        value: guid,
      }));

      const metricEvent: DTMetricEvent = {
        schemaId: 'builtin:anomaly-detection.metric-events',
        summary: `[Migrated] ${conditionName}`,
        description: `Migrated from NR ${input.conditionType} condition on metric '${input.metric}'.`,
        enabled,
        severity: 'CUSTOM_ALERT',
        queryDefinition: {
          type: 'METRIC_KEY',
          metricKey,
          aggregation: 'AVG',
          entityFilter: { dimensionKey, conditions: entityConditions },
          dimensionFilter: [],
        },
        monitoringStrategy: buildStrategy(input.terms ?? []),
        eventTemplate: {
          title: `[Migrated] ${conditionName}`,
          description: `Source: NR ${input.conditionType} condition on ${input.metric}.`,
        },
        entityTags,
      };

      return success({ metricEvent }, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRNonNrqlConditionInput[],
  ): TransformResult<NonNrqlAlertTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
