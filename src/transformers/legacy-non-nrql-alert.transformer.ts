/**
 * Legacy Non-NRQL Alert Condition Transformer (Gen2-only fallback).
 *
 * The default `NonNrqlAlertConditionTransformer` wires Metric Events
 * into a Gen3 Workflow via `nr-migrated` entity tags. For tenants
 * that have not adopted Workflows yet, this legacy variant emits a
 * classic Alerting Profile + Metric Event pair — the pre-Gen3
 * fan-out model — with no Workflow dependency.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { NRNonNrqlConditionInput } from './non-nrql-alert.transformer.js';
import { OPERATOR_MAP } from './mapping-rules.js';

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LegacyAlertingProfileStub {
  readonly schemaId: 'builtin:alerting.profile';
  readonly displayName: string;
  readonly severityRules: Array<{
    readonly severityLevel:
      | 'AVAILABILITY'
      | 'ERROR'
      | 'PERFORMANCE'
      | 'RESOURCE_CONTENTION'
      | 'CUSTOM_ALERT';
    readonly tagFilter: { includeMode: 'NONE' };
    readonly delayInMinutes: number;
  }>;
  readonly eventTypeFilters: unknown[];
}

export interface LegacyClassicMetricEvent {
  readonly schemaId: 'builtin:anomaly-detection.metric-events';
  readonly summary: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly alertingScope: Array<{ filterType: 'ENTITY_ID'; entityId: string | null }>;
  readonly monitoringStrategy: Record<string, unknown>;
  readonly queryDefinition: Record<string, unknown>;
}

export interface LegacyNonNrqlAlertTransformData {
  readonly alertingProfile: LegacyAlertingProfileStub;
  readonly metricEvent: LegacyClassicMetricEvent;
}

// ---------------------------------------------------------------------------
// Per-product NR metric → DT metric key (kept in sync with the Gen3 side)
// ---------------------------------------------------------------------------

const METRIC_MAP: Record<string, Record<string, string>> = {
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

const DIMENSION_KEY: Record<string, string> = {
  APM: 'dt.entity.service',
  APM_APP: 'dt.entity.service',
  INFRA_METRIC: 'dt.entity.host',
  INFRA_PROCESS: 'dt.entity.process_group_instance',
  SYNTHETIC: 'dt.entity.synthetic_test',
  BROWSER: 'dt.entity.application',
  MOBILE: 'dt.entity.mobile_application',
  EXTERNAL_SERVICE: 'dt.entity.service',
};

const LEGACY_WARNING =
  'Emitting Gen2 classic Alerting Profile + Metric Event (legacy). Default output wires into a Gen3 Workflow — use NonNrqlAlertConditionTransformer unless legacy parity is required.';

// ---------------------------------------------------------------------------
// LegacyNonNrqlAlertConditionTransformer
// ---------------------------------------------------------------------------

export class LegacyNonNrqlAlertConditionTransformer {
  transform(
    input: NRNonNrqlConditionInput,
  ): TransformResult<LegacyNonNrqlAlertTransformData> {
    try {
      if (!input.conditionType) {
        return failure(['conditionType is required']);
      }
      const warnings: string[] = [LEGACY_WARNING];
      const conditionName = input.name ?? 'Unnamed Condition';
      const enabled = input.enabled ?? true;
      const metricLookup = METRIC_MAP[input.conditionType] ?? {};
      const dimensionKey = DIMENSION_KEY[input.conditionType] ?? 'dt.entity.service';
      const metricKey = input.metric ? metricLookup[input.metric] : undefined;

      if (!metricKey) {
        warnings.push(
          `NR ${input.conditionType} metric '${input.metric ?? '<unset>'}' has no direct Gen2 mapping; emitted a disabled Metric Event.`,
        );
      }

      const strategy: Record<string, unknown> = {
        type: 'STATIC_THRESHOLD',
        alertCondition: 'ABOVE',
        samples: 3,
        violatingSamples: 3,
        threshold: 0,
        unit: 'UNSPECIFIED',
        alertingOnMissingData: false,
        dealingWithGapsStrategy: 'DROP_DATA',
      };
      const terms = input.terms ?? [];
      const critical = terms.find((t) => (t.priority ?? 'critical').toLowerCase() === 'critical');
      const active = critical ?? terms[0];
      if (active) {
        strategy['alertCondition'] = OPERATOR_MAP[active.operator ?? 'ABOVE'] ?? 'ABOVE';
        strategy['threshold'] = active.threshold ?? 0;
        const samples = Math.max(1, Math.floor((active.thresholdDuration ?? 300) / 60));
        strategy['samples'] = samples;
        strategy['violatingSamples'] = samples;
        if ((active.thresholdOccurrences ?? '').toUpperCase() === 'AT_LEAST_ONCE') {
          strategy['violatingSamples'] = 1;
        }
      }

      const alertingProfile: LegacyAlertingProfileStub = {
        schemaId: 'builtin:alerting.profile',
        displayName: `[Migrated Legacy] ${input.policyName ?? conditionName}`,
        severityRules: [
          { severityLevel: 'AVAILABILITY', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
          { severityLevel: 'ERROR', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
          { severityLevel: 'PERFORMANCE', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
          {
            severityLevel: 'RESOURCE_CONTENTION',
            tagFilter: { includeMode: 'NONE' },
            delayInMinutes: 0,
          },
          { severityLevel: 'CUSTOM_ALERT', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
        ],
        eventTypeFilters: [],
      };

      const metricEvent: LegacyClassicMetricEvent = {
        schemaId: 'builtin:anomaly-detection.metric-events',
        summary: metricKey
          ? `[Migrated Legacy] ${conditionName}`
          : `[Migrated Legacy - Manual Config Required] ${conditionName}`,
        description: `Migrated from NR ${input.conditionType} condition on metric '${input.metric ?? ''}'.`,
        enabled: metricKey ? enabled : false,
        alertingScope: (input.entityGuids ?? []).length > 0
          ? (input.entityGuids ?? []).map((guid) => ({
              filterType: 'ENTITY_ID' as const,
              entityId: guid,
            }))
          : [{ filterType: 'ENTITY_ID', entityId: null }],
        monitoringStrategy: strategy,
        queryDefinition: {
          type: 'METRIC_KEY',
          metricKey: metricKey ?? 'builtin:tech.generic.placeholder',
          aggregation: 'AVG',
          entityFilter: { dimensionKey, conditions: [] },
          dimensionFilter: [],
        },
      };

      return success({ alertingProfile, metricEvent }, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRNonNrqlConditionInput[],
  ): TransformResult<LegacyNonNrqlAlertTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
