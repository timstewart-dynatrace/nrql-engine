/**
 * Non-NRQL Alert Condition Transformer — Translates NR alert conditions
 * whose signal is NOT a NRQL query (APM, Infrastructure, Synthetic,
 * Browser, Mobile, External Service) to Dynatrace Gen3 Davis anomaly
 * detectors (`builtin:davis.anomaly-detectors`, v1.0.14 shape) plus a
 * paired Automation Workflow whose `davis-problem` trigger matches the
 * detector's event name (`[Migrated] <condition> | <type>`) — same linkage
 * as `AlertTransformer`.
 *
 * Mapping strategy: each condition carries a builtin metric name; the
 * transformer maps it through a per-product lookup table to a DT metric
 * key, translates that to a Grail metric key (`metricTimeseriesQuery`; classic
 * `builtin:` keys are invalid DQL), builds a `timeseries` DQL query split by the Smartscape entity
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
import { placeholderTask, type NRAlertTerm } from './alert.transformer.js';
import {
  DAVIS_ANALYZERS,
  DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
  DETECTOR_SOURCE,
  FALLBACK_QUERY,
  alertConditionFor,
  metricTimeseriesQuery,
  sampleSettings,
  staticThresholdInput,
  type DTAnomalyDetector,
  type DTKeyValue,
} from './detector-utils.js';
import {
  davisProblemTrigger,
  migratedEventFilter,
  migratedEventName,
  tasksListToDict,
  type DTDavisProblemWorkflow,
} from './workflow-utils.js';
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
    'synthetic.success': 'builtin:synthetic.http.availability.location.total',
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
  /** Workflow(s) whose `davis-problem` trigger matches the detector's event name. */
  readonly workflows: DTDavisProblemWorkflow[];
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
        // D2: classic `builtin:` keys are invalid DQL; unverified keys get the inert fallback.
        const base = metricTimeseriesQuery(metricKey, warnings);
        if (!base.startsWith('timeseries ')) {
          query = base;
        } else if (dimension) {
          query = `${base}, by:{${dimension}}`;
        } else {
          query = base;
          warnings.push(
            `NR ${input.conditionType} condition '${name}': classic entity type '${classicType}' has no Smartscape equivalent; detector query is not split by entity. Add a raw-dimension split in Dynatrace if per-entity alerting is required.`,
          );
        }
        note = `Migrated from NR ${input.conditionType} condition on metric '${input.metric}'.`;
      } else {
        query = `// UNMAPPED NR METRIC: ${input.metric ?? '<unset>'}\n${FALLBACK_QUERY}`;
        enabled = false;
        note = `Migrated from NR ${input.conditionType} condition. Original metric: '${input.metric ?? ''}'. Map to a DT metric before enabling.`;
        warnings.push(
          `NR ${input.conditionType} metric '${input.metric ?? '<unset>'}' has no direct Gen3 mapping; emitted a disabled placeholder anomaly detector. Finish the metric selection in Dynatrace before enabling.`,
        );
      }

      // D6: honour the NR term operator and AT_LEAST_ONCE occurrences.
      const terms = input.terms ?? [];
      let threshold = 0;
      let alertCondition = 'ABOVE';
      let violating = 3;
      let samples = 3;
      if (terms.length > 0) {
        const critical =
          terms.find((t) => (t.priority ?? '').toLowerCase() === 'critical') ?? terms[0]!;
        threshold = Number(critical.threshold ?? 0);
        alertCondition = alertConditionFor(critical.operator, alertCondition, warnings);
        [violating, samples] = sampleSettings(
          critical.thresholdDuration ?? 300,
          critical.thresholdOccurrences,
        );
      }

      const properties: DTKeyValue[] = [
        { key: 'event.type', value: 'CUSTOM_ALERT' },
        { key: 'event.name', value: migratedEventName(name, ctype) },
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

      const detector: DTAnomalyDetector = {
        schemaId: DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
        scope: 'environment',
        value: {
          enabled,
          title: `[Migrated] ${name}`,
          description: note,
          source: DETECTOR_SOURCE,
          executionSettings: {}, // actor (service user) injected at import/export — D16
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

      const workflow: DTDavisProblemWorkflow = {
        title: `[Migrated ${ctype}] ${name}`,
        description: note,
        isPrivate: false,
        trigger: davisProblemTrigger(migratedEventFilter(name)),
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
