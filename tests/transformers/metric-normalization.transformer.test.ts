import { describe, it, expect, beforeEach } from 'vitest';
import { MetricNormalizationTransformer } from '../../src/transformers/index.js';

describe('MetricNormalizationTransformer', () => {
  let transformer: MetricNormalizationTransformer;

  beforeEach(() => {
    transformer = new MetricNormalizationTransformer();
  });

  it('should fail on empty rules', () => {
    const result = transformer.transform({ rules: [] });
    expect(result.success).toBe(false);
  });

  it('should emit a rename processor', () => {
    const result = transformer.transform({
      rules: [
        {
          name: 'rename cpu',
          action: 'RENAME',
          sourceMetric: 'legacy.cpu',
          targetMetric: 'dt.host.cpu.usage',
        },
      ],
    });
    const p = result.data!.processors[0]!;
    expect(p.op).toBe('rename');
    expect(p.targetMetric).toBe('dt.host.cpu.usage');
  });

  it('should warn when RENAME has no targetMetric', () => {
    const result = transformer.transform({
      rules: [{ action: 'RENAME', sourceMetric: 'x' }],
    });
    expect(result.data!.processors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('RENAME'))).toBe(true);
  });

  it('should emit a scale processor with expression', () => {
    const result = transformer.transform({
      rules: [{ action: 'SCALE', sourceMetric: 'bytes_in', scaleFactor: 0.001 }],
    });
    const p = result.data!.processors[0]!;
    expect(p.op).toBe('scale');
    expect(p.expression).toContain('* 0.001');
    expect(p.scaleFactor).toBe(0.001);
  });

  it('should translate CONVERT_UNIT bytes→megabytes to 1/1024^2', () => {
    const result = transformer.transform({
      rules: [
        {
          action: 'CONVERT_UNIT',
          sourceMetric: 'mem.used',
          fromUnit: 'bytes',
          toUnit: 'megabytes',
        },
      ],
    });
    const p = result.data!.processors[0]!;
    expect(p.op).toBe('convertUnit');
    expect(p.unitConversion).toEqual({ from: 'bytes', to: 'megabytes' });
    expect(p.scaleFactor).toBeCloseTo(1 / 1024 / 1024, 10);
  });

  it('should emit a disabled TODO processor for unknown unit pair', () => {
    const result = transformer.transform({
      rules: [
        {
          action: 'CONVERT_UNIT',
          sourceMetric: 'x',
          fromUnit: 'zots',
          toUnit: 'gigazots',
        },
      ],
    });
    const p = result.data!.processors[0]!;
    expect(p.enabled).toBe(false);
    expect(p.expression).toContain('TODO');
    expect(result.warnings.some((w) => w.includes('zots→gigazots'))).toBe(true);
  });

  it('should emit DERIVE processor with expression', () => {
    const result = transformer.transform({
      rules: [
        {
          action: 'DERIVE',
          sourceMetric: 'any',
          targetMetric: 'req.error_ratio',
          deriveExpression: 'errors.count / requests.total',
        },
      ],
    });
    const p = result.data!.processors[0]!;
    expect(p.op).toBe('derive');
    expect(p.expression).toBe('errors.count / requests.total');
    expect(p.targetMetric).toBe('req.error_ratio');
  });
});
