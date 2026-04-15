import { describe, it, expect, beforeEach } from 'vitest';
import { PrometheusTransformer } from '../../src/transformers/index.js';

describe('PrometheusTransformer', () => {
  let transformer: PrometheusTransformer;

  beforeEach(() => {
    transformer = new PrometheusTransformer();
  });

  it('should emit DT remote-write endpoint with Api-Token header', () => {
    const result = transformer.transform({
      remoteWriteUrl: 'https://metric-api.newrelic.com/prometheus/v1/write',
    });
    expect(result.success).toBe(true);
    expect(result.data!.remoteWrite.endpoint).toContain('/api/v2/metrics/ingest/prometheus');
    expect(result.data!.remoteWrite.headers.Authorization).toContain('Api-Token');
  });

  it('should emit scrape config when scrape targets are provided', () => {
    const result = transformer.transform({
      name: 'node-exporter',
      scrapeTargets: ['node-exporter:9100', 'kube-state:8080'],
    });
    expect(result.data!.scrapeConfig).toBeDefined();
    expect(result.data!.scrapeConfig!.schemaId).toBe('builtin:prometheus.scrape');
    expect(result.data!.scrapeConfig!.targets).toEqual([
      'node-exporter:9100',
      'kube-state:8080',
    ]);
  });

  it('should omit scrape config when no targets', () => {
    const result = transformer.transform({
      remoteWriteUrl: 'https://metric-api.newrelic.com/prometheus/v1/write',
    });
    expect(result.data!.scrapeConfig).toBeUndefined();
  });

  it('should preserve relabel rules', () => {
    const result = transformer.transform({
      remoteWriteUrl: 'x',
      relabelRules: ['action: keep\nregex: job=.*'],
    });
    expect(result.data!.remoteWrite.relabelRules).toHaveLength(1);
  });

  it('should warn when neither remoteWrite nor scrape targets are provided', () => {
    const result = transformer.transform({});
    expect(result.warnings.some((w) => w.includes('remote_write URL nor scrape'))).toBe(true);
  });

  it('should emit manual steps about metrics.ingest scope + ActiveGate extension', () => {
    const result = transformer.transform({ scrapeTargets: ['x:9100'] });
    expect(result.warnings.some((w) => w.includes('metrics.ingest'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('ActiveGate'))).toBe(true);
  });
});
