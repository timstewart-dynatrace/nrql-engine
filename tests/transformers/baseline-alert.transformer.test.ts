import { describe, it, expect, beforeEach } from 'vitest';
import { BaselineAlertTransformer } from '../../src/transformers/index.js';

describe('BaselineAlertTransformer', () => {
  let transformer: BaselineAlertTransformer;

  beforeEach(() => {
    transformer = new BaselineAlertTransformer();
  });

  it('should emit Davis anomaly detector for BASELINE kind', () => {
    const result = transformer.transform({
      kind: 'BASELINE',
      name: 'Slow baseline',
      nrql: { query: 'SELECT average(duration) FROM Transaction' },
      direction: 'UPPER_ONLY',
      sensitivity: 'HIGH',
      trainingWindowSeconds: 14 * 86400,
      policyName: 'Prod SLA',
    });
    expect(result.success).toBe(true);
    const d = result.data!.detector;
    expect(d.schemaId).toBe('builtin:davis.anomaly-detectors');
    expect(d.detectorKind).toBe('BASELINE');
    expect(d.direction).toBe('ABOVE');
    expect(d.sensitivity).toBe('HIGH');
    expect(d.trainingPeriod).toBe('P14D');
    expect(d.entityTags['nr-migrated']).toBe('prod-sla-slow-baseline');
  });

  it('should map direction LOWER_ONLY → BELOW and UPPER_AND_LOWER → BOTH', () => {
    const below = transformer.transform({
      kind: 'BASELINE',
      nrql: { query: 'q' },
      direction: 'LOWER_ONLY',
    });
    expect(below.data!.detector.direction).toBe('BELOW');

    const both = transformer.transform({
      kind: 'BASELINE',
      nrql: { query: 'q' },
      direction: 'UPPER_AND_LOWER',
    });
    expect(both.data!.detector.direction).toBe('BOTH');
  });

  it('should emit OUTLIER detector kind', () => {
    const result = transformer.transform({
      kind: 'OUTLIER',
      nrql: { query: 'q' },
    });
    expect(result.data!.detector.detectorKind).toBe('OUTLIER');
  });

  it('should embed original NRQL as comment in DQL placeholder', () => {
    const result = transformer.transform({
      kind: 'BASELINE',
      nrql: { query: 'SELECT average(duration) FROM Transaction' },
    });
    expect(result.data!.detector.dql).toContain('NRQL source:');
    expect(result.data!.detector.dql).toContain('SELECT average(duration)');
    expect(result.data!.detector.dql).toContain('TODO');
  });

  it('should default training period to P7D when unset', () => {
    const result = transformer.transform({ kind: 'BASELINE', nrql: { query: 'q' } });
    expect(result.data!.detector.trainingPeriod).toBe('P7D');
  });

  it('should warn and disable when NRQL is missing', () => {
    const result = transformer.transform({ kind: 'BASELINE' });
    expect(result.warnings.some((w) => w.includes('no NRQL source'))).toBe(true);
    expect(result.data!.detector.enabled).toBe(false);
  });

  it('should default sensitivity to MEDIUM', () => {
    const result = transformer.transform({ kind: 'BASELINE', nrql: { query: 'q' } });
    expect(result.data!.detector.sensitivity).toBe('MEDIUM');
  });
});
