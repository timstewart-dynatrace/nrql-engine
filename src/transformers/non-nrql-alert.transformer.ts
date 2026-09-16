/**
 * Non-NRQL Alert Condition Transformer — Translates NR alert conditions
 * whose signal is NOT a NRQL query (APM, Infrastructure, Synthetic,
 * Browser, Mobile, External Service) to Dynatrace Gen3 Davis anomaly
 * detectors (`builtin:davis.anomaly-detectors`, v1.0.14 shape) plus a
 * paired Automation Workflow whose `davis_event` trigger targets the
 * detector id — same shape as `AlertTransformer`.
 *
 * Mapping strategy: each condition carries a builtin metric name; the
 * transformer maps it through a per-product lookup table to a DT metric
 * key, builds a `timeseries` DQL query split by the Smartscape entity
 * dimension (`dt.smartscape.*`) where one exists, and emits a static
 * threshold analyzer from the NR term(s). Unmapped metrics emit a warning
 * and produce a disabled placeholder detector.
 *
 * Mirrors Python `transformers/non_nrql_alert_transformer.py` in
 * NewRelic-to-Dynatrace-Migration-Utilities (output shape; the TS input
 * contract is per-metric and richer than the Python per-type table).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import { placeholderTask, resolveThreshold, type NRAlertTerm } from './alert.transformer.js';
import {
  DAVIS_ANALYZERS,
  DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
  DETECTOR_SOURCE,
  PLACEHOLDER_DQL,
  staticThresholdInput,
  type DTAnomalyDetector,
  type DTKeyValue,
} from './detector-utils.js';
import { tasksListToDict, type DTDavisEventWorkflow } from './workflow-utils.js';
import { smartscapeField } from '../validators/smartscape-map.js';

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

/**
 * Classic entity type per product; resolved to `dt.smartscape.*` via the
 * shared Smartscape map. Types with no Smartscape equivalent
 * (synthetic_test, mobile_application) yield no split dimension.
 */
const CLASSIC_ENTITY_TYPE: Record<NRNonNrqlConditionType, string> = {
  APM: 'service',
  APM_APP: 'service',
  INFRA_METRIC: 'host',
  INFRA_PROCESS: 'process_group_instance',
  SYNTHETIC: 'synthetic_test',
  BROWSER: 'application',
  MOBILE: 'mobile_application',
  EXTERNAL_SERVICE: 'service',
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface NonNrqlAlertTransformData {
  /** One `builtin:davis.anomaly-detectors` envelope for the condition. */
  readonly anomalyDetectors: DTAnomalyDetector[];
  /** Workflow(s) whose `davis_event` trigger targets the detector id. */
  readonly workflows: DTDavisEventWorkflow[];
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
      const ctype = input.conditionType.toLowerCase();
      const name = input.name ?? 'Unnamed Condition';
      const metricKey = input.metric ? METRIC_MAP[input.conditionType]?.[input.metric] : undefined;
      const classicType = CLASSIC_ENTITY_TYPE[input.conditionType];
      const dimension = smartscapeField(classicType);

      let query: string;
      let enabled = input.enabled ?? true;
      let note: string;
      if (metricKey) {
        if (dimension) {
          query = `timeseries avg(${metricKey}), by:{${dimension}}`;
        } else {
          query = `timeseries avg(${metricKey})`;
          warnings.push(
            `NR ${input.conditionType} condition '${name}': classic entity type '${classicType}' has no Smartscape equivalent; detector query is not split by entity. Add a raw-dimension split in Dynatrace if per-entity alerting is required.`,
          );
        }
        note = `Migrated from NR ${input.conditionType} condition on metric '${input.metric}'.`;
      } else {
        query = `// UNMAPPED NR METRIC: ${input.metric ?? '<unset>'}\n${PLACEHOLDER_DQL}`;
        enabled = false;
        note = `Migrated from NR ${input.conditionType} condition. Original metric: '${input.metric ?? ''}'. Map to a DT metric before enabling.`;
        warnings.push(
          `NR ${input.conditionType} metric '${input.metric ?? '<unset>'}' has no direct Gen3 mapping; emitted a disabled placeholder anomaly detector. Finish the metric selection in Dynatrace before enabling.`,
        );
      }

      const { threshold, alertCondition, samples, violating } = resolveThreshold(
        input.terms ?? [],
      );

      const properties: DTKeyValue[] = [
        { key: 'event.type', value: 'CUSTOM_ALERT' },
        { key: 'event.name', value: `[Migrated] ${name}` },
        { key: 'source.condition', value: name },
        { key: 'source.type', value: ctype },
        { key: 'migrated.from', value: 'newrelic' },
      ];
      if (input.policyName) properties.push({ key: 'source.policy', value: input.policyName });
      if (input.metric) properties.push({ key: 'source.metric', value: input.metric });
      if (input.entityGuids && input.entityGuids.length > 0) {
        properties.push({ key: 'source.entityGuids', value: input.entityGuids.join(',') });
        warnings.push(
          `NR entity GUIDs for '${name}' do not carry over to Dynatrace; they are preserved in eventTemplate.properties[source.entityGuids]. Add a dimension filter to the detector query to scope it.`,
        );
      }

      const detectorId = `davis-${ctype}-${name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 180);

      const detector: DTAnomalyDetector = {
        schemaId: DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
        scope: 'environment',
        detectorId,
        value: {
          enabled,
          title: `[Migrated] ${name}`,
          description: note,
          source: DETECTOR_SOURCE,
          executionSettings: { actor: null, queryOffset: null },
          analyzer: {
            name: DAVIS_ANALYZERS.STATIC_THRESHOLD,
            input: staticThresholdInput({
              query,
              threshold,
              alertCondition,
              violatingSamples: violating,
              slidingWindow: samples,
            }),
          },
          eventTemplate: { properties },
        },
      };

      const workflow: DTDavisEventWorkflow = {
        title: `[Migrated ${ctype}] ${name}`,
        description: note,
        private: false,
        trigger: {
          event: {
            active: true,
            config: {
              davis_event: {
                eventType: 'CUSTOM_ALERT',
                detectorIds: [detectorId],
                anyEventMatches: true,
              },
            },
          },
        },
        // Gen3 Automation API requires `tasks` as a dict keyed by task id.
        tasks: tasksListToDict([
          placeholderTask('Attach notifications/actions via NotificationTransformer output.'),
        ]),
      };

      return success({ anomalyDetectors: [detector], workflows: [workflow] }, warnings);
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
