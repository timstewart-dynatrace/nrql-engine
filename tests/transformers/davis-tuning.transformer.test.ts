import { describe, it, expect, beforeEach } from 'vitest';
import { DavisTuningTransformer } from '../../src/transformers/index.js';

describe('DavisTuningTransformer', () => {
  let transformer: DavisTuningTransformer;

  beforeEach(() => {
    transformer = new DavisTuningTransformer();
  });

  it('should fail on empty rules', () => {
    const result = transformer.transform({ rules: [] });
    expect(result.success).toBe(false);
  });

  it('should emit Davis anomaly settings with signal + sensitivity', () => {
    const result = transformer.transform({
      rules: [
        { signal: 'response_time', sensitivity: 'HIGH', entityTags: { env: 'prod' } },
        { signal: 'error_rate', sensitivity: 'LOW' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.settings).toHaveLength(2);
    expect(result.data!.settings[0]!.schemaId).toBe('builtin:anomaly-detection.davis');
    expect(result.data!.settings[0]!.signal).toBe('response_time');
    expect(result.data!.settings[0]!.sensitivity).toBe('HIGH');
    expect(result.data!.settings[0]!.entityTagSelector).toEqual({ env: 'prod' });
  });

  it('should warn on sensitivity=DISABLED with no entity scope', () => {
    const result = transformer.transform({
      rules: [{ signal: 'cpu', sensitivity: 'DISABLED' }],
    });
    expect(result.warnings.some((w) => w.includes('entire tenant'))).toBe(true);
  });

  it('should not warn when DISABLED has an entity scope', () => {
    const result = transformer.transform({
      rules: [
        {
          signal: 'cpu',
          sensitivity: 'DISABLED',
          entityTags: { lifecycle: 'poc' },
        },
      ],
    });
    expect(result.warnings.some((w) => w.includes('entire tenant'))).toBe(false);
  });

  it('should carry custom display name', () => {
    const result = transformer.transform({
      rules: [
        {
          name: 'Suppress cpu spikes on POC boxes',
          signal: 'cpu',
          sensitivity: 'LOW',
          entityTags: { lifecycle: 'poc' },
        },
      ],
    });
    expect(result.data!.settings[0]!.displayName).toBe(
      'Suppress cpu spikes on POC boxes',
    );
  });

  it('should cover all 7 Davis signals', () => {
    const signals = [
      'response_time',
      'error_rate',
      'throughput',
      'cpu',
      'memory',
      'disk',
      'network',
    ] as const;
    for (const signal of signals) {
      const result = transformer.transform({
        rules: [{ signal, sensitivity: 'MEDIUM', entityTags: { env: 'prod' } }],
      });
      expect(result.data!.settings[0]!.signal).toBe(signal);
    }
  });
});
