import { describe, it, expect } from 'vitest';
import { ConversionReport } from '../../src/migration/conversion-report.js';
import { WarningCode } from '../../src/utils/warning-codes.js';

describe('ConversionReport', () => {
  it('summary is all zeros for an empty report', () => {
    const report = new ConversionReport();
    const s = report.summary();
    expect(s.totalQueries).toBe(0);
    expect(s.averageConfidenceScore).toBe(0);
    expect(s.needsReview).toBe(0);
  });

  it('computes confidence counts + average score', () => {
    const report = new ConversionReport();
    report.addQueries([
      {
        originalNrql: 'SELECT count(*) FROM Transaction',
        emittedDql: 'fetch spans | summarize count()',
        confidence: 'HIGH',
        confidenceScore: 100,
        warnings: [],
      },
      {
        originalNrql: 'SELECT count(*) FROM Mystery',
        emittedDql: 'fetch events',
        confidence: 'LOW',
        confidenceScore: 30,
        warnings: ['could not resolve'],
      },
    ]);
    const s = report.summary();
    expect(s.totalQueries).toBe(2);
    expect(s.successful).toBe(2);
    expect(s.confidenceCounts.HIGH).toBe(1);
    expect(s.confidenceCounts.LOW).toBe(1);
    expect(s.averageConfidenceScore).toBe(65);
    expect(s.needsReview).toBe(1); // score < 80
  });

  it('buckets warnings by code', () => {
    const report = new ConversionReport();
    report.addQuery({
      originalNrql: 'x',
      emittedDql: 'y',
      confidence: 'MEDIUM',
      confidenceScore: 70,
      warnings: ['low'],
      warningCodes: [WarningCode.CONFIDENCE_MEDIUM, WarningCode.METRIC_UNMAPPED],
    });
    report.addQuery({
      originalNrql: 'x',
      emittedDql: 'y',
      confidence: 'LOW',
      confidenceScore: 40,
      warnings: ['low'],
      warningCodes: [WarningCode.CONFIDENCE_LOW],
    });
    const byCode = report.summary().warningsByCode;
    expect(byCode[WarningCode.CONFIDENCE_MEDIUM]).toBe(1);
    expect(byCode[WarningCode.METRIC_UNMAPPED]).toBe(1);
    expect(byCode[WarningCode.CONFIDENCE_LOW]).toBe(1);
  });

  it('needsReview flags low scores AND review-required codes', () => {
    const report = new ConversionReport();
    report.addQuery({
      originalNrql: 'high-score-but-todo',
      emittedDql: 'fetch events',
      confidence: 'HIGH',
      confidenceScore: 95,
      warnings: [],
      warningCodes: [WarningCode.TODO_DQL_COMPILE_THROUGH],
    });
    expect(report.needsReview()).toHaveLength(1);
  });

  it('toJson emits valid JSON with summary + queries', () => {
    const report = new ConversionReport({ title: 'Test Report' });
    report.addQuery({
      originalNrql: 'x',
      emittedDql: 'y',
      confidence: 'HIGH',
      confidenceScore: 100,
      warnings: [],
    });
    const json = JSON.parse(report.toJson()) as {
      title: string;
      summary: { totalQueries: number };
      queries: Array<{ originalNrql: string }>;
    };
    expect(json.title).toBe('Test Report');
    expect(json.summary.totalQueries).toBe(1);
    expect(json.queries[0]!.originalNrql).toBe('x');
  });

  it('toHtml emits a self-contained HTML doc with inline CSS + confidence badges', () => {
    const report = new ConversionReport();
    report.addQuery({
      originalNrql: 'SELECT 1',
      emittedDql: 'fetch events',
      confidence: 'MEDIUM',
      confidenceScore: 70,
      warnings: ['one'],
      warningCodes: [WarningCode.CONFIDENCE_MEDIUM],
    });
    const html = report.toHtml();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).toContain('MEDIUM × 1');
    expect(html).toContain('CONFIDENCE_MEDIUM');
    // No external references
    expect(html).not.toContain('http://');
    expect(html).not.toContain('<link ');
    expect(html).not.toContain('<script');
  });

  it('toHtml escapes unsafe input', () => {
    const report = new ConversionReport();
    report.addQuery({
      originalNrql: "<script>alert('xss')</script>",
      emittedDql: 'fetch events',
      confidence: 'HIGH',
      confidenceScore: 100,
      warnings: [],
    });
    const html = report.toHtml();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain("<script>alert('xss')");
  });
});
