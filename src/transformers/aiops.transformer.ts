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

const enrichmentCompiler = new NRQLCompiler();

function compileEnrichmentNrql(nrql: string): { dql: string; confidence: string; warnings: string[] } {
  const trimmed = (nrql ?? '').trim();
  if (!trimmed) {
    return {
      dql: 'fetch events, from:-1h',
      confidence: 'LOW',
      warnings: ['Empty enrichment NRQL — emitted a default `fetch events` placeholder.'],
    };
  }
  const result = enrichmentCompiler.compile(trimmed);
  if (!result.success) {
    return {
      dql: `// NRQL source: ${trimmed}\n// compiler error: ${result.error}\nfetch events, from:-1h`,
      confidence: 'LOW',
      warnings: [
        `Enrichment NRQL failed to compile (${result.error}); emitted a placeholder. Rewrite the query manually.`,
      ],
    };
  }
  return {
    dql: result.dql,
    confidence: result.confidence,
    warnings: result.warnings,
  };
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

export interface DTAiopsWorkflow {
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
          readonly minSeverity: 'AVAILABILITY' | 'ERROR' | 'PERFORMANCE' | 'CUSTOM' | 'ALL';
        };
      };
    };
  };
  readonly tasks: DTWorkflowEnrichment[];
  readonly notificationTaskStubs: Array<{ channelType: string; taskName: string }>;
  readonly mutingRuleDql: string[];
}

export interface AIOpsTransformData {
  readonly workflow: DTAiopsWorkflow;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_TO_MIN_SEVERITY: Record<
  NonNullable<NRAIOpsWorkflowInput['issuesFilter']>['priority'] & string,
  DTAiopsWorkflow['trigger']['event']['config']['davisProblem']['minSeverity']
> = {
  CRITICAL: 'ERROR',
  HIGH: 'ERROR',
  MEDIUM: 'PERFORMANCE',
  LOW: 'CUSTOM',
};

const MANUAL_STEPS: string[] = [
  'Wire NotificationTransformer output into `workflow.tasks` for each destination channel to complete the AIOps workflow.',
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

      const minSeverity = input.issuesFilter?.priority
        ? PRIORITY_TO_MIN_SEVERITY[input.issuesFilter.priority]
        : 'ALL';

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
        trigger: {
          event: {
            active: input.enabled ?? true,
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
                entityTags: input.issuesFilter?.entityTags ?? {},
                entityTagsMatch: 'all',
                minSeverity,
              },
            },
          },
        },
        tasks,
        notificationTaskStubs,
        mutingRuleDql,
      };

      return success({ workflow, manualSteps: MANUAL_STEPS }, [...warnings, ...MANUAL_STEPS]);
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

      // Derive entityTags + minSeverity from the v2 predicate list.
      const entityTags: Record<string, string> = {};
      let minSeverity: DTAiopsWorkflow['trigger']['event']['config']['davisProblem']['minSeverity'] =
        'ALL';

      for (const p of input.issuesFilter?.predicates ?? []) {
        if (p.attribute.startsWith('labels.') || p.attribute.startsWith('tags.')) {
          const key = p.attribute.replace(/^(labels|tags)\./, '');
          if (p.operator === 'EQUAL' && p.values.length > 0) {
            entityTags[key] = p.values[0]!;
          }
        } else if (p.attribute === 'priority' && p.values.length > 0) {
          const pri = p.values[0];
          if (pri === 'CRITICAL' || pri === 'HIGH') minSeverity = 'ERROR';
          else if (pri === 'MEDIUM') minSeverity = 'PERFORMANCE';
          else if (pri === 'LOW') minSeverity = 'CUSTOM';
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
        trigger: {
          event: {
            active,
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
                minSeverity,
              },
            },
          },
        },
        tasks,
        notificationTaskStubs,
        mutingRuleDql,
      };

      return success({ workflow, manualSteps: MANUAL_STEPS }, [
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
