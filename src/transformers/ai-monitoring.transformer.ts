/**
 * AI Monitoring Transformer — Converts NR AI Monitoring / MLM
 * (Machine Learning Monitoring) config to Dynatrace AI Observability.
 *
 * NR side emits:
 *   - LLM / ML model registry entries (model id, provider, version)
 *   - Prompt-response events (typically via `record_custom_event`)
 *   - Inference metrics (latency, token count, cost)
 *
 * DT side: AI Observability ingests prompt/response pairs as bizevents
 * with `event.type == "dt.ai.inference"` plus a set of DT AIO
 * conventions (`ai.model.name`, `ai.model.vendor`, `ai.tokens.prompt`,
 * `ai.tokens.completion`). This transformer emits:
 *   - A model-registry mapping
 *   - Bizevent ingest-rule config that renames NR attributes to DT AIO
 *     conventions
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRAiModelVendor =
  | 'openai'
  | 'anthropic'
  | 'bedrock'
  | 'vertex'
  | 'azure_openai'
  | 'cohere'
  | 'huggingface'
  | 'custom';

export interface NRAiModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly vendor: NRAiModelVendor;
  readonly version?: string;
  readonly deployment?: string;
}

export interface NRAiAttributeMapping {
  readonly nrAttribute: string;
  readonly dtAttribute: string;
}

export interface NRAiMonitoringInput {
  readonly applicationName?: string;
  readonly models: NRAiModelEntry[];
  readonly attributeMappings?: NRAiAttributeMapping[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTAiModelRegistryEntry {
  readonly schemaId: 'builtin:ai.observability.model-registry';
  readonly id: string;
  readonly displayName: string;
  readonly vendor: NRAiModelVendor;
  readonly version: string | undefined;
  readonly deployment: string | undefined;
}

export interface DTAiBizeventIngestRule {
  readonly schemaId: 'builtin:openpipeline.bizevents.pipelines';
  readonly displayName: string;
  readonly matcher: string;
  readonly fieldsAdd: Array<{ field: string; value: string }>;
  readonly fieldsRename: Array<{ from: string; to: string }>;
}

export interface AiMonitoringTransformData {
  readonly models: DTAiModelRegistryEntry[];
  readonly bizeventIngest: DTAiBizeventIngestRule;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// DT AIO default attribute renames
// ---------------------------------------------------------------------------

const DEFAULT_ATTR_MAP: Record<string, string> = {
  model_name: 'ai.model.name',
  model: 'ai.model.name',
  vendor: 'ai.model.vendor',
  provider: 'ai.model.vendor',
  prompt: 'ai.prompt',
  response: 'ai.response',
  completion: 'ai.completion',
  prompt_tokens: 'ai.tokens.prompt',
  completion_tokens: 'ai.tokens.completion',
  total_tokens: 'ai.tokens.total',
  latency_ms: 'ai.latency.ms',
  cost_usd: 'ai.cost.usd',
  temperature: 'ai.params.temperature',
  top_p: 'ai.params.top_p',
};

const MANUAL_STEPS: string[] = [
  'DT AI Observability expects `event.type == "dt.ai.inference"` on incoming bizevents; the emitted ingest rule tags each event accordingly.',
  'Prompt / response payloads can be very large — configure an OpenPipeline masking stage (LogObfuscationTransformer) before AIO ingest if you have PII in prompts.',
  'Token-cost enrichment (cost_usd) depends on the DT-side model registry having the right per-token price; verify after import.',
  'If NR MLM used custom embeddings drift detection, DT offers drift via Davis AI on the ingested `ai.embedding.*` attributes — re-validate thresholds.',
];

// ---------------------------------------------------------------------------
// AiMonitoringTransformer
// ---------------------------------------------------------------------------

export class AiMonitoringTransformer {
  transform(input: NRAiMonitoringInput): TransformResult<AiMonitoringTransformData> {
    try {
      if (!Array.isArray(input.models) || input.models.length === 0) {
        return failure(['At least one model entry is required']);
      }
      const warnings: string[] = [];

      const models: DTAiModelRegistryEntry[] = input.models.map((m) => ({
        schemaId: 'builtin:ai.observability.model-registry',
        id: m.id,
        displayName: m.name ?? m.id,
        vendor: m.vendor,
        version: m.version,
        deployment: m.deployment,
      }));

      // Merge default attr map with caller overrides (caller wins).
      const mergedMap: Record<string, string> = { ...DEFAULT_ATTR_MAP };
      for (const am of input.attributeMappings ?? []) {
        mergedMap[am.nrAttribute] = am.dtAttribute;
      }

      const fieldsRename = Object.entries(mergedMap).map(([from, to]) => ({
        from,
        to,
      }));

      const appFilter = input.applicationName
        ? ` and matchesValue(application.name, "${input.applicationName}")`
        : '';

      const bizeventIngest: DTAiBizeventIngestRule = {
        schemaId: 'builtin:openpipeline.bizevents.pipelines',
        displayName: `[Migrated AIO] ${input.applicationName ?? 'nr-ai-monitoring'}`,
        matcher: `matchesValue(event.type, "LlmInference")${appFilter}`,
        fieldsAdd: [
          { field: 'event.type', value: 'dt.ai.inference' },
          { field: 'nr.migrated', value: 'true' },
        ],
        fieldsRename,
      };

      if (models.some((m) => m.vendor === 'custom')) {
        warnings.push(
          'One or more models have vendor="custom" — DT AIO requires a known vendor for token-cost enrichment. Classify the custom models post-migration.',
        );
      }

      return success(
        { models, bizeventIngest, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRAiMonitoringInput[],
  ): TransformResult<AiMonitoringTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
