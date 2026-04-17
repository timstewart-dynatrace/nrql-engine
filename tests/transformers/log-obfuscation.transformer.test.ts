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

describe('pcreToDpl', () => {
  // Import via relative path handled through index.js barrel.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // We import at module scope above; no separate import needed.

  it('should pass through simple patterns unchanged', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('foo\\d+bar');
    expect(result.dpl).toBe('foo\\d+bar');
    expect(result.unsupportedFeatures).toEqual([]);
  });

  it('should flag lookbehind', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('(?<=secret=)\\w+');
    expect(result.unsupportedFeatures).toContain('lookbehind (?<=…)');
  });

  it('should flag lookahead and negative lookahead', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const positive = pcreToDpl('foo(?=bar)');
    expect(positive.unsupportedFeatures).toContain('lookahead (?=…)');
    const negative = pcreToDpl('foo(?!bar)');
    expect(negative.unsupportedFeatures).toContain('negative lookahead (?!…)');
  });

  it('should flag named and numeric backreferences', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const named = pcreToDpl('(?<x>a)\\k<x>');
    expect(named.unsupportedFeatures).toContain('named backreference \\k<…>');
    const numeric = pcreToDpl('(a)\\1');
    expect(numeric.unsupportedFeatures).toContain('numeric backreference \\N');
  });

  it('should flag Unicode property escapes', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('\\p{L}+');
    expect(result.unsupportedFeatures).toContain('Unicode property escape \\p{…}');
  });

  it('should normalize (?<name>…) to (?P<name>…)', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('(?<user>[a-z]+)@example.com');
    expect(result.dpl).toContain('(?P<user>');
  });

  it('should strip inline flag and warn', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('(?i)hello');
    expect(result.dpl).toBe('hello');
    expect(result.warnings.some((w) => w.includes('Inline flag'))).toBe(true);
  });

  it('should downgrade atomic group to non-capturing and flag', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('(?>foo|bar)');
    expect(result.dpl).toBe('(?:foo|bar)');
    expect(result.unsupportedFeatures).toContain('atomic group (?>…)');
  });

  it('should strip possessive quantifiers and flag', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('a++b');
    expect(result.dpl).toBe('a+b');
    expect(result.unsupportedFeatures).toContain('possessive quantifiers (*+, ++, ?+)');
  });

  it('should surface all flagged features in the warning', async () => {
    const { pcreToDpl } = await import('../../src/transformers/index.js');
    const result = pcreToDpl('(?<=foo)\\p{L}++');
    expect(result.warnings.some((w) => w.includes('lookbehind'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Unicode'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('possessive'))).toBe(true);
  });
});

describe('LogObfuscationTransformer + PCRE translation', () => {
  it('should translate CUSTOM rule using pcreToDpl and surface warnings', async () => {
    const { LogObfuscationTransformer } = await import(
      '../../src/transformers/index.js'
    );
    const t = new LogObfuscationTransformer();
    const result = t.transform([
      { category: 'CUSTOM', name: 'secret', regex: '(?<=secret=)\\w+' },
    ]);
    expect(result.data!.maskingStage.rules).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('secret'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('lookbehind'))).toBe(true);
  });
});
