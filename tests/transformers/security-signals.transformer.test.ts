import { describe, it, expect, beforeEach } from 'vitest';
import { SecuritySignalsTransformer } from '../../src/transformers/index.js';

describe('SecuritySignalsTransformer', () => {
  let transformer: SecuritySignalsTransformer;

  beforeEach(() => {
    transformer = new SecuritySignalsTransformer();
  });

  it('should fail on empty input', () => {
    const result = transformer.transform({ rules: [] });
    expect(result.success).toBe(false);
  });

  it('should emit bizevent rules with event.category=SECURITY', () => {
    const result = transformer.transform({
      rules: [
        { name: 'SQL Injection attempt', signalType: 'SqlInjection', severity: 'HIGH' },
      ],
    });
    expect(result.success).toBe(true);
    const r = result.data!.rules[0]!;
    expect(r.schemaId).toBe('builtin:openpipeline.bizevents.pipelines');
    expect(r.fieldsAdd).toContainEqual({ field: 'event.category', value: 'SECURITY' });
    expect(r.fieldsAdd).toContainEqual({
      field: 'security.signal.type',
      value: 'SqlInjection',
    });
    expect(r.fieldsAdd).toContainEqual({ field: 'security.severity', value: 'HIGH' });
  });

  it('should default severity to INFO when unset', () => {
    const result = transformer.transform({
      rules: [{ name: 'General alert', signalType: 'Info' }],
    });
    expect(
      result.data!.rules[0]!.fieldsAdd.find((f) => f.field === 'security.severity')!.value,
    ).toBe('INFO');
  });

  it('should carry NRQL filter as TODO matcher and warn', () => {
    const result = transformer.transform({
      rules: [
        {
          name: 'PII Exposure',
          signalType: 'PiiLeak',
          nrqlFilter: "match(content, 'ssn')",
        },
      ],
    });
    expect(result.data!.rules[0]!.matcher).toContain('NRQL TODO');
    expect(result.warnings.some((w) => w.includes('PII Exposure'))).toBe(true);
  });

  it('should default enabled to true; honor explicit false', () => {
    const result = transformer.transform({
      rules: [
        { name: 'A', signalType: 'X' },
        { name: 'B', signalType: 'Y', enabled: false },
      ],
    });
    expect(result.data!.rules[0]!.enabled).toBe(true);
    expect(result.data!.rules[1]!.enabled).toBe(false);
  });
});
