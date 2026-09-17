/**
 * Alert Transformer — Converts New Relic alert policies + conditions to
 * Dynatrace Gen3 objects (default):
 *
 *   NR Alert Policy      -> Automation Workflow (one per policy; one per
 *                           severity when the policy carries a non-uniform
 *                           severity delay ladder)
 *   NR NRQL Condition    -> Davis Anomaly Detector
 *                           (`builtin:davis.anomaly-detectors`, v1.0.14 shape)
 *   NR Notification Ch.  -> Workflow action task (via NotificationTransformer)
 *
 * Each detector names its events `[Migrated] <policy> | <condition>`; the
 * policy's workflow uses a `davis-problem` trigger whose customFilter matches
 * that prefix (`migratedEventFilter`). Detector queries are timeseries DQL
 * compiled from the condition NRQL (see `nrqlToAnalyzerQuery`).
 *
 * Mirrors Python `transformers/alert_transformer.py` in
 * NewRelic-to-Dynatrace-Migration-Utilities.
 *
 * Gen2 shape (LegacyAlertTransformer): the previous Alerting Profile +
 * Metric Event output. Preserved for opt-in parity.
 */

import { OPERATOR_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { failure } from './types.js';
import {
  DAVIS_ANALYZERS,
  DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
  DETECTOR_SOURCE,
  nrqlToAnalyzerQuery,
  staticThresholdInput,
  alertConditionFor,
  type DTAnomalyDetector,
  type DTKeyValue,
} from './detector-utils.js';
import {
  davisProblemTrigger,
  migratedEventFilter,
  migratedEventName,
  tasksListToDict,
  type DTDavisProblemWorkflow,
  type DTWorkflowTaskDefinition,
} from './workflow-utils.js';
import {
  NotificationTransformer,
  type NRNotificationChannelInput,
} from './notification.transformer.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRAlertPolicyInput {
  readonly name?: string;
  readonly id?: string;
  readonly incidentPreference?: string;
  readonly conditions?: NRAlertCondition[];
  /** Channels routed by this policy; each becomes a workflow task. */
  readonly notificationChannels?: NRNotificationChannelInput[];
  /** Per-severity notification delays (non-uniform delays fan out workflows). */
  readonly severityRules?: NRSeverityRule[];
}

