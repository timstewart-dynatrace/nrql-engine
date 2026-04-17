/**
 * Compiler → DQL validity gate.
 *
 * Every NRQL query that compiles successfully must produce DQL that
 * passes DQLSyntaxValidator with zero ERRORs. This catches regressions
 * where the emitter produces syntactically invalid DQL (unbalanced
 * parens, leftover NRQL keywords, wrong operators, etc.).
 *
 * The corpus below extends real-world-corpus.test.ts with additional
 * edge-case patterns that stress the emitter.
 */

import { describe, it, expect } from 'vitest';
import { NRQLCompiler } from '../../src/compiler/index.js';
import { DQLSyntaxValidator } from '../../src/validators/dql-validator.js';

const compiler = new NRQLCompiler();
const validator = new DQLSyntaxValidator();

// ---------------------------------------------------------------------------
// Corpus: NRQL patterns that must compile AND produce valid DQL
// ---------------------------------------------------------------------------

interface ValidityEntry {
  readonly area: string;
  readonly nrql: string;
}

const VALIDITY_CORPUS: ValidityEntry[] = [
  // ── Basic aggregations ──
  { area: 'agg', nrql: 'SELECT count(*) FROM Transaction' },
  { area: 'agg', nrql: 'SELECT average(duration) FROM Transaction' },
  { area: 'agg', nrql: 'SELECT max(duration) FROM Transaction' },
  { area: 'agg', nrql: 'SELECT min(duration) FROM Transaction' },
  { area: 'agg', nrql: 'SELECT sum(databaseDuration) FROM Transaction' },
  { area: 'agg', nrql: 'SELECT percentile(duration, 50, 90, 95, 99) FROM Transaction' },
  { area: 'agg', nrql: "SELECT uniqueCount(session) FROM Transaction WHERE appName = 'api'" },

  // ── WHERE / filters ──
  { area: 'filter', nrql: "SELECT count(*) FROM Transaction WHERE appName = 'checkout'" },
  { area: 'filter', nrql: "SELECT count(*) FROM Transaction WHERE duration > 1 AND appName = 'api'" },
  { area: 'filter', nrql: "SELECT count(*) FROM Transaction WHERE appName IN ('a', 'b', 'c')" },
  { area: 'filter', nrql: 'SELECT count(*) FROM Transaction WHERE appName IS NOT NULL' },
  { area: 'filter', nrql: "SELECT count(*) FROM Transaction WHERE appName LIKE '%prod%'" },
  { area: 'filter', nrql: "SELECT count(*) FROM Transaction WHERE appName NOT LIKE '%test%'" },
  { area: 'filter', nrql: 'SELECT count(*) FROM Transaction WHERE duration >= 0.5 OR duration < 0.01' },

  // ── FACET ──
  { area: 'facet', nrql: 'SELECT count(*) FROM Transaction FACET appName' },
  { area: 'facet', nrql: 'SELECT average(duration) FROM Transaction FACET appName, host' },
  { area: 'facet', nrql: 'SELECT count(*) FROM Transaction FACET appName LIMIT 20' },

  // ── TIMESERIES ──
  { area: 'timeseries', nrql: 'SELECT count(*) FROM Transaction TIMESERIES' },
  { area: 'timeseries', nrql: 'SELECT count(*) FROM Transaction TIMESERIES 5 minutes' },
  { area: 'timeseries', nrql: 'SELECT average(duration) FROM Transaction TIMESERIES AUTO' },

  // ── SINCE / UNTIL ──
  { area: 'time', nrql: 'SELECT count(*) FROM Transaction SINCE 1 hour ago' },
  { area: 'time', nrql: 'SELECT count(*) FROM Transaction SINCE 24 hours ago UNTIL 1 hour ago' },
  { area: 'time', nrql: 'SELECT count(*) FROM Transaction SINCE 7 days ago' },

  // ── Event types → fetch sources ──
  { area: 'source', nrql: 'SELECT count(*) FROM TransactionError' },
  { area: 'source', nrql: "SELECT count(*) FROM Log WHERE level = 'ERROR'" },
  { area: 'source', nrql: 'SELECT count(*) FROM PageView' },
  { area: 'source', nrql: 'SELECT count(*) FROM MobileCrash' },
  { area: 'source', nrql: 'SELECT count(*) FROM SystemSample' },
  { area: 'source', nrql: 'SELECT count(*) FROM ProcessSample' },
  { area: 'source', nrql: "SELECT count(*) FROM Span WHERE name LIKE 'GET /api%'" },
  { area: 'source', nrql: 'SELECT count(*) FROM SyntheticCheck' },

  // ── Infrastructure metric mapping ──
  { area: 'infra', nrql: 'SELECT average(cpuPercent) FROM SystemSample' },
  { area: 'infra', nrql: 'SELECT average(memoryUsedPercent) FROM SystemSample' },
  { area: 'infra', nrql: 'SELECT average(processCpuUsedPercent) FROM ProcessSample' },

  // ── Nested functions ──
  { area: 'nested', nrql: "SELECT percentage(count(*), WHERE result = 'SUCCESS') FROM SyntheticCheck" },
  { area: 'nested', nrql: "SELECT rate(count(*), 1 minute) FROM Transaction WHERE appName = 'api'" },

  // ── Comparison ──
  // COMPARE WITH emits fieldsAdd _comparison = "value" which triggers a
  // false positive on the single-= validator rule. Tested separately below.

  // ── Apdex ──
  { area: 'apdex', nrql: "SELECT apdex(duration, 0.5) FROM Transaction WHERE appName = 'api'" },

  // ── Math ──
  { area: 'math', nrql: 'SELECT count(*) / 60 FROM Transaction' },
  { area: 'math', nrql: 'SELECT (count(*) - 100) * 2 FROM Transaction' },

  // ── Aliases ──
  { area: 'alias', nrql: "SELECT count(*) AS 'Total Requests' FROM Transaction" },

  // ── Multi-FACET + LIMIT ──
  { area: 'complex', nrql: 'SELECT count(*) FROM Transaction FACET appName, host LIMIT 50 SINCE 1 hour ago TIMESERIES' },

  // ── Subqueries / complex ──
  { area: 'complex', nrql: "SELECT count(*) FROM Transaction WHERE appName = 'api' AND duration > 1 FACET host TIMESERIES 5 minutes SINCE 3 hours ago" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Compiler → DQL validity gate', () => {
  for (const entry of VALIDITY_CORPUS) {
    it(`${entry.area}: ${entry.nrql.slice(0, 80)}${entry.nrql.length > 80 ? '…' : ''}`, () => {
      const compileResult = compiler.compile(entry.nrql);
      expect(compileResult.success, `compile failed: ${compileResult.error}`).toBe(true);
      expect(compileResult.dql.length).toBeGreaterThan(0);

      const validationResult = validator.validate(compileResult.dql);
      const errors = validationResult.errors.filter((e) => e.severity === 'ERROR');

      expect(
        errors,
        `DQL validation errors for "${entry.nrql}":\n${errors.map((e) => `  L${e.line}:${e.column} ${e.message}`).join('\n')}\n\nEmitted DQL:\n${compileResult.dql}`,
      ).toHaveLength(0);
    });
  }

  it('COMPARE WITH compiles and only triggers known fieldsAdd false positive', () => {
    const result = compiler.compile('SELECT count(*) FROM Transaction COMPARE WITH 1 week ago');
    expect(result.success).toBe(true);
    expect(result.dql).toContain('append');
    expect(result.dql).toContain('_comparison');

    const vr = validator.validate(result.dql);
    const errors = vr.errors.filter((e) => e.severity === 'ERROR');
    for (const err of errors) {
      expect(
        err.message,
        `Unexpected DQL error beyond known fieldsAdd false positive: ${err.message}`,
      ).toContain("Single '=' used for comparison");
    }
  });

  it('should cover at least 40 patterns', () => {
    expect(VALIDITY_CORPUS.length).toBeGreaterThanOrEqual(40);
  });
});

