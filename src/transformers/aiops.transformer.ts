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
        tasks.push({
          name: enrich.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          action: 'dynatrace.automations:run-query',
          description: `[Migrated enrichment] ${enrich.name}`,
          active: true,
          input: {
            query: `# NRQL source: ${enrich.nrql}\n# TODO: translate via nrql-engine compiler before use\nfetch events, from:-1h`,
            resultKey: enrich.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          },
        });
        warnings.push(
          `Enrichment '${enrich.name}' carries a TODO DQL placeholder — run the NRQL through the compiler and replace before enabling.`,
        );
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
}
