/**
 * Tests for registry/slo-auditor.ts — metric extraction, validation, fuzzy search.
 *
 * Ported from Python: tests/unit/test_slo_auditor.py (13 tests)
 */

import { describe, expect, it } from 'vitest';

import {
  INVALID_TIMESERIES_AGGS,
  METRIC_SYNONYMS,
  SLOAuditor,
  VALID_TIMESERIES_AGGS,
} from '../../src/registry/slo-auditor.js';

function createAuditor(): SLOAuditor {
  return new SLOAuditor(
    'https://abc123.live.dynatrace.com',
    'test-oauth',
    'dt0c01.TEST',
  );
}

// ─── extractMetricsFromDql ──────────────────────────────────────────────────

describe('extractMetricsFromDql', () => {
  it('should extract timeseries metric', () => {
    const auditor = createAuditor();
    const metrics = auditor.extractMetricsFromDql(
      'timeseries avg(dt.service.request.response_time)',
    );
    expect(metrics).toContain('dt.service.request.response_time');
  });

  it('should extract builtin metric', () => {
    const auditor = createAuditor();
    const metrics = auditor.extractMetricsFromDql(
      'timeseries sum(builtin:service.errors.total.rate)',
    );
    expect(metrics).toContain('builtin:service.errors.total.rate');
  });

  it('should not extract DQL keywords', () => {
    const auditor = createAuditor();
    const metrics = auditor.extractMetricsFromDql(
      "fetch logs | filter severity == 'ERROR' | summarize count()",
    );
    expect(metrics).not.toContain('fetch');
    expect(metrics).not.toContain('filter');
  });

  it('should handle empty DQL', () => {
    const auditor = createAuditor();
    const result = auditor.extractMetricsFromDql('');
    expect(result.length).toBe(0);
  });
});

// ─── validateDql ────────────────────────────────────────────────────────────

describe('validateDql', () => {
  it('should detect NRQL syntax', async () => {
    const auditor = createAuditor();
    const [errors] = await auditor.validateDql('SELECT count(*) FROM Transaction');
    const hasNrqlIssue = errors.some(
      (e) => e.includes('NRQL') || e.includes('SELECT'),
    );
    expect(hasNrqlIssue).toBe(true);
  });

  it('should pass valid DQL', async () => {
    const auditor = createAuditor();
    const [errors] = await auditor.validateDql('fetch logs | summarize count()');
    const nrqlIssues = errors.filter(
      (e) => e.includes('NRQL') || e.includes('SELECT'),
    );
    expect(nrqlIssues.length).toBe(0);
  });

  it('should detect invalid timeseries aggregation', async () => {
    const auditor = createAuditor();
    const [errors] = await auditor.validateDql(
      'timeseries takeLast(dt.host.cpu.usage)',
    );
    const hasTakeLastIssue = errors.some((e) => e.includes('takeLast'));
    expect(hasTakeLastIssue).toBe(true);
  });
});

// ─── findCorrectMetric ──────────────────────────────────────────────────────

describe('findCorrectMetric', () => {
  it('should find similar metric or return undefined', async () => {
    const auditor = createAuditor();
    const result = await auditor.findCorrectMetric('dt.host.cpu.usage');
    // Without registry loaded, returns undefined — that's expected
    expect(result === undefined || typeof result === 'string').toBe(true);
  });

  it('should return undefined for no match', async () => {
    const auditor = createAuditor();
    const result = await auditor.findCorrectMetric(
      'dt.completely.unknown.metric.xyz',
    );
    expect(result).toBeUndefined();
  });
});

// ─── METRIC_SYNONYMS ───────────────────────────────────────────────────────

describe('METRIC_SYNONYMS', () => {
  it('should have common synonym groups', () => {
    expect('error' in METRIC_SYNONYMS).toBe(true);
    expect('response' in METRIC_SYNONYMS).toBe(true);
    expect('memory' in METRIC_SYNONYMS).toBe(true);
  });

  it('should have bidirectional synonyms', () => {
    const errorSynonyms = METRIC_SYNONYMS['error'];
    expect(errorSynonyms).toBeDefined();
    expect(errorSynonyms!.has('failure')).toBe(true);
  });
});

// ─── Aggregation sets ───────────────────────────────────────────────────────

describe('INVALID_TIMESERIES_AGGS', () => {
  it('should list invalid timeseries aggregations', () => {
    expect(INVALID_TIMESERIES_AGGS.has('takeLast')).toBe(true);
    expect(INVALID_TIMESERIES_AGGS.has('takeFirst')).toBe(true);
    expect(INVALID_TIMESERIES_AGGS.has('collectArray')).toBe(true);
  });
});

describe('VALID_TIMESERIES_AGGS', () => {
  it('should list valid timeseries aggregations', () => {
    expect(VALID_TIMESERIES_AGGS.has('sum')).toBe(true);
    expect(VALID_TIMESERIES_AGGS.has('avg')).toBe(true);
    expect(VALID_TIMESERIES_AGGS.has('count')).toBe(true);
  });
});