export interface NRSeverityRule {
  readonly severity?: string;
  readonly severityLevel?: string;
  readonly delayMinutes?: number;
  readonly delayInMinutes?: number;
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

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

/**
 * A Gen3 Workflow configured to fire on Davis problems.
 *
 * @deprecated Alias of `DTDavisProblemWorkflow` (the previous
 * `trigger.event.config.davisProblem` shape was not an Automation API shape).
 */
export type DTWorkflow = DTDavisProblemWorkflow;

/**
 * Placeholder task list — downstream callers (e.g., the consuming CLI
 * or another transformer) wire NotificationTransformer output into
 * `tasks`. The Alert transformer only produces the trigger shell.
 */
export interface DTWorkflowTaskRef {
  readonly name: string;
  readonly action: string;
  readonly description: string;
  readonly active: boolean;
}

/**
 * Classic Metric Event (builtin:anomaly-detection.metric-events).
 *
 * @deprecated No longer emitted by the Gen3 `AlertTransformer` /
 * `NonNrqlAlertConditionTransformer` — they emit `DTAnomalyDetector`
 * (`builtin:davis.anomaly-detectors`). Kept exported for type compatibility.
 */
export interface DTMetricEvent {
  readonly schemaId: 'builtin:anomaly-detection.metric-events';
  readonly summary: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly severity: 'AVAILABILITY' | 'ERROR' | 'PERFORMANCE' | 'RESOURCE_CONTENTION' | 'CUSTOM_ALERT';
  readonly queryDefinition: Record<string, unknown>;
  readonly monitoringStrategy: Record<string, unknown>;
  readonly eventTemplate: {
    readonly title: string;
    readonly description: string;
  };
  readonly entityTags: Record<string, string>;
}

export interface AlertTransformData {
  /** First (or only) workflow — equals `workflows[0]`. */
  readonly workflow: DTDavisProblemWorkflow;
  /** All workflows; >1 only when a severity-ladder fanout occurred. */
  readonly workflows: DTDavisProblemWorkflow[];
  /** One `builtin:davis.anomaly-detectors` envelope per NR condition. */
  readonly anomalyDetectors: DTAnomalyDetector[];
}

// ---------------------------------------------------------------------------
// Legacy (Gen2) output
// ---------------------------------------------------------------------------

export interface LegacyAlertTransformData {
  alertingProfile: Record<string, unknown>;
  metricEvents: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function extractMetricFromNrql(query: string): string | undefined {
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

function buildMonitoringStrategy(
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

function buildQueryDefinition(
  nrqlQuery: string,
  warnings: string[],
): Record<string, unknown> {
  let metricKey = extractMetricFromNrql(nrqlQuery);

  if (!metricKey) {
    warnings.push(
      `Could not extract metric from NRQL: ${nrqlQuery.slice(0, 100)}... Manual configuration required.`,
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

// ---------------------------------------------------------------------------
// AlertTransformer (Gen3 default)
// ---------------------------------------------------------------------------

export interface ResolvedThreshold {
  readonly threshold: number;
  readonly alertCondition: string;
  readonly samples: number;
  readonly violating: number;
}

/**
 * Pick the critical term (fallback: warning, then first term) and translate
 * it to Davis static-threshold analyzer inputs. Mirrors Python
 * `AlertTransformer._resolve_threshold`.
 */
export function resolveThreshold(
  terms: readonly NRAlertTerm[],
  warnings?: string[],
): ResolvedThreshold {
  if (terms.length === 0) {
    return { threshold: 0, alertCondition: 'ABOVE', samples: 3, violating: 3 };
  }
  const critical = terms.find((t) => (t.priority ?? '').toLowerCase() === 'critical');
  const warning = terms.find((t) => (t.priority ?? '').toLowerCase() === 'warning');
  const active = critical ?? warning ?? terms[0]!;

  // D23: the analyzer only accepts ABOVE / BELOW (verified live).
  const alertCondition = alertConditionFor(active.operator ?? 'ABOVE', 'ABOVE', warnings);
  const threshold = Number(active.threshold ?? 0);
  const samples = Math.max(1, Math.floor((active.thresholdDuration ?? 300) / 60));
  const violating = active.thresholdOccurrences === 'AT_LEAST_ONCE' ? 1 : samples;
  return { threshold, alertCondition, samples, violating };
}

/** Disabled placeholder task used when a workflow has no actions. */
export function placeholderTask(
  description = 'No NR notification channels attached to the policy — add an action.',
): DTWorkflowTaskDefinition {
  return {
    name: 'placeholder_action',
    action: 'dynatrace.automations:run-javascript',
    active: false,
    description,
    input: { script: 'export default () => ({ ok: true });' },
    position: { x: 0, y: 1 },
  };
}

export class AlertTransformer {
  private readonly notificationTransformer = new NotificationTransformer();

  transform(nrPolicy: NRAlertPolicyInput): TransformResult<AlertTransformData> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      const policyName = nrPolicy.name ?? 'Unnamed Policy';
      const policyId = String(nrPolicy.id ?? '');

      const anomalyDetectors: DTAnomalyDetector[] = [];
      for (const condition of nrPolicy.conditions ?? []) {
        anomalyDetectors.push(this.buildAnomalyDetector(condition, policyName, warnings));
      }
      const workflows = this.buildWorkflows(
        policyName,
        policyId,
        nrPolicy.notificationChannels ?? [],
        nrPolicy.severityRules ?? [],
        warnings,
      );

      return {
        success: true,
        data: { workflow: workflows[0]!, workflows, anomalyDetectors },
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

  // --- Davis anomaly detector (builtin:davis.anomaly-detectors) -------------

  private buildAnomalyDetector(
    condition: NRAlertCondition,
    policyName: string,
    warnings: string[],
  ): DTAnomalyDetector {
    const conditionType = condition.conditionType ?? 'NRQL';
    const conditionName = condition.name ?? 'Unnamed Condition';
    const description = condition.description ?? '';
    let enabled = condition.enabled ?? true;

    if (conditionType !== 'NRQL') {
      warnings.push(
        `Condition type '${conditionType}' for '${conditionName}' requires manual review; emitted a disabled detector skeleton.`,
      );
      enabled = false;
    }

    const query = condition.nrql?.query ?? '';
    const aggregationWindow = condition.signal?.aggregationWindow ?? 60;
    const { threshold, alertCondition, samples, violating } = resolveThreshold(
      condition.terms ?? [],
      warnings,
    );

    // analyzer.input[query] is server-validated as DQL — never pass raw NRQL.
    const dqlQuery = nrqlToAnalyzerQuery(query, warnings);

    const properties: DTKeyValue[] = [
      { key: 'event.type', value: 'CUSTOM_ALERT' },
      { key: 'event.name', value: migratedEventName(policyName, conditionName) },
      { key: 'source.policy', value: policyName },
      { key: 'source.condition', value: conditionName },
      { key: 'migrated.from', value: 'newrelic' },
    ];
    if (query) properties.push({ key: 'original.nrql', value: query });
    properties.push({ key: 'evaluation.window', value: `${aggregationWindow}s` });
    if (condition.runbookUrl) {
      properties.push({ key: 'runbook.url', value: condition.runbookUrl });
    }

    return {
      schemaId: DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
      scope: 'environment',
      value: {
        enabled,
        title: `[Migrated] ${conditionName}`,
        description:
          description ||
          `Migrated from New Relic policy '${policyName}'. Original NRQL: ${query.slice(0, 200)}`,
        source: DETECTOR_SOURCE,
        executionSettings: {}, // actor (service user) injected at import/export — D16
        analyzer: {
          name: DAVIS_ANALYZERS.STATIC_THRESHOLD,
          input: staticThresholdInput({
            query: dqlQuery,
            threshold,
            alertCondition,
            violatingSamples: violating,
            slidingWindow: samples,
          }),
        },
        eventTemplate: { properties },
      },
    };
  }

  // --- Automation workflow(s) ----------------------------------------------

  /**
   * One workflow per policy; when `severityRules` carry non-uniform delays,
   * fan out one workflow per severity (Phase 25 severity-ladder parity).
   */
  private buildWorkflows(
    policyName: string,
    policyId: string,
    channels: readonly NRNotificationChannelInput[],
    severityRules: readonly NRSeverityRule[],
    warnings: string[],
  ): DTDavisProblemWorkflow[] {
    const delays = new Map<string, number>();
    for (const r of severityRules) {
      delays.set(
        String(r.severity ?? r.severityLevel ?? '').toUpperCase(),
        Number(r.delayMinutes ?? r.delayInMinutes ?? 0),
      );
    }
    if (severityRules.length === 0 || new Set(delays.values()).size <= 1) {
      return [
        this.buildSingleWorkflow(policyName, policyId, channels, undefined, warnings),
      ];
    }

    const workflows: DTDavisProblemWorkflow[] = [];
    for (const [severity, delay] of delays) {
      workflows.push(
        this.buildSingleWorkflow(policyName, policyId, channels, severity, warnings, delay),
      );
    }
    const delayDesc = [...delays].map(([k, v]) => `${k}=${v}`).join(', ');
    warnings.push(
      `Policy '${policyName}' has non-uniform severity delays (${delayDesc}). Emitting ${workflows.length} Workflows (one per severity) — Phase 25 severity-ladder fanout.`,
    );
    return workflows;
  }

  /**
   * `policyName` is the base policy name; a severity-fanout workflow is titled
   * `<policy> [SEVERITY]` but still links on the base name, because detector
   * events carry the base policy name.
   */
  private buildSingleWorkflow(
    policyName: string,
    policyId: string,
    channels: readonly NRNotificationChannelInput[],
    severityFilter: string | undefined,
    warnings: string[],
    delayMinutes = 0,
  ): DTDavisProblemWorkflow {
    const tasks: DTWorkflowTaskDefinition[] = [];
    channels.forEach((channel, idx) => {
      const result = this.notificationTransformer.transform(channel);
      if (!result.success || !result.data) {
        warnings.push(...(result.errors.length > 0 ? result.errors : result.warnings));
        return;
      }
      tasks.push({ ...result.data, position: { x: 0, y: idx + 1 } });
      warnings.push(...result.warnings);
    });

    if (delayMinutes > 0) {
      tasks.unshift({
        name: `delay_${delayMinutes}m`,
        action: 'dynatrace.automations:run-javascript',
        active: true,
        description: `Pre-notification delay of ${delayMinutes} minutes (migrated from NR severity ladder).`,
        input: {
          script: `export default async () => { await new Promise(r => setTimeout(r, ${delayMinutes * 60_000})); return { ok: true }; };`,
        },
        position: { x: 0, y: 0 },
      });
    }

    if (tasks.length === 0) tasks.push(placeholderTask());

    let description = `Migrated from New Relic alert policy '${policyName}' (id=${policyId}).`;
    if (severityFilter) {
      description += ` Severity-ladder workflow for ${severityFilter} (delay ${delayMinutes} min).`;
    }

    return {
      title: severityFilter ? `[Migrated] ${policyName} [${severityFilter}]` : `[Migrated] ${policyName}`,
      description,
      isPrivate: false,
      trigger: davisProblemTrigger(migratedEventFilter(policyName), {
        severity: severityFilter ?? '',
        warnings,
      }),
      // Gen3 Automation API requires `tasks` as a dict keyed by task id.
      tasks: tasksListToDict(tasks),
    };
  }
}

// ---------------------------------------------------------------------------
// LegacyAlertTransformer (Gen2 opt-in)
// ---------------------------------------------------------------------------

export class LegacyAlertTransformer {
  transform(nrPolicy: NRAlertPolicyInput): TransformResult<LegacyAlertTransformData> {
    const warnings: string[] = [
      'Emitting Gen2 Alerting Profile + Metric Event (legacy). Default output is a Gen3 Workflow + Metric Event — use AlertTransformer unless legacy parity is required.',
    ];
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

  transformAll(
    policies: NRAlertPolicyInput[],
  ): TransformResult<LegacyAlertTransformData>[] {
    return policies.map((p) => this.transform(p));
  }

  // --- pre-existing Gen2 helpers (unchanged) -------------------------------

  private createAlertingProfile(nrPolicy: NRAlertPolicyInput): Record<string, unknown> {
    const policyName = nrPolicy.name ?? 'Unnamed Policy';

    return {
      name: `[Migrated] ${policyName}`,
      managementZone: null,
      severityRules: [
        { severityLevel: 'AVAILABILITY', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
        { severityLevel: 'ERROR', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
        { severityLevel: 'PERFORMANCE', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
        { severityLevel: 'RESOURCE_CONTENTION', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
        { severityLevel: 'CUSTOM_ALERT', tagFilter: { includeMode: 'NONE' }, delayInMinutes: 0 },
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

    const conditionType = condition.conditionType ?? 'NRQL';
    const conditionName = condition.name ?? 'Unnamed Condition';

    let metricEvent: Record<string, unknown> | undefined;

    if (conditionType === 'NRQL') {
      metricEvent = this.transformNrqlCondition(condition, warnings);
    } else {
      warnings.push(
        `Condition type '${conditionType}' for '${conditionName}' may require manual configuration`,
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
    const query = condition.nrql?.query ?? '';
    const aggregationWindow = condition.signal?.aggregationWindow ?? 60;
    const terms = condition.terms ?? [];

    const metricEvent: Record<string, unknown> = {
      summary: `[Migrated] ${conditionName}`,
      description: description || `Migrated from New Relic. Original NRQL: ${query.slice(0, 200)}`,
      enabled,
      alertingScope: [{ filterType: 'ENTITY_ID', entityId: null }],
      monitoringStrategy: buildMonitoringStrategy(terms, aggregationWindow, query, warnings),
      primaryDimensionKey: null,
      queryDefinition: buildQueryDefinition(query, warnings),
    };

    const runbookUrl = condition.runbookUrl;
    if (runbookUrl) {
      metricEvent['description'] =
        `${metricEvent['description'] as string}\n\nRunbook: ${runbookUrl}`;
    }

    return metricEvent;
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

  // Exposed for existing legacy tests that exercise helpers directly.
  buildMonitoringStrategy(
    terms: readonly NRAlertTerm[],
    aggregationWindow: number,
    query: string,
    warnings: string[],
  ): Record<string, unknown> {
    return buildMonitoringStrategy(terms, aggregationWindow, query, warnings);
  }

  extractMetricFromNrql(query: string): string | undefined {
    return extractMetricFromNrql(query);
  }
}