describe('Compiler output structural invariants', () => {
  const SAMPLE_QUERIES = [
    'SELECT count(*) FROM Transaction',
    "SELECT average(duration) FROM Transaction WHERE appName = 'api' FACET host TIMESERIES",
    "SELECT count(*) FROM Log WHERE level = 'ERROR'",
    'SELECT average(cpuPercent) FROM SystemSample',
  ];

  for (const nrql of SAMPLE_QUERIES) {
    it(`CompileResult shape for: ${nrql.slice(0, 60)}`, () => {
      const r = compiler.compile(nrql);

      expect(typeof r.success).toBe('boolean');
      expect(typeof r.dql).toBe('string');
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(r.confidence);
      expect(typeof r.confidenceScore).toBe('number');
      expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(r.confidenceScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(r.warnings)).toBe(true);
      expect(Array.isArray(r.fixes)).toBe(true);
      expect(typeof r.originalNrql).toBe('string');
      expect(r.originalNrql).toBe(nrql);

      // TranslationNotes shape
      expect(r.notes).toBeDefined();
      expect(Array.isArray(r.notes.dataSourceMapping)).toBe(true);
      expect(Array.isArray(r.notes.fieldExtraction)).toBe(true);
      expect(Array.isArray(r.notes.keyDifferences)).toBe(true);
      expect(Array.isArray(r.notes.performanceConsiderations)).toBe(true);
      expect(Array.isArray(r.notes.dataModelRequirements)).toBe(true);
      expect(Array.isArray(r.notes.testingRecommendations)).toBe(true);
    });
  }
});
