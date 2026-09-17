/**
 * AIOps Transformer — Converts New Relic Applied Intelligence
 * workflows (incident routing + enrichments) to Dynatrace Gen3
 * Workflows.
 *
 * Key distinction vs `AlertTransformer`: that transformer converts
 * *alert policies* (threshold/condition + channel fanout). This
 * transformer converts *NR workflows* — the AIOps automation graph
 * that enriches and routes incidents. Both emit Gen3 `DTWorkflow`
 * shapes, but AIOps workflows commonly carry enrichment steps and
 * multi-channel fanout.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import { NRQLCompiler } from '../compiler/index.js';
import {
  MIGRATED_EVENT_PREFIX,
  davisProblemTrigger,
  tasksListToDict,
  type DTDavisProblemWorkflow,
} from './workflow-utils.js';

const enrichmentCompiler = new NRQLCompiler();

/**
 * Enrichment tasks execute DQL, never NRQL (D15). HIGH/MEDIUM compiles are
 * used as-is; anything else is preserved as a comment for manual rewrite.
 * Mirrors Python `AIOpsTransformer._enrichment_dql`.
 */
function compileEnrichmentNrql(nrql: string): { dql: string; confidence: string; warnings: string[] } {
  const trimmed = (nrql ?? '').trim();
  if (!trimmed) {
    return {
      dql: '// TODO: add enrichment DQL',
      confidence: 'LOW',
      warnings: ['Empty enrichment NRQL — emitted a `// TODO: add enrichment DQL` placeholder.'],
    };
  }
  let result: ReturnType<NRQLCompiler['compile']> | undefined;
  try {
    result = enrichmentCompiler.compile(trimmed);
  } catch {
    result = undefined;
  }
  const confidence = (result?.confidence ?? '').toUpperCase();
  if (result?.success && result.dql && (confidence === 'HIGH' || confidence === 'MEDIUM')) {
    return { dql: result.dql, confidence, warnings: result.warnings };
  }
  const oneLine = trimmed.split(/\s+/).join(' ');
  return {
    dql: `// UNCONVERTED NRQL: ${oneLine}\n// TODO: rewrite as DQL`,
    confidence: confidence || 'LOW',
    warnings: [`AIOps enrichment NRQL could not be converted to DQL: ${trimmed.slice(0, 80)}`],
  };
}

/** NR AI workflows route issues from any policy: match every migrated detector. */
const ALL_MIGRATED_PROBLEMS_FILTER = `matchesValue(event.name, "${MIGRATED_EVENT_PREFIX} *")`;

