/**
 * Alert Transformer — Converts New Relic alert policies + conditions to
 * Dynatrace Gen3 Workflows (default) that fire on Davis problems raised
 * by a companion Metric Event (builtin:anomaly-detection.metric-events).
 *
 * Gen3 shape (default):
 *   - One or more Metric Events (one per NR condition), each driven by a
 *     DQL query extracted from the condition's NRQL.
 *   - One Workflow with a davis_problem trigger filtered by the tags
 *     applied to the Metric Events, aggregating the conditions into a
 *     single event-routing unit.
 *
 * Gen2 shape (LegacyAlertTransformer): the previous Alerting Profile +
 * Metric Event output. Preserved for opt-in parity.
 */

import { OPERATOR_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
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

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

/**
 * A Gen3 Workflow configured to fire on Davis problems. Mirrors the
 * shape accepted by the dynatrace_automation_workflow Terraform resource
 * / workflow settings schema.
 */
export interface DTWorkflow {
  readonly title: string;
  readonly description: string;
  readonly isPrivate: boolean;
  readonly trigger: {
    readonly event: {
      readonly active: boolean;
      readonly config: {
        readonly davisProblem: {
          readonly categories: {
            readonly availability: boolean;
            readonly error: boolean;
            readonly slowdown: boolean;
            readonly resource: boolean;
            readonly custom: boolean;
            readonly monitoringUnavailable: boolean;
          };
          readonly entityTags: Record<string, string>;
          readonly entityTagsMatch: 'all' | 'any';
        };
      };
    };
  };
  readonly tasks: DTWorkflowTaskRef[];
}

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
 * Gen3 Metric Event (builtin:anomaly-detection.metric-events) emitted
 * as the signal source for the Workflow. `entityTags` on the event
 * align with `trigger.event.config.davis_problem.entity_tags` on the
 * workflow so the workflow fires only for problems raised by this
 * Metric Event.
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
  readonly workflow: DTWorkflow;
  readonly metricEvents: DTMetricEvent[];
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

function migrationTag(policyName: string): string {
  return (
    policyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'migrated-policy'
  );
}

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

export class AlertTransformer {
  transform(nrPolicy: NRAlertPolicyInput): TransformResult<AlertTransformData> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      const policyName = nrPolicy.name ?? 'Unnamed Policy';
      const tag = migrationTag(policyName);
      const entityTags = { 'nr-migrated': tag };

      const metricEvents: DTMetricEvent[] = [];
      const conditions = nrPolicy.conditions ?? [];

      for (const condition of conditions) {
        const ev = this.buildMetricEvent(condition, entityTags, warnings);
        if (ev) metricEvents.push(ev);
      }

      const workflow: DTWorkflow = {
        title: `[Migrated] ${policyName}`,
        description: `Migrated from New Relic alert policy "${policyName}". Fires on Davis problems raised by companion Metric Events (tag nr-migrated=${tag}).`,
        isPrivate: false,
        trigger: {
          event: {
            active: true,
            config: {
              davisProblem: {
                categories: {
                  availability: true,
                  error: true,
                  slowdown: true,
                  resource: true,
                  custom: true,
                  monitoringUnavailable: false,
                },
                entityTags,
                entityTagsMatch: 'all',
              },
            },
          },
        },
        tasks: [],
      };

      warnings.push(
        `Workflow has no tasks attached. Wire NotificationTransformer output into workflow.tasks for policy "${policyName}".`,
      );

      return { success: true, data: { workflow, metricEvents }, warnings, errors };
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(policies: NRAlertPolicyInput[]): TransformResult<AlertTransformData>[] {
    return policies.map((p) => this.transform(p));
  }

  private buildMetricEvent(
    condition: NRAlertCondition,
    entityTags: Record<string, string>,
    warnings: string[],
  ): DTMetricEvent | undefined {
    const conditionType = condition.conditionType ?? 'NRQL';
    const conditionName = condition.name ?? 'Unnamed Condition';

    if (conditionType !== 'NRQL') {
      warnings.push(
        `Condition type '${conditionType}' for '${conditionName}' may require manual configuration`,
      );
      return {
        schemaId: 'builtin:anomaly-detection.metric-events',
        summary: `[Migrated - Manual Config Required] ${conditionName}`,
        description:
          `This alert was migrated from New Relic but requires manual configuration.\n` +
          `Original condition type: ${conditionType}`,
        enabled: false,
        severity: 'CUSTOM_ALERT',
        queryDefinition: {
          type: 'METRIC_KEY',
          metricKey: 'builtin:tech.generic.placeholder',
          aggregation: 'AVG',
          entityFilter: { dimensionKey: 'dt.entity.service', conditions: [] },
          dimensionFilter: [],
        },
        monitoringStrategy: {
          type: 'STATIC_THRESHOLD',
          alertCondition: 'ABOVE',
          threshold: 0,
          samples: 3,
          violatingSamples: 3,
        },
        eventTemplate: {
          title: conditionName,
          description: `Manual configuration required.`,
        },
        entityTags,
      };
    }

    const description = condition.description ?? '';
    const enabled = condition.enabled ?? true;
    const query = condition.nrql?.query ?? '';
    const aggregationWindow = condition.signal?.aggregationWindow ?? 60;
    const terms = condition.terms ?? [];
    const runbookUrl = condition.runbookUrl;

    let descriptionText =
      description || `Migrated from New Relic. Original NRQL: ${query.slice(0, 200)}`;
    if (runbookUrl) {
      descriptionText += `\n\nRunbook: ${runbookUrl}`;
    }

    return {
      schemaId: 'builtin:anomaly-detection.metric-events',
      summary: `[Migrated] ${conditionName}`,
      description: descriptionText,
      enabled,
      severity: 'CUSTOM_ALERT',
      queryDefinition: buildQueryDefinition(query, warnings),
      monitoringStrategy: buildMonitoringStrategy(terms, aggregationWindow, query, warnings),
      eventTemplate: {
        title: `[Migrated] ${conditionName}`,
        description: descriptionText,
      },
      entityTags,
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
