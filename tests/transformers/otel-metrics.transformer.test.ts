import { describe, it, expect, beforeEach } from 'vitest';
import { OpenTelemetryMetricsTransformer } from '../../src/transformers/index.js';

describe('OpenTelemetryMetricsTransformer', () => {
  let transformer: OpenTelemetryMetricsTransformer;

  beforeEach(() => {
    transformer = new OpenTelemetryMetricsTransformer();
  });

  it('should emit grpc exporter with DELTA default', () => {
    const result = transformer.transform({
      name: 'app-metrics',
      endpoint: 'https://otlp.nr-data.net:4317',
      resourceAttributes: {
        'service.name': 'checkout',
        'service.instance.id': 'pod-abc',
      },
    });
    expect(result.success).toBe(true);
    expect(result.data!.exporter.protocol).toBe('grpc');
    expect(result.data!.exporter.endpoint).toContain('/api/v2/otlp');
    expect(result.data!.exporter.temporality).toBe('DELTA');
    expect(result.data!.exporter.histogramLayout).toBe('EXPONENTIAL');
  });

  it('should emit http endpoint when protocol=http', () => {
    const result = transformer.transform({
      endpoint: 'x',
      protocol: 'http',
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.data!.exporter.endpoint).toContain('/v1/metrics');
  });

  it('should warn on CUMULATIVE temporality', () => {
    const result = transformer.transform({
      endpoint: 'x',
      temporality: 'CUMULATIVE',
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.warnings.some((w) => w.includes('CUMULATIVE'))).toBe(true);
  });

  it('should warn on EXPLICIT_BUCKET histogram layout', () => {
    const result = transformer.transform({
      endpoint: 'x',
      histogramLayout: 'EXPLICIT_BUCKET',
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.warnings.some((w) => w.includes('EXPONENTIAL'))).toBe(true);
  });

  it('should warn on missing service.name / service.instance.id', () => {
    const result = transformer.transform({ endpoint: 'x' });
    expect(result.warnings.some((w) => w.includes('service.name'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('service.instance.id'))).toBe(true);
  });

  it('should warn when endpoint is missing', () => {
    const result = transformer.transform({
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.warnings.some((w) => w.includes('endpoint not provided'))).toBe(true);
  });

  it('should emit ingest settings with PASSTHROUGH policy', () => {
    const result = transformer.transform({
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.data!.ingestSettings.schemaId).toBe('builtin:otel.metrics.ingest');
    expect(result.data!.ingestSettings.resourceAttributePolicy).toBe('PASSTHROUGH');
  });

  it('should include semconv guidance bullets', () => {
    const result = transformer.transform({
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.data!.semconvGuidance.length).toBeGreaterThan(0);
    expect(result.data!.semconvGuidance.some((g) => g.includes('service.name'))).toBe(true);
  });

  it('should default export interval to 60 seconds', () => {
    const result = transformer.transform({
      resourceAttributes: { 'service.name': 's', 'service.instance.id': 'i' },
    });
    expect(result.data!.exporter.exportIntervalSeconds).toBe(60);
  });
});
