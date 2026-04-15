/**
 * Real-world NRQL regression corpus.
 *
 * Curated list of NRQL patterns drawn from the full NR product surface:
 * APM, Browser RUM, Mobile RUM, Infrastructure, Logs, Synthetics,
 * SLOs, Custom Events. Every entry must compile with confidence ≥
 * MEDIUM. Patterns that fail drive compiler enhancements.
 *
 * Adding a new pattern: append a CorpusEntry with an area + NRQL +
 * optional DQL substring expectations.
 */

import { describe, it, expect } from 'vitest';
import { NRQLCompiler } from '../../src/compiler/index.js';

interface CorpusEntry {
  readonly area: string;
  readonly nrql: string;
  readonly expectDqlIncludes?: string[];
  /** Minimum acceptable confidence band. Default MEDIUM. */
  readonly minConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

const CONFIDENCE_RANK: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

const CORPUS: CorpusEntry[] = [
  // ──────────────────────────── APM ──────────────────────────────
  {
    area: 'apm',
    nrql: "SELECT count(*) FROM Transaction WHERE appName = 'checkout' TIMESERIES",
    expectDqlIncludes: ['fetch spans', 'service.name == "checkout"', 'makeTimeseries'],
  },
  {
    area: 'apm',
    nrql: 'SELECT average(duration) FROM Transaction FACET appName',
    expectDqlIncludes: ['fetch spans', 'avg(duration)', 'by: {'],
  },
  {
    area: 'apm',
    nrql: 'SELECT percentile(duration, 95) FROM Transaction SINCE 1 hour ago',
    expectDqlIncludes: ['percentile', '95'],
  },
  {
    area: 'apm',
    nrql: 'SELECT count(*) FROM TransactionError',
    expectDqlIncludes: ['fetch spans', 'otel.status_code == "ERROR"'],
  },
  {
    area: 'apm',
    nrql: "SELECT uniqueCount(session) FROM Transaction WHERE appName = 'api'",
    expectDqlIncludes: ['countDistinctExact'],
  },

  // ───────────────────────── Browser RUM ─────────────────────────
  {
    area: 'browser',
    nrql: "SELECT count(*) FROM PageView WHERE appName = 'web'",
    expectDqlIncludes: ['fetch bizevents'],
  },
  {
    area: 'browser',
    nrql: 'SELECT average(duration) FROM PageView FACET deviceType TIMESERIES',
    expectDqlIncludes: ['makeTimeseries', 'avg'],
  },
  {
    area: 'browser',
    nrql: 'SELECT count(*) FROM JavaScriptError SINCE 24 hours ago',
    expectDqlIncludes: ['fetch bizevents'],
  },
  {
    area: 'browser',
    nrql: 'SELECT count(*) FROM AjaxRequest FACET hostname',
  },

  // ───────────────────────── Mobile RUM ──────────────────────────
  {
    area: 'mobile',
    nrql: 'SELECT count(*) FROM MobileCrash',
  },
  {
    area: 'mobile',
    nrql: "SELECT average(appLaunchTime) FROM MobileSession WHERE appName = 'ios-app'",
  },
  {
    area: 'mobile',
    nrql: "SELECT count(*) FROM MobileRequest WHERE responseCode >= 400",
  },

  // ─────────────────────── Infrastructure ────────────────────────
  {
    area: 'infra',
    nrql: "SELECT average(cpuPercent) FROM SystemSample WHERE hostname LIKE '%prod%' TIMESERIES",
    expectDqlIncludes: ['timeseries', 'avg(dt.host.cpu.usage)', 'contains(host.name'],
  },
  {
    area: 'infra',
    nrql: 'SELECT average(memoryUsedPercent) FROM SystemSample',
    expectDqlIncludes: ['avg(dt.host.memory.usage)'],
  },
  {
    area: 'infra',
    nrql: 'SELECT average(processCpuUsedPercent) FROM ProcessSample',
    expectDqlIncludes: ['avg(dt.process.cpu.usage)'],
  },
  {
    area: 'infra',
    nrql: 'SELECT max(memoryUsedPercent) FROM SystemSample FACET hostname',
  },
  {
    area: 'infra',
    nrql: "SELECT average(processCpuUsedPercent) FROM ProcessSample WHERE commandName = 'java'",
  },

  // ───────────────────────── Logs ────────────────────────────────
  {
    area: 'logs',
    nrql: "SELECT count(*) FROM Log WHERE level = 'ERROR'",
    expectDqlIncludes: ['fetch logs', 'loglevel == "ERROR"'],
  },
  {
    area: 'logs',
    nrql: "SELECT count(*) FROM Log WHERE message LIKE '%timeout%' TIMESERIES",
    expectDqlIncludes: ['fetch logs', 'contains(content'],
  },

  // ──────────────────────── Synthetics ───────────────────────────
  {
    area: 'synthetic',
    nrql: 'SELECT percentage(count(*), WHERE result = \'SUCCESS\') FROM SyntheticCheck',
    expectDqlIncludes: ['countIf'],
  },
  {
    area: 'synthetic',
    nrql: 'SELECT average(duration) FROM SyntheticCheck FACET location',
  },

  // ────────────────────────── Spans ──────────────────────────────
  {
    area: 'spans',
    nrql: "SELECT count(*) FROM Span WHERE name LIKE 'GET /api%'",
    expectDqlIncludes: ['fetch spans', 'startsWith(toString(span.name)'],
  },

  // ──────────────────────── Operators ────────────────────────────
  {
    area: 'operators',
    nrql: "SELECT count(*) FROM Transaction WHERE appName IN ('a', 'b', 'c')",
    expectDqlIncludes: ['in(service.name'],
  },
  {
    area: 'operators',
    nrql: 'SELECT count(*) FROM Transaction WHERE duration > 1000',
    expectDqlIncludes: ['duration > 1000'],
  },
  {
    area: 'operators',
    nrql: 'SELECT count(*) FROM Transaction WHERE appName IS NOT NULL',
    expectDqlIncludes: ['isNotNull(service.name'],
  },
];

describe('NRQL real-world corpus regression', () => {
  const compiler = new NRQLCompiler();

  for (const entry of CORPUS) {
    const min = entry.minConfidence ?? 'MEDIUM';
    it(`${entry.area}: ${entry.nrql.slice(0, 80)}${entry.nrql.length > 80 ? '…' : ''}`, () => {
      const result = compiler.compile(entry.nrql);
      expect(result.success, `compile failed: ${result.error}`).toBe(true);
      expect(CONFIDENCE_RANK[result.confidence]).toBeGreaterThanOrEqual(CONFIDENCE_RANK[min]);
      for (const needle of entry.expectDqlIncludes ?? []) {
        expect(result.dql).toContain(needle);
      }
    });
  }

  it('should expose corpus size', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
  });
});
