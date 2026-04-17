import { describe, it, expect, beforeEach } from 'vitest';
import { AiMonitoringTransformer } from '../../src/transformers/index.js';

describe('AiMonitoringTransformer', () => {
  let transformer: AiMonitoringTransformer;

  beforeEach(() => {
    transformer = new AiMonitoringTransformer();
  });

  it('should fail when no models supplied', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({ models: [] as any });
    expect(result.success).toBe(false);
  });

  it('should emit model registry entries with correct schema', () => {
    const result = transformer.transform({
      applicationName: 'checkout',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', vendor: 'openai', version: '2024-08-06' },
        { id: 'claude-3-5-sonnet', vendor: 'anthropic' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.models).toHaveLength(2);
    expect(result.data!.models[0]!.schemaId).toBe(
      'builtin:ai.observability.model-registry',
    );
    expect(result.data!.models[0]!.vendor).toBe('openai');
    expect(result.data!.models[0]!.version).toBe('2024-08-06');
  });

  it('should emit bizevent ingest rule tagged dt.ai.inference', () => {
    const result = transformer.transform({
      applicationName: 'checkout',
      models: [{ id: 'gpt-4o', vendor: 'openai' }],
    });
    const r = result.data!.bizeventIngest;
    expect(r.schemaId).toBe('builtin:openpipeline.bizevents.pipelines');
    expect(r.matcher).toContain('LlmInference');
    expect(r.matcher).toContain('application.name, "checkout"');
    expect(r.fieldsAdd).toContainEqual({ field: 'event.type', value: 'dt.ai.inference' });
  });

  it('should rename NR attributes to DT AIO conventions', () => {
    const result = transformer.transform({
      models: [{ id: 'gpt', vendor: 'openai' }],
    });
    const renames = result.data!.bizeventIngest.fieldsRename;
    const byFrom = Object.fromEntries(renames.map((r) => [r.from, r.to]));
    expect(byFrom['prompt_tokens']).toBe('ai.tokens.prompt');
    expect(byFrom['completion_tokens']).toBe('ai.tokens.completion');
    expect(byFrom['model_name']).toBe('ai.model.name');
    expect(byFrom['cost_usd']).toBe('ai.cost.usd');
  });

  it('should allow caller-supplied attribute mappings to override defaults', () => {
    const result = transformer.transform({
      models: [{ id: 'gpt', vendor: 'openai' }],
      attributeMappings: [
        { nrAttribute: 'prompt', dtAttribute: 'custom.prompt.text' },
        { nrAttribute: 'new_attr', dtAttribute: 'ai.custom.new' },
      ],
    });
    const byFrom = Object.fromEntries(
      result.data!.bizeventIngest.fieldsRename.map((r) => [r.from, r.to]),
    );
    expect(byFrom['prompt']).toBe('custom.prompt.text');
    expect(byFrom['new_attr']).toBe('ai.custom.new');
  });

  it('should warn on vendor=custom', () => {
    const result = transformer.transform({
      models: [{ id: 'proprietary-v1', vendor: 'custom' }],
    });
    expect(result.warnings.some((w) => w.includes('custom'))).toBe(true);
  });

  it('should omit application filter when applicationName unset', () => {
    const result = transformer.transform({
      models: [{ id: 'gpt', vendor: 'openai' }],
    });
    expect(result.data!.bizeventIngest.matcher).not.toContain('application.name');
  });

  it('should emit manual steps about PII masking + cost enrichment', () => {
    const result = transformer.transform({
      models: [{ id: 'gpt', vendor: 'openai' }],
    });
    expect(result.data!.manualSteps.some((m) => m.includes('PII'))).toBe(true);
    expect(result.data!.manualSteps.some((m) => /[Tt]oken-cost/.test(m))).toBe(true);
  });
});
