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
});
