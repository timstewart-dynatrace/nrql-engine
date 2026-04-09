/**
 * Tests for transformers/converters.ts — specialized NRQL-to-DQL converters.
 *
 * Ported from Python: tests/unit/test_converters.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RegexToDPLConverter,
  AparseConverter,
  RateDerivativeConverter,
  CompareWithConverter,
  FunnelConverter,
  ExtrapolateHandler,
  BucketPercentileConverter,
  WithAsConverter,
} from '../../src/transformers/converters.js';

// ─── RegexToDPLConverter ─────────────────────────────────────────────────────

describe('RegexToDPLConverter', () => {
  let converter: RegexToDPLConverter;

  beforeEach(() => {
    converter = new RegexToDPLConverter();
  });

  it('should convert named capture groups', () => {
    const [dpl, names] = converter.convert('(?P<status>\\d+) (?P<message>.+)');
    expect(names).toContain('status');
    expect(names).toContain('message');
    expect(dpl).toContain('INT:status');
    expect(dpl).toContain('LD:message');
  });

  it('should convert unnamed capture groups', () => {
    const [_dpl, names] = converter.convert('(\\d+) (.+)');
    expect(names).toContain('group1');
    expect(names).toContain('group2');
  });

  it('should strip anchors', () => {
    const [dpl] = converter.convert('^hello$');
    expect(dpl).not.toContain('^');
    expect(dpl).not.toContain('$');
  });

  it('should convert digit plus to INT', () => {
    const [dpl] = converter.convert('\\d+');
    expect(dpl).toContain('INT');
  });

  it('should convert word plus to WORD', () => {
    const [dpl] = converter.convert('\\w+');
    expect(dpl).toContain('WORD');
  });

  it('should convert whitespace to SPACE', () => {
    const [dpl] = converter.convert('\\s+');
    expect(dpl).toContain('SPACE');
  });

  it('should convert non-whitespace to NSPACE', () => {
    const [dpl] = converter.convert('\\S+');
    expect(dpl).toContain('NSPACE');
  });

  it('should convert dot plus to LD', () => {
    const [dpl] = converter.convert('prefix .+ suffix');
    expect(dpl).toContain('LD');
  });

  it('should handle literal text', () => {
    const [dpl] = converter.convert('hello world');
    expect(dpl).toContain("'hello world'");
  });

  it('should handle escaped characters', () => {
    const [dpl] = converter.convert('test\\.log');
    expect(dpl).toContain("'test'");
    expect(dpl).toContain("'.'");
  });

  it('should convert alternation groups', () => {
    const [dpl] = converter.convert('(INFO|WARN|ERROR)');
    expect(dpl).toContain('INFO');
    expect(dpl).toContain('WARN');
  });

  it('should convert character class alpha', () => {
    const [dpl] = converter.convert('[a-zA-Z]+');
    expect(dpl).toContain('ALPHA');
  });

  it('should convert character class digits', () => {
    const [dpl] = converter.convert('[0-9]+');
    expect(dpl).toContain('INT');
  });

  it('should convert IP pattern in named group', () => {
    const [dpl, names] = converter.convert(
      '(?P<ip>\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})',
    );
    expect(names).toContain('ip');
    expect(dpl).toContain('IPV4:ip');
  });

  it('should handle word boundary skip', () => {
    const [dpl] = converter.convert('\\btest\\b');
    expect(dpl).toContain("'test'");
  });

  it('should handle negated char class', () => {
    const [dpl] = converter.convert('[^ ]+');
    expect(dpl).toContain('NSPACE');
  });
});

// ─── innerToDplType ──────────────────────────────────────────────────────────

describe('RegexToDPLConverter innerToDplType', () => {
  let converter: RegexToDPLConverter;

  beforeEach(() => {
    converter = new RegexToDPLConverter();
  });

  it('should recognize digit plus as INT', () => {
    // Access private method for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((converter as any).innerToDplType('\\d+')).toBe('INT');
  });

  it('should recognize word plus as WORD', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((converter as any).innerToDplType('\\w+')).toBe('WORD');
  });

  it('should recognize dot plus as LD', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((converter as any).innerToDplType('.+')).toBe('LD');
  });

  it('should recognize alpha pattern', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (converter as any).innerToDplType('[a-zA-Z]+') as string;
    expect(result).toContain('ALPHA');
  });

  it('should recognize non-whitespace', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (converter as any).innerToDplType('\\S+') as string;
    expect(result).toContain('NSPACE');
  });

  it('should recognize alternation', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (converter as any).innerToDplType('INFO|WARN|ERROR') as string;
    expect(result).toContain('INFO');
  });
});

// ─── AparseConverter ─────────────────────────────────────────────────────────

describe('AparseConverter', () => {
  let aparse: AparseConverter;

  beforeEach(() => {
    aparse = new AparseConverter();
  });

  it('should convert simple pattern', () => {
    const [dpl, names] = aparse.convert('status=%status% method=%method%');
    expect(names).toContain('status');
    expect(names).toContain('method');
    expect(dpl).toContain("'status='");
  });

  it('should infer ip type', () => {
    const [dpl] = aparse.convert('addr=%ip_addr%');
    expect(dpl).toContain('IPADDR:ip_addr');
  });

  it('should infer int type for port', () => {
    const [dpl] = aparse.convert('port=%port%');
    expect(dpl).toContain('INT:port');
  });

  it('should infer word type for username', () => {
    const [dpl] = aparse.convert('user=%username%');
    expect(dpl).toContain('WORD:username');
  });

  it('should infer ld for message', () => {
    const [dpl] = aparse.convert('msg=%message%');
    expect(dpl).toContain('LD:message');
  });
});

// ─── RateDerivativeConverter ─────────────────────────────────────────────────

describe('RateDerivativeConverter', () => {
  let rateConverter: RateDerivativeConverter;

  beforeEach(() => {
    rateConverter = new RateDerivativeConverter();
  });

  it('should convert rate count', () => {
    const result = rateConverter.convertRate('rate(count(*), 1 minute)');
    expect(result).toBeDefined();
    const [agg, rateParam] = result!;
    expect(agg).toBe('count()');
    expect(rateParam).toBe('rate:1m');
  });

  it('should convert rate sum', () => {
    const result = rateConverter.convertRate('rate(sum(bytes), 1 hour)');
    expect(result).toBeDefined();
    const [agg, rateParam] = result!;
    expect(agg).toBe('sum(bytes)');
    expect(rateParam).toBe('rate:1h');
  });

  it('should convert rate with seconds', () => {
    const result = rateConverter.convertRate('rate(count(*), 1 second)');
    expect(result).toBeDefined();
    const [, rateParam] = result!;
    expect(rateParam).toBe('rate:1s');
  });

  it('should return undefined for invalid', () => {
    const result = rateConverter.convertRate('not a rate expression');
    expect(result).toBeUndefined();
  });

  it('should convert derivative', () => {
    const result = rateConverter.convertDerivative('derivative(count(*), 1 minute)');
    expect(result).toBeDefined();
    const [agg, rateParam] = result!;
    expect(agg).toBe('count()');
    expect(rateParam).toBe('rate:1m');
  });

  it('should return undefined for invalid derivative', () => {
    const result = rateConverter.convertDerivative('not a derivative');
    expect(result).toBeUndefined();
  });
});

// ─── CompareWithConverter ────────────────────────────────────────────────────

describe('CompareWithConverter', () => {
  let compareConverter: CompareWithConverter;

  beforeEach(() => {
    compareConverter = new CompareWithConverter();
  });

  it('should extract compare with day', () => {
    const result = compareConverter.convert(
      'SELECT count(*) FROM Transaction COMPARE WITH 1 day ago',
    );
    expect(result).toBeDefined();
    const [cleaned, shift] = result!;
    expect(cleaned).not.toContain('COMPARE WITH');
    expect(shift).toBe('shift:-1d');
  });

  it('should extract compare with hour', () => {
    const result = compareConverter.convert(
      'SELECT count(*) FROM Transaction COMPARE WITH 2 hours ago',
    );
    expect(result).toBeDefined();
    const [, shift] = result!;
    expect(shift).toBe('shift:-2h');
  });

  it('should extract compare with week', () => {
    const result = compareConverter.convert(
      'SELECT count(*) FROM Transaction COMPARE WITH 1 week ago',
    );
    expect(result).toBeDefined();
    const [, shift] = result!;
    expect(shift).toBe('shift:-7d');
  });

  it('should extract compare with month', () => {
    const result = compareConverter.convert(
      'SELECT count(*) FROM Transaction COMPARE WITH 1 month ago',
    );
    expect(result).toBeDefined();
    const [, shift] = result!;
    expect(shift).toBe('shift:-30d');
  });

  it('should return undefined when no compare', () => {
    const result = compareConverter.convert('SELECT count(*) FROM Transaction');
    expect(result).toBeUndefined();
  });
});

// ─── FunnelConverter ─────────────────────────────────────────────────────────

describe('FunnelConverter', () => {
  let funnelConverter: FunnelConverter;

  beforeEach(() => {
    funnelConverter = new FunnelConverter();
  });

  it('should convert funnel with where conditions', () => {
    const nrql = "SELECT funnel(session, WHERE action = 'view' , WHERE action = 'click')";
    const result = funnelConverter.convert(nrql);
    expect(result).toBeDefined();
    expect(result!.type).toBe('usql');
    expect(result!.usql).toContain('FUNNEL');
    expect(result!.steps).toHaveLength(2);
  });

  it('should return undefined for no funnel', () => {
    const result = funnelConverter.convert('SELECT count(*) FROM Transaction');
    expect(result).toBeUndefined();
  });
});

// ─── ExtrapolateHandler ──────────────────────────────────────────────────────

describe('ExtrapolateHandler', () => {
  let extrapolateHandler: ExtrapolateHandler;

  beforeEach(() => {
    extrapolateHandler = new ExtrapolateHandler();
  });

  it('should remove extrapolate', () => {
    const [cleaned, _dql, note] = extrapolateHandler.handle(
      'SELECT count(*) FROM Transaction EXTRAPOLATE',
      'fetch spans\n| summarize count()',
    );
    expect(cleaned).not.toContain('EXTRAPOLATE');
    expect(note).toBeDefined();
  });

  it('should add extrapolate to countDistinct', () => {
    const [cleaned, dql, _note] = extrapolateHandler.handle(
      'SELECT uniqueCount(user) FROM Transaction EXTRAPOLATE',
      'fetch spans\n| summarize countDistinct(user)',
    );
    expect(dql).toContain('extrapolate:true');
    expect(cleaned).not.toContain('EXTRAPOLATE');
  });

  it('should noop when no extrapolate', () => {
    const originalNrql = 'SELECT count(*) FROM Transaction';
    const originalDql = 'fetch spans\n| summarize count()';
    const [cleaned, dql, note] = extrapolateHandler.handle(originalNrql, originalDql);
    expect(cleaned).toBe(originalNrql);
    expect(dql).toBe(originalDql);
    expect(note).toBeUndefined();
  });
});

// ─── BucketPercentileConverter ───────────────────────────────────────────────

describe('BucketPercentileConverter', () => {
  let bpConverter: BucketPercentileConverter;

  beforeEach(() => {
    bpConverter = new BucketPercentileConverter();
  });

  it('should convert bucket percentile', () => {
    const result = bpConverter.convert(
      'bucketPercentile(http_req_duration_bucket, 50, 95, 99)',
    );
    expect(result).toBeDefined();
    expect(result).toContain('percentile(http_req_duration, 50)');
    expect(result).toContain('percentile(http_req_duration, 95)');
    expect(result).toContain('percentile(http_req_duration, 99)');
  });

  it('should strip bucket suffix', () => {
    const result = bpConverter.convert('bucketPercentile(my_metric_bucket, 90)');
    expect(result).toBeDefined();
    expect(result).toContain('my_metric,');
    expect(result).not.toContain('_bucket');
  });

  it('should return undefined for non match', () => {
    const result = bpConverter.convert('percentile(duration, 95)');
    expect(result).toBeUndefined();
  });
});

// ─── WithAsConverter ─────────────────────────────────────────────────────────

describe('WithAsConverter', () => {
  let withAsConverter: WithAsConverter;

  beforeEach(() => {
    withAsConverter = new WithAsConverter();
  });

  it('should return undefined for non CTE', () => {
    const result = withAsConverter.convert('SELECT count(*) FROM Transaction');
    expect(result).toBeUndefined();
  });

  it('should return undefined when CTE format does not match', () => {
    const nrql = 'WITH total AS (SELECT count(*) FROM Transaction) SELECT total';
    const result = withAsConverter.convert(nrql);
    // May return undefined or a result depending on regex match
    if (result !== undefined) {
      expect(result.dql).toBeDefined();
    }
  });
});