function priorityWarning(priority: string): string {
  return `NR issue priority '${priority}' has no davis-problem trigger equivalent; the workflow triggers on all problem categories. Add a severity condition to the workflow if needed.`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRAIOpsWorkflowInput {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly issuesFilter?: {
    readonly priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    readonly entityTags?: Record<string, string>;
  };
  readonly destinations?: Array<{
    readonly channelType: string;
    readonly channelId?: string;
    readonly name?: string;
  }>;
  readonly enrichments?: Array<{
    readonly name: string;
    readonly nrql: string;
  }>;
  readonly mutingRules?: Array<{
    readonly nrql: string;
    readonly description?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Workflows v2 input (distinct NerdGraph shape)
// ---------------------------------------------------------------------------

export type NRWorkflowV2MutingHandling =
  | 'NOTIFY_ALL_ISSUES'
  | 'DONT_NOTIFY_FULLY_MUTED_ISSUES'
  | 'DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES';

export type NRWorkflowV2NotificationTrigger = 'ACTIVATED' | 'CLOSED' | 'ACKNOWLEDGED';

export interface NRWorkflowV2Predicate {
  readonly attribute: string;
  readonly operator: 'EQUAL' | 'NOT_EQUAL' | 'CONTAINS' | 'STARTS_WITH' | 'IN';
  readonly values: string[];
}

export interface NRAIOpsWorkflowV2Input {
  readonly name?: string;
  readonly workflowEnabled?: boolean;
  readonly destinationsEnabled?: boolean;
  readonly mutingRulesHandling?: NRWorkflowV2MutingHandling;
  readonly issuesFilter?: {
    readonly name?: string;
    readonly predicates: NRWorkflowV2Predicate[];
  };
  readonly destinationConfigurations?: Array<{
    readonly channelId: string;
    readonly name?: string;
    readonly channelType?: string;
    readonly notificationTriggers?: NRWorkflowV2NotificationTrigger[];
    readonly updateOriginalMessage?: boolean;
  }>;
  readonly enrichments?: {
    readonly nrqlEnrichments?: Array<{
      readonly name: string;
      readonly query: string;
    }>;
    readonly dashboardEnrichments?: Array<{
      readonly name: string;
      readonly dashboardGuid: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Gen3 output — reuses the AlertTransformer's DTWorkflow shape
// ---------------------------------------------------------------------------

export interface DTWorkflowEnrichment {
  readonly name: string;
  readonly action: 'dynatrace.automations:run-query';
  readonly description: string;
  readonly active: boolean;
  readonly input: {
    readonly query: string;
    readonly resultKey: string;
  };
}

/**
 * Gen3 Automation workflow (davis-problem trigger, dict-keyed `tasks`).
 * Non-API data (notification stubs, muting-rule notes) lives on
 * `AIOpsTransformData`, not on the workflow body.
 */
export type DTAiopsWorkflow = DTDavisProblemWorkflow<DTWorkflowEnrichment>;

export interface AIOpsTransformData {
  readonly workflow: DTAiopsWorkflow;
  /** Destinations to wire as NotificationTransformer tasks. */
  readonly notificationTaskStubs: Array<{ channelType: string; taskName: string }>;
  /** Muting-rule notes (Dynatrace has no mute-rule object). */
  readonly mutingRuleDql: string[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Wire NotificationTransformer output into the `workflow.tasks` dict for each destination channel to complete the AIOps workflow.',
  'Enrichment DQL queries are translated from NRQL — verify the query against your Grail schema before enabling the workflow.',
  'Muting rules map to DQL filters that workflow steps must evaluate and short-circuit on. Dynatrace has no direct "mute rule" concept; review each rule and convert to a condition step where necessary.',
  'Destinations tagged as webhook/opsgenie/teams/victorops are emitted as HTTP action stubs; re-provision their URLs/credentials.',
];

// ---------------------------------------------------------------------------
// AIOpsTransformer
// ---------------------------------------------------------------------------

export class AIOpsTransformer {
  transform(input: NRAIOpsWorkflowInput): TransformResult<AIOpsTransformData> {
    try {
      const name = input.name?.trim();
      if (!name) {
        return failure(['AIOps workflow name is required']);
      }

      const warnings: string[] = [];

      if (input.issuesFilter?.priority) {
        warnings.push(priorityWarning(input.issuesFilter.priority));
      }

      const tasks: DTWorkflowEnrichment[] = [];
      for (const enrich of input.enrichments ?? []) {
        const compiled = compileEnrichmentNrql(enrich.nrql);
        tasks.push({
          name: enrich.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          action: 'dynatrace.automations:run-query',
          description: `[Migrated enrichment] ${enrich.name} (confidence: ${compiled.confidence})`,
          active: true,
          input: {
            query: compiled.dql,
            resultKey: enrich.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          },
        });
        for (const w of compiled.warnings) {
          warnings.push(`Enrichment '${enrich.name}': ${w}`);
        }
      }

      const notificationTaskStubs = (input.destinations ?? []).map((d) => ({
        channelType: d.channelType.toUpperCase(),
        taskName: (d.name ?? d.channelId ?? 'destination')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_'),
      }));

      const mutingRuleDql = (input.mutingRules ?? []).map(
        (r) => `# muting rule: ${r.description ?? ''}\n# NRQL source: ${r.nrql}`,
      );

      const workflow: DTAiopsWorkflow = {
        title: `[Migrated AIOps] ${name}`,
        description: `Migrated from New Relic AIOps workflow "${name}".`,
        isPrivate: false,
        trigger: davisProblemTrigger(ALL_MIGRATED_PROBLEMS_FILTER, {
          entityTags: input.issuesFilter?.entityTags ?? {},
          active: input.enabled ?? true,
        }),
        // Gen3 Automation API requires `tasks` as a dict keyed by task id.
        tasks: tasksListToDict(tasks),
      };

      return success(
        { workflow, notificationTaskStubs, mutingRuleDql, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRAIOpsWorkflowInput[],
  ): TransformResult<AIOpsTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }

  // ─── Workflows v2 ───────────────────────────────────────────────────────

  transformV2(input: NRAIOpsWorkflowV2Input): TransformResult<AIOpsTransformData> {
    try {
      const name = input.name?.trim();
      if (!name) return failure(['Workflow v2 name is required']);

      const warnings: string[] = [];
      const active = (input.workflowEnabled ?? true) && (input.destinationsEnabled ?? true);
      if (input.workflowEnabled === false) {
        warnings.push('workflowEnabled=false on source — emitted Workflow is disabled.');
      }

      // Derive entityTags from the v2 predicate list.
      const entityTags: Record<string, string> = {};

      for (const p of input.issuesFilter?.predicates ?? []) {
        if (p.attribute.startsWith('labels.') || p.attribute.startsWith('tags.')) {
          const key = p.attribute.replace(/^(labels|tags)\./, '');
          if (p.operator === 'EQUAL' && p.values.length > 0) {
            entityTags[key] = p.values[0]!;
          }
        } else if (p.attribute === 'priority' && p.values.length > 0) {
          warnings.push(priorityWarning(p.values.join('|')));
        } else {
          warnings.push(
            `Predicate on attribute '${p.attribute}' (op=${p.operator}) has no direct Davis-problem filter equivalent; translate manually.`,
          );
        }
      }

      // Muting handling → comments on the workflow; DT uses Workflow
      // predicate rules, not a stream-level muting flag.
      const mutingRuleDql = input.mutingRulesHandling
        ? [`# Source workflow v2 mutingRulesHandling=${input.mutingRulesHandling}`]
        : [];
      if (input.mutingRulesHandling === 'DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES') {
        warnings.push(
          'mutingRulesHandling=DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES has no direct DT equivalent — layer a Workflow problem-filter step or a maintenance window to match behavior.',
        );
      }

      // Enrichments → run-query tasks with compiled DQL via NRQLCompiler.
      const tasks: DTWorkflowEnrichment[] = [];
      for (const e of input.enrichments?.nrqlEnrichments ?? []) {
        const compiled = compileEnrichmentNrql(e.query);
        tasks.push({
          name: e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          action: 'dynatrace.automations:run-query',
          description: `[Migrated v2 enrichment] ${e.name} (confidence: ${compiled.confidence})`,
          active: true,
          input: {
            query: compiled.dql,
            resultKey: e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          },
        });
        for (const w of compiled.warnings) {
          warnings.push(`v2 enrichment '${e.name}': ${w}`);
        }
      }
      for (const d of input.enrichments?.dashboardEnrichments ?? []) {
        warnings.push(
          `v2 dashboardEnrichment '${d.name}' (dashboardGuid=${d.dashboardGuid}) — Dynatrace dashboards are referenced by document id; re-link after migrating the dashboard.`,
        );
      }

      // Destination configs → notificationTaskStubs (same downstream wiring as v1)
      const notificationTaskStubs = (input.destinationConfigurations ?? []).map((d) => ({
        channelType: (d.channelType ?? 'UNKNOWN').toUpperCase(),
        taskName: (d.name ?? d.channelId)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_'),
      }));

      const workflow: DTAiopsWorkflow = {
        title: `[Migrated AIOps v2] ${name}`,
        description: `Migrated from New Relic AIOps workflow v2 "${name}".`,
        isPrivate: false,
        trigger: davisProblemTrigger(ALL_MIGRATED_PROBLEMS_FILTER, { entityTags, active }),
        // Gen3 Automation API requires `tasks` as a dict keyed by task id.
        tasks: tasksListToDict(tasks),
      };

      return success({ workflow, notificationTaskStubs, mutingRuleDql, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAllV2(
    inputs: NRAIOpsWorkflowV2Input[],
  ): TransformResult<AIOpsTransformData>[] {
    return inputs.map((i) => this.transformV2(i));
  }
}
