import { describe, it, expect } from 'vitest';
import { NRQLCompiler, applyPhase19Uplift } from '../../src/compiler/index.js';

describe('Phase 19 confidence uplift', () => {
  const compiler = new NRQLCompiler();

  it('should raise confidence when percentage() rewrite is carried', () => {
    const result = compiler.compile(
      "SELECT percentage(count(*), WHERE result = 'SUCCESS') FROM SyntheticCheck",
    );
    expect(result.success).toBe(true);
    expect(result.dql).toContain('countIf(');
    expect(result.dql).toMatch(/100(?:\.0+)?\s*\*|\*\s*100(?:\.0+)?/);
    // The emitter may land at MEDIUM; Phase 19 should at least hold or raise.
    expect(['HIGH', 'MEDIUM']).toContain(result.confidence);
    expect(result.fixes.some((f) => f.startsWith('phase19:'))).toBe(true);
  });

  it('should never lower confidence', () => {
    // Baseline: start at arbitrary score and verify applyPhase19Uplift can only raise.
    const base = {
      success: true,
      dql: 'fetch spans | summarize count()',
      confidence: 'HIGH' as const,
      confidenceScore: 95,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, 'SELECT count(*) FROM Transaction');
    expect(base.confidenceScore).toBe(95);
    expect(base.confidence).toBe('HIGH');
  });

  it('should not uplift unsuccessful results', () => {
    const base = {
      success: false,
      dql: '',
      confidence: 'LOW' as const,
      confidenceScore: 20,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, "SELECT apdex(duration, t: 0.5) FROM Transaction");
    expect(base.confidenceScore).toBe(20);
    expect(base.fixes).toEqual([]);
  });

  it('should detect apdex → countIf signal', () => {
    const base = {
      success: true,
      dql: 'fetch spans\n| summarize satisfied = countIf(duration < 500000000), total = count()',
      confidence: 'LOW' as const,
      confidenceScore: 40,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, 'SELECT apdex(duration, t: 0.5) FROM Transaction');
    expect(base.confidenceScore).toBeGreaterThan(40);
    expect(base.fixes.some((f) => f.includes('apdex'))).toBe(true);
  });

  it('should detect COMPARE WITH → shift: signal', () => {
    const base = {
      success: true,
      dql: 'timeseries count(), shift: 1d',
      confidence: 'MEDIUM' as const,
      confidenceScore: 60,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, 'SELECT count(*) FROM Transaction COMPARE WITH 1 day ago');
    expect(base.confidenceScore).toBeGreaterThan(60);
    expect(base.fixes.some((f) => f.includes('COMPARE WITH'))).toBe(true);
  });

  it('should detect rate(count,N) → per-second signal', () => {
    const base = {
      success: true,
      dql: 'timeseries rps = count() / 60',
      confidence: 'MEDIUM' as const,
      confidenceScore: 55,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, 'SELECT rate(count(*), 1 minute) FROM Transaction');
    expect(base.confidenceScore).toBeGreaterThan(55);
    expect(base.fixes.some((f) => f.includes('rate(count'))).toBe(true);
  });

  it('should stack signals to promote LOW → HIGH when multiple rewrites fire', () => {
    const base = {
      success: true,
      dql:
        'timeseries shift: 1d, rps = countIf(status >= 400) / count() * 100 / 60',
      confidence: 'LOW' as const,
      confidenceScore: 40,
      fixes: [] as string[],
    };
    applyPhase19Uplift(
      base,
      "SELECT rate(count(*), 1 minute), percentage(count(*), WHERE status >= 400) FROM Transaction COMPARE WITH 1 day ago",
    );
    expect(base.confidence).toBe('HIGH');
    expect(base.confidenceScore).toBeGreaterThanOrEqual(80);
    expect(base.fixes.filter((f) => f.startsWith('phase19:')).length).toBeGreaterThanOrEqual(3);
  });

  it('should not uplift when the NRQL mentions a construct but DQL does not carry it', () => {
    const base = {
      success: true,
      dql: 'fetch spans | summarize count()',
      confidence: 'LOW' as const,
      confidenceScore: 40,
      fixes: [] as string[],
    };
    applyPhase19Uplift(base, 'SELECT apdex(duration, t: 0.5) FROM Transaction');
    expect(base.confidenceScore).toBe(40);
    expect(base.fixes).toEqual([]);
  });
});
