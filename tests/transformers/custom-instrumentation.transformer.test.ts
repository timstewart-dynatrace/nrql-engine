import { describe, it, expect, beforeEach } from 'vitest';
import { CustomInstrumentationTransformer } from '../../src/transformers/index.js';

describe('CustomInstrumentationTransformer', () => {
  let transformer: CustomInstrumentationTransformer;

  beforeEach(() => {
    transformer = new CustomInstrumentationTransformer();
  });

  it('should return zero suggestions for clean source text', () => {
    const result = transformer.transform({
      language: 'javascript',
      file: 'app.js',
      sourceText: 'console.log("hello");\n',
    });
    expect(result.success).toBe(true);
    expect(result.data!.suggestions).toEqual([]);
  });

  it('should detect JS recordCustomEvent with HIGH confidence', () => {
    const src =
      "newrelic.recordCustomEvent('Checkout', { order: 'abc', amount: 12.5 });";
    const result = transformer.transform({
      language: 'javascript',
      file: 'checkout.js',
      sourceText: src,
    });
    expect(result.data!.suggestions).toHaveLength(1);
    const s = result.data!.suggestions[0]!;
    expect(s.apiCategory).toBe('custom_event');
    expect(s.confidence).toBe('HIGH');
    expect(s.line).toBe(1);
    expect(s.replacement).toContain('/platform/ingest/v1/events.bizevents');
    expect(s.replacement).toContain("'event.type': 'Checkout'");
  });

  it('should detect JS addCustomAttribute + note about SDK import', () => {
    const result = transformer.transform({
      language: 'javascript',
      file: 'x.js',
      sourceText: "newrelic.addCustomAttribute('tier', 'gold');",
    });
    const s = result.data!.suggestions[0]!;
    expect(s.apiCategory).toBe('custom_attribute');
    expect(s.replacement).toContain('addCustomRequestAttribute');
    expect(s.note).toContain('@dynatrace/oneagent-sdk');
  });

  it('should detect JS recordMetric at MEDIUM confidence', () => {
    const result = transformer.transform({
      language: 'javascript',
      file: 'x.js',
      sourceText: "newrelic.recordMetric('Custom/latency', 142);",
    });
    const s = result.data!.suggestions[0]!;
    expect(s.apiCategory).toBe('custom_metric');
    expect(s.confidence).toBe('MEDIUM');
    expect(s.replacement).toContain('meter.createCounter');
  });

  it('should detect JS noticeError and startSegment', () => {
    const src =
      "newrelic.noticeError(err);\nnewrelic.startSegment('payment', true, () => {});";
    const result = transformer.transform({
      language: 'javascript',
      file: 'x.js',
      sourceText: src,
    });
    const categories = result.data!.suggestions.map((s) => s.apiCategory);
    expect(categories).toContain('error_capture');
    expect(categories).toContain('segment');
  });

  it('should share JS patterns with TypeScript', () => {
    const result = transformer.transform({
      language: 'typescript',
      file: 'checkout.ts',
      sourceText: "newrelic.recordCustomEvent('Checkout', { a: 1 });",
    });
    expect(result.data!.suggestions).toHaveLength(1);
    expect(result.data!.suggestions[0]!.language).toBe('typescript');
  });

  it('should detect Python record_custom_event with dict attribute bag', () => {
    const result = transformer.transform({
      language: 'python',
      file: 'handler.py',
      sourceText:
        "newrelic.agent.record_custom_event('Checkout', {'order': 'abc'})",
    });
    expect(result.data!.suggestions).toHaveLength(1);
    expect(result.data!.suggestions[0]!.apiCategory).toBe('custom_event');
    expect(result.data!.suggestions[0]!.replacement).toContain('requests.post');
  });

  it('should detect Python add_custom_attribute and add_custom_parameter variants', () => {
    const src = `newrelic.agent.add_custom_attribute('tier', 'gold')
newrelic.agent.add_custom_parameter('region', 'us-east-1')`;
    const result = transformer.transform({
      language: 'python',
      file: 'x.py',
      sourceText: src,
    });
    expect(result.data!.suggestions).toHaveLength(2);
  });

  it('should detect Java NewRelic.addCustomParameter + recordMetric + noticeError', () => {
    const src = `NewRelic.addCustomParameter("tier", "gold");
NewRelic.recordMetric("Custom/latency", 142);
NewRelic.noticeError(e);`;
    const result = transformer.transform({
      language: 'java',
      file: 'Service.java',
      sourceText: src,
    });
    const cats = result.data!.suggestions.map((s) => s.apiCategory);
    expect(cats).toContain('custom_attribute');
    expect(cats).toContain('custom_metric');
    expect(cats).toContain('error_capture');
  });

  it('should report line numbers correctly across multi-line source', () => {
    const src = `// header
// more header
newrelic.noticeError(err);`;
    const result = transformer.transform({
      language: 'javascript',
      file: 'x.js',
      sourceText: src,
    });
    expect(result.data!.suggestions[0]!.line).toBe(3);
  });

  it('should fail with unsupported language', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({
      language: 'ruby' as any,
      file: 'x.rb',
      sourceText: '',
    });
    expect(result.success).toBe(false);
  });

  it('should emit manualSteps reminding reviewers of HIGH/MEDIUM/LOW semantics', () => {
    const result = transformer.transform({
      language: 'javascript',
      file: 'x.js',
      sourceText: "newrelic.noticeError(err);",
    });
    expect(result.data!.manualSteps.some((m) => m.includes('HIGH'))).toBe(true);
  });

  it('should be idempotent across repeated runs (regex state reset)', () => {
    const input = {
      language: 'javascript' as const,
      file: 'x.js',
      sourceText: "newrelic.recordCustomEvent('E', { a: 1 });",
    };
    const a = transformer.transform(input);
    const b = transformer.transform(input);
    expect(a.data!.suggestions.length).toBe(b.data!.suggestions.length);
    expect(a.data!.suggestions.length).toBe(1);
  });
});
