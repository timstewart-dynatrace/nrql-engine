import { describe, it, expect, beforeEach } from 'vitest';
import { LogObfuscationTransformer } from '../../src/transformers/index.js';

describe('LogObfuscationTransformer', () => {
  let transformer: LogObfuscationTransformer;

  beforeEach(() => {
    transformer = new LogObfuscationTransformer();
  });

  it('should fail on empty input', () => {
    const result = transformer.transform([]);
    expect(result.success).toBe(false);
  });

  it('should emit a masking stage with a rule for each built-in category', () => {
    const result = transformer.transform([
      { category: 'EMAIL' },
      { category: 'SSN' },
      { category: 'CREDIT_CARD' },
      { category: 'PHONE' },
      { category: 'IP_ADDRESS' },
    ]);
    expect(result.success).toBe(true);
    expect(result.data!.maskingStage.schemaId).toBe('builtin:openpipeline.logs.pipelines');
    expect(result.data!.maskingStage.stage).toBe('masking');
    expect(result.data!.maskingStage.rules).toHaveLength(5);
    expect(result.data!.maskingStage.rules[0]!.pattern).toContain('@');
  });

  it('should default replacement to ***', () => {
    const result = transformer.transform([{ category: 'EMAIL' }]);
    expect(result.data!.maskingStage.rules[0]!.replacement).toBe('***');
  });

  it('should honor explicit replacement override', () => {
    const result = transformer.transform([
      { category: 'EMAIL', replacement: '[redacted-email]' },
    ]);
    expect(result.data!.maskingStage.rules[0]!.replacement).toBe('[redacted-email]');
  });

  it('should warn and skip CUSTOM rules missing regex', () => {
    const result = transformer.transform([{ category: 'CUSTOM', name: 'badrule' }]);
    expect(result.data!.maskingStage.rules).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('badrule'))).toBe(true);
  });

  it('should accept CUSTOM rules with regex', () => {
    const result = transformer.transform([
      { category: 'CUSTOM', name: 'apikey', regex: 'apikey=[A-Za-z0-9]+' },
    ]);
    expect(result.data!.maskingStage.rules).toHaveLength(1);
    expect(result.data!.maskingStage.rules[0]!.pattern).toBe('apikey=[A-Za-z0-9]+');
  });

  it('should warn on advanced PCRE features in custom regex', () => {
    const result = transformer.transform([
      { category: 'CUSTOM', name: 'lookbehind', regex: '(?<=secret=)\\w+' },
    ]);
    expect(result.warnings.some((w) => w.includes('lookbehind'))).toBe(true);
  });

  it('should set enabled=true by default and honor explicit false', () => {
    const result = transformer.transform([
      { category: 'EMAIL' },
      { category: 'SSN', enabled: false },
    ]);
    expect(result.data!.maskingStage.rules[0]!.enabled).toBe(true);
    expect(result.data!.maskingStage.rules[1]!.enabled).toBe(false);
  });
});
