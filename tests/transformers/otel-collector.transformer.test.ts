import { describe, it, expect, beforeEach } from 'vitest';
import { OpenTelemetryCollectorTransformer } from '../../src/transformers/index.js';

describe('OpenTelemetryCollectorTransformer', () => {
  let transformer: OpenTelemetryCollectorTransformer;

  beforeEach(() => {
    transformer = new OpenTelemetryCollectorTransformer();
  });

  it('should emit grpc OTLP exporter by default', () => {
    const result = transformer.transform({
      name: 'otlp-nr',
      endpoint: 'https://otlp.nr-data.net:4317',
      signals: ['traces', 'metrics'],
      resourceAttributes: { 'service.name': 'checkout' },
    });
    expect(result.success).toBe(true);
    expect(result.data!.exporter.protocol).toBe('grpc');
    expect(result.data!.exporter.endpoint).toContain('/api/v2/otlp');
    expect(result.data!.exporter.headers.Authorization).toContain('Api-Token');
    expect(result.data!.exporter.signals).toEqual(['traces', 'metrics']);
    expect(result.data!.exporter.resourceAttributes['service.name']).toBe('checkout');
  });

  it('should emit http endpoint when protocol is http', () => {
    const result = transformer.transform({
      endpoint: 'https://otlp.nr-data.net:4318',
      protocol: 'http',
    });
    expect(result.data!.exporter.endpoint).toContain('/v1');
  });

  it('should default signals to all three', () => {
    const result = transformer.transform({ endpoint: 'https://x.example' });
    expect(result.data!.exporter.signals).toEqual(['traces', 'metrics', 'logs']);
  });

  it('should warn when endpoint is missing', () => {
    const result = transformer.transform({});
    expect(result.warnings.some((w) => w.includes('endpoint not provided'))).toBe(true);
  });

  it('should emit ingest mapping settings stub', () => {
    const result = transformer.transform({ endpoint: 'x', name: 'otlp-x' });
    expect(result.data!.ingestMapping.schemaId).toBe('builtin:otel.ingest-mappings');
    expect(result.data!.ingestMapping.serviceNameSource).toBe(
      'resourceAttributes.service.name',
    );
  });

  it('should emit manual steps about token scopes and env-id', () => {
    const result = transformer.transform({});
    expect(result.warnings.some((w) => w.includes('openTelemetryTrace.ingest'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('<env-id>'))).toBe(true);
  });

  it('should translate an attributes processor with mixed actions', () => {
    const result = transformer.transform({
      processors: [
        {
          kind: 'attributes',
          actions: [
            { key: 'env', action: 'upsert', value: 'prod' },
            { key: 'internal', action: 'delete' },
            { key: 'session.id', action: 'hash' },
          ],
        },
      ],
    });
    const steps = result.data!.processorPipeline;
    expect(steps.some((s) => s.kind === 'fieldsAdd')).toBe(true);
    expect(steps.some((s) => s.kind === 'fieldsRemove')).toBe(true);
    expect(result.warnings.some((w) => w.includes('hash'))).toBe(true);
  });

  it('should translate filter include to a matcher DPL expression', () => {
    const result = transformer.transform({
      processors: [
        { kind: 'filter', match: 'include', expression: 'resource.type == "host"' },
      ],
    });
    const step = result.data!.processorPipeline[0]!;
    expect(step.kind).toBe('filter');
    if (step.kind === 'filter') {
      expect(step.matcher).toBe('resource.type == "host"');
    }
  });

  it('should translate filter exclude by negating the expression', () => {
    const result = transformer.transform({
      processors: [
        { kind: 'filter', match: 'exclude', expression: 'resource.type == "host"' },
      ],
    });
    const step = result.data!.processorPipeline[0]!;
    if (step.kind === 'filter') {
      expect(step.matcher).toBe('not (resource.type == "host")');
    }
  });

  it('should translate batch processor with defaults', () => {
    const result = transformer.transform({
      processors: [{ kind: 'batch' }],
    });
    const step = result.data!.processorPipeline[0]!;
    if (step.kind === 'batch') {
      expect(step.timeoutSeconds).toBe(5);
      expect(step.maxRecords).toBe(8192);
    }
  });

  it('should translate memory_limiter processor with overrides', () => {
    const result = transformer.transform({
      processors: [
        { kind: 'memory_limiter', limitMiB: 1024, checkIntervalSeconds: 2 },
      ],
    });
    const step = result.data!.processorPipeline[0]!;
    if (step.kind === 'memoryLimiter') {
      expect(step.limitMiB).toBe(1024);
      expect(step.checkIntervalSeconds).toBe(2);
    }
  });

  it('should translate resource processor to fieldsAdd', () => {
    const result = transformer.transform({
      processors: [
        {
          kind: 'resource',
          attributes: { 'deployment.environment': 'prod', 'service.owner': 'sre' },
        },
      ],
    });
    const step = result.data!.processorPipeline[0]!;
    if (step.kind === 'fieldsAdd') {
      expect(step.fields).toContainEqual({
        field: 'deployment.environment',
        value: 'prod',
      });
    }
  });

  it('should emit passthrough + warn on unknown processor', () => {
    const result = transformer.transform({
      processors: [{ kind: 'unknown', name: 'custom_newrelic' }],
    });
    const step = result.data!.processorPipeline[0]!;
    expect(step.kind).toBe('passthrough');
    expect(result.warnings.some((w) => w.includes('custom_newrelic'))).toBe(true);
  });

  it('should preserve processor order in emitted pipeline', () => {
    const result = transformer.transform({
      processors: [
        { kind: 'batch' },
        { kind: 'memory_limiter' },
        { kind: 'resource', attributes: { env: 'x' } },
      ],
    });
    const steps = result.data!.processorPipeline;
    expect(steps[0]!.kind).toBe('batch');
    expect(steps[1]!.kind).toBe('memoryLimiter');
    expect(steps[2]!.kind).toBe('fieldsAdd');
  });
});
