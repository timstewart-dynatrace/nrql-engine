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

  it('should translate action=drop to OpenPipeline drop matcher', () => {
    const result = transformer.transform({
      relabelConfigs: [
        { action: 'drop', source_labels: ['__name__'], regex: 'go_.*' },
      ],
    });
    expect(result.data!.openPipelineRules).toHaveLength(1);
    const rule = result.data!.openPipelineRules[0]!;
    expect(rule.schemaId).toBe('builtin:openpipeline.metrics.drop');
    expect(rule.matcher).toBe('matchesValue(__name__, "go_.*")');
  });

  it('should translate action=keep to inverse-match drop', () => {
    const result = transformer.transform({
      relabelConfigs: [
        { action: 'keep', source_labels: ['__name__'], regex: '(http|db)_.*' },
      ],
    });
    const rule = result.data!.openPipelineRules[0]!;
    expect(rule.schemaId).toBe('builtin:openpipeline.metrics.drop');
    expect(rule.matcher).toBe('not matchesValue(__name__, "(http|db)_.*")');
  });

  it('should translate action=replace to fieldsAdd transform', () => {
    const result = transformer.transform({
      relabelConfigs: [
        {
          action: 'replace',
          source_labels: ['app'],
          regex: '(.*)',
          target_label: 'service.name',
          replacement: '$1',
        },
      ],
    });
    const rule = result.data!.openPipelineRules[0]!;
    expect(rule.schemaId).toBe('builtin:openpipeline.metrics.transform');
    if (rule.schemaId === 'builtin:openpipeline.metrics.transform') {
      expect(rule.fieldsAdd?.[0]).toEqual({ field: 'service.name', value: '$1' });
    }
  });

  it('should warn when replace is missing target_label', () => {
    const result = transformer.transform({
      relabelConfigs: [{ action: 'replace', source_labels: ['x'], regex: '.*' }],
    });
    expect(result.data!.openPipelineRules).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('missing target_label'))).toBe(true);
  });

  it('should translate action=labeldrop to fieldsRemove', () => {
    const result = transformer.transform({
      relabelConfigs: [{ action: 'labeldrop', regex: 'temp_.*' }],
    });
    const rule = result.data!.openPipelineRules[0]!;
    if (rule.schemaId === 'builtin:openpipeline.metrics.transform') {
      expect(rule.fieldsRemove).toEqual(['temp_.*']);
    }
  });

  it('should translate action=labelkeep with inverse regex', () => {
    const result = transformer.transform({
      relabelConfigs: [{ action: 'labelkeep', regex: 'job|instance' }],
    });
    const rule = result.data!.openPipelineRules[0]!;
    if (rule.schemaId === 'builtin:openpipeline.metrics.transform') {
      expect(rule.fieldsRemove?.[0]).toContain('(?!job|instance');
    }
  });

  it('should translate action=labelmap to fieldsRename', () => {
    const result = transformer.transform({
      relabelConfigs: [
        { action: 'labelmap', regex: '__meta_kubernetes_pod_label_(.+)', replacement: '$1' },
      ],
    });
    const rule = result.data!.openPipelineRules[0]!;
    if (rule.schemaId === 'builtin:openpipeline.metrics.transform') {
      expect(rule.fieldsRename?.[0]).toEqual({
        from: '__meta_kubernetes_pod_label_(.+)',
        to: '$1',
      });
    }
  });

  it('should warn and skip action=hashmod', () => {
    const result = transformer.transform({
      relabelConfigs: [
        { action: 'hashmod', source_labels: ['instance'], modulus: 4 },
      ],
    });
    expect(result.data!.openPipelineRules).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('hashmod'))).toBe(true);
  });

  it('should concat multiple source_labels with separator', () => {
    const result = transformer.transform({
      relabelConfigs: [
        {
          action: 'drop',
          source_labels: ['job', 'instance'],
          separator: ':',
          regex: 'api:foo',
        },
      ],
    });
    const rule = result.data!.openPipelineRules[0]!;
    expect(rule.matcher).toContain('toString(job) + ":" + toString(instance)');
  });
});
