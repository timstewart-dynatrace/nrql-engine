/**
 * NRQL Compiler Test Suite
 * ========================
 * 283+ test cases ported from the Python ``test_compiler.py``.
 * Each describe block corresponds to a numbered group in the original harness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NRQLCompiler, type CompileResult } from '../../src/compiler/index.js';

// ---------------------------------------------------------------------------
// Helpers (ported from Python conftest)
// ---------------------------------------------------------------------------

function codeLines(dql: string): string {
  return dql
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function assertValidDql(result: CompileResult): void {
  expect(result.success).toBe(true);
  expect(result.dql).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NRQLCompiler', () => {
  let compiler: NRQLCompiler;

  beforeEach(() => {
    compiler = new NRQLCompiler();
  });

  // =========================================================================
  // Group 1: The 5 Original Bug Fixes
  // =========================================================================
  describe('Group 1: Original Bug Fixes', () => {
    it('should deduplicate count (bug 1)', () => {
      const result = compiler.compile(
        "SELECT count(*) as total, count(*) as success FROM Transaction " +
        "WHERE appName = 'prod-auth-api' AND request.headers.kind = 'server' " +
        "AND net.protocol.name = 'http' TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('makeTimeseries');
      expect(result.dql).toContain('total=count()');
      expect(result.dql).toContain('success=count()');
    });

    it('should name percentile correctly (bug 2)', () => {
      const result = compiler.compile(
        "SELECT percentile(duration, 99) FROM Transaction " +
        "WHERE appName = 'prod-auth-api' AND kind = 'client' FACET http.url TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('p99=percentile(duration, 99)');
      expect(result.dql).toContain('by:');
    });

    it('should collapse triple count to single (bug 3)', () => {
      const result = compiler.compile(
        "SELECT count(*), count(*), count(*) FROM Transaction " +
        "WHERE appName = 'prod-user-domain-api' TIMESERIES"
      );
      expect(result.success).toBe(true);
      const code = result.dql
        .split('\n')
        .filter((l) => l.includes('makeTimeseries') || l.includes('summarize'))
        .join('\n');
      const countOccurrences = (code.match(/count\(\)/g) || []).length;
      expect(countOccurrences).toBeLessThanOrEqual(1);
    });

    it('should convert subquery to lookup (bug 4)', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'prod-auth-api' " +
        "AND http.route = '/auth-api/v1/oauth/token' " +
        "AND trace.id IN (FROM Span SELECT trace.id WHERE appName = 'prod-auth-api' " +
        "AND grant_type = 'punchthru') FACET httpResponseCode TIMESERIES"
      );
      expect(result.success).toBe(true);
      const code = codeLines(result.dql);
      expect(code).toContain('lookup [fetch spans');
      expect(code).toContain('isNotNull(sub.trace.id)');
      expect(code).not.toContain('FROM Span SELECT');
    });

    it('should convert AS alias to equals expression (bug 5)', () => {
      const result = compiler.compile(
        "SELECT count(*) as Occurrences, max(timestamp) as Latest FROM Log " +
        "WHERE service.name = 'prod-user-integration-api' AND level = 'ERROR' " +
        "FACET substring(logger, indexOf(logger, '.', -1) + 1) as Logger, " +
        "error.message as Message"
      );
      expect(result.success).toBe(true);
      const code = codeLines(result.dql);
      expect(code).toContain('Logger=substring');
      expect(code).toContain('Message=error.message');
      expect(code).not.toContain(' as Logger');
      expect(code).not.toContain(' as Message');
    });
  });

  // =========================================================================
  // Group 2: Core Conversions
  // =========================================================================
  describe('Group 2: Core Conversions', () => {
    it('should convert simple count', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'my-api' TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('service.name == "my-api"');
      expect(result.dql).toContain('makeTimeseries count()');
    });

    it('should convert average with facet', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction WHERE appName = 'api' FACET name TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('avg(duration)');
      expect(result.dql).toContain('by: {span.name}');
    });

    it('should convert non-timeseries aggregation', () => {
      const result = compiler.compile(
        "SELECT count(*), average(duration) FROM Transaction WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('summarize');
      expect(result.dql).not.toContain('makeTimeseries');
    });

    it('should convert log query', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Log WHERE level = 'ERROR' AND message LIKE '%timeout%'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch logs');
      expect(result.dql).toContain('loglevel == "ERROR"');
      expect(result.dql).toContain('contains(content, "timeout")');
    });

    it('should convert multiple aggregations', () => {
      const result = compiler.compile(
        "SELECT count(*), average(duration), max(duration) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('makeTimeseries {count(), avg(duration), max(duration)}');
    });

    it('should convert uniqueCount to countDistinctExact', () => {
      const result = compiler.compile(
        "SELECT uniqueCount(host) FROM Transaction WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countDistinctExact(host.name)');
    });

    it('should map httpResponseCode field', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE httpResponseCode >= 500 TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('http.response.status_code >= 500');
    });
  });

  // =========================================================================
  // Group 3: NR-Specific Functions
  // =========================================================================
  describe('Group 3: NR-Specific Functions', () => {
    it('should convert percentage to countIf', () => {
      const result = compiler.compile(
        "SELECT percentage(count(*), WHERE duration > 1) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf(duration > 1ms)');
      expect(result.dql).toContain('fieldsAdd');
      expect(result.dql).toContain('toDouble');
    });

    it('should convert filter(count) to countIf', () => {
      const result = compiler.compile(
        "SELECT filter(count(*), WHERE httpResponseCode >= 500) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf(http.response.status_code >= 500)');
    });

    it('should convert filter(average) to avgIf', () => {
      const result = compiler.compile(
        "SELECT filter(average(duration), WHERE error IS NOT NULL) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('avgIf(duration, isNotNull(error))');
    });

    it('should convert rate to count with warning', () => {
      const result = compiler.compile(
        "SELECT rate(count(*), 1 minute) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('count()');
      expect(result.warnings.some((w) => w.includes('rate()'))).toBe(true);
    });

    it('should expand multi-percentile', () => {
      const result = compiler.compile(
        "SELECT percentile(duration, 50, 90, 95, 99) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('p50=percentile(duration, 50)');
      expect(result.dql).toContain('p99=percentile(duration, 99)');
    });

    it('should convert median to percentile(50)', () => {
      const result = compiler.compile(
        "SELECT median(duration) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('percentile(duration, 50)');
    });
  });

  // =========================================================================
  // Group 4: Conditions
  // =========================================================================
  describe('Group 4: Conditions', () => {
    it('should convert = to ==', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'x'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('service.name == "x"');
    });

    it('should convert IS NULL and IS NOT NULL', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE error IS NOT NULL AND host IS NULL"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('isNotNull(error)');
      expect(result.dql).toContain('isNull(host.name)');
    });

    it('should convert IN list', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName IN ('a', 'b', 'c')"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('in(service.name, {"a", "b", "c"})');
    });

    it('should convert NOT IN', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName NOT IN ('x')"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('not in(service.name, {"x"})');
    });

    it('should convert LIKE %x% to contains', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE name LIKE '%payment%'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('contains(span.name, "payment")');
    });

    it('should convert LIKE x% to startsWith', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE httpResponseCode LIKE '2%'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('startsWith(toString(http.response.status_code), "2")');
    });

    it('should handle complex AND/OR', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE (appName = 'a' OR appName = 'b') AND error IS NOT NULL"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('service.name == "a" or service.name == "b"');
      expect(result.dql).toContain('isNotNull(error)');
    });
  });

  // =========================================================================
  // Group 5: Arithmetic Expressions
  // =========================================================================
  describe('Group 5: Arithmetic Expressions', () => {
    it('should handle error percentage calculation', () => {
      const result = compiler.compile(
        "SELECT filter(count(*), WHERE httpResponseCode >= 500) / " +
        "filter(count(*), WHERE httpResponseCode IS NOT NULL) * 100 " +
        "FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf(http.response.status_code >= 500)');
      expect(result.dql).toContain('countIf(isNotNull(http.response.status_code))');
      expect(result.dql).toContain('* 100');
    });

    it('should handle unary minus', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE duration > -1"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('duration > -1');
    });
  });

  // =========================================================================
  // Group 6: Edge Cases
  // =========================================================================
  describe('Group 6: Edge Cases', () => {
    it('should handle LIMIT clause', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET appName LIMIT 20"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('limit 20');
    });

    it('should handle ORDER BY', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET appName ORDER BY count(*) DESC"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('sort count() desc');
    });

    it('should capture SINCE/UNTIL in AST', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction SINCE 1 hour ago UNTIL 5 minutes ago TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('makeTimeseries count()');
      expect(result.ast?.sinceRaw).toBe('1 hour ago');
    });

    it('should handle backtick quoted field', () => {
      const result = compiler.compile(
        "SELECT average(`k8s.container.cpuUsedCores`) FROM Metric WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      // Phase 16 extended-metric-map now resolves the K8s metric to its
      // DT Grail equivalent. The backtick parse path is still exercised —
      // only the post-resolve name differs.
      expect(result.dql).toContain('avg(dt.kubernetes.container.cpu_usage)');
    });

    it('should handle string with escaped quotes', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE name = 'it''s a test'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain("it's a test");
    });

    it('should handle multiple facet items with aliases', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET appName as Service, host as Host"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('Service=service.name');
      expect(result.dql).toContain('Host=host.name');
    });

    it('should handle empty count star from Log', () => {
      const result = compiler.compile("SELECT count(*) FROM Log");
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch logs');
      expect(result.dql).toContain('count()');
    });

    it('should handle boolean comparison', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE error = true TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('error == true');
    });
  });

  // =========================================================================
  // Group 7: Real-World Complex Queries
  // =========================================================================
  describe('Group 7: Real-World Complex Queries', () => {
    it('should handle auth api p99 latency by url path', () => {
      const result = compiler.compile(
        "SELECT percentile(duration, 99) FROM Transaction " +
        "WHERE appName = 'prod-auth-api' AND span.kind = 'client' " +
        "AND net.protocol.name = 'http' " +
        "AND NOT name LIKE '%userpassword%' AND name LIKE '%panamax%' " +
        "FACET http.url TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('p99=percentile(duration, 99)');
      const code = codeLines(result.dql);
      expect(code).toContain('not(contains(span.name, "userpassword"))');
      expect(code).toContain('contains(span.name, "panamax")');
    });

    it('should handle user domain server count', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'prod-user-domain-api' " +
        "AND span.kind = 'server' TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('makeTimeseries count()');
      expect(result.dql).toContain('span.kind == "server"');
    });

    it('should handle integration api error log analysis', () => {
      const result = compiler.compile(
        "SELECT count(*) as Occurrences, max(timestamp) as Latest FROM Log " +
        "WHERE service.name = 'prod-user-integration-api' AND level = 'ERROR' " +
        "FACET substring(logger, indexOf(logger, '.', -1) + 1) as Logger, " +
        "error.message as Message"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('Occurrences=count()');
      expect(result.dql).toContain('Latest=max(timestamp)');
      const code = codeLines(result.dql);
      expect(code).toContain('Logger=substring');
      expect(code).toContain('Message=error.message');
    });
  });

  // =========================================================================
  // Group 8: Metric Queries (timeseries command)
  // =========================================================================
  describe('Group 8: Metric Queries', () => {
    it('should convert SystemSample to timeseries', () => {
      const result = compiler.compile(
        "SELECT average(cpuPercent) FROM SystemSample WHERE hostname = 'web-1' TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries avg(');
      const code = codeLines(result.dql);
      expect(code).not.toContain('fetch');
      expect(code).not.toContain('makeTimeseries');
    });

    it('should handle SystemSample memory', () => {
      const result = compiler.compile(
        "SELECT average(memoryUsedPercent) FROM SystemSample FACET hostname TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries avg(');
      expect(result.dql).toContain('by: {host.name}');
    });

    it('should handle Metric query passthrough', () => {
      const result = compiler.compile(
        "SELECT sum(cpuPercent) FROM Metric WHERE appName = 'api' TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries sum(');
    });

    it('should convert latest on metric to avg', () => {
      const result = compiler.compile(
        "SELECT latest(cpuPercent) FROM SystemSample FACET hostname"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries avg(');
    });
  });

  // =========================================================================
  // Group 9: K8s Queries
  // =========================================================================
  describe('Group 9: K8s Queries', () => {
    it('should handle K8sNodeSample basic', () => {
      const result = compiler.compile(
        "SELECT latest(memoryUsedBytes) FROM K8sNodeSample FACET nodeName TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries avg(');
      expect(result.dql).toContain('by: {k8s.node.name}');
    });

    it('should handle K8sContainerSample', () => {
      const result = compiler.compile(
        "SELECT average(cpuUsedCores) FROM K8sContainerSample FACET containerName TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
      expect(result.dql).toContain('by: {k8s.container.name}');
    });

    it('should strip metric filter for K8s', () => {
      const result = compiler.compile(
        "SELECT latest(allocatableMemoryUtilization) FROM K8sNodeSample " +
        "WHERE allocatableMemoryUtilization < 90 AND clusterName = 'prod' FACET nodeName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('k8s.cluster.name');
      const code = codeLines(result.dql);
      expect(code).not.toContain('allocatableMemoryUtilization <');
    });

    it('should handle K8s computed metric', () => {
      const result = compiler.compile(
        "SELECT (latest(fsInodesUsed)/latest(fsInodes))*100 as fsInodeCapacityUtilization " +
        "FROM K8sNodeSample WHERE clusterName = 'prod' FACET nodeName TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
      expect(result.dql).toContain('fieldsAdd');
      expect(result.dql).toContain('fsInodeCapacityUtilization');
      expect(result.dql).toContain('toDouble');
      const code = codeLines(result.dql);
      expect(code).not.toContain('fetch');
      expect(code).not.toContain('makeTimeseries');
    });

    it('should handle K8s computed bare aggs with parenthesized where arithmetic', () => {
      const result = compiler.compile(
        "SELECT (latest(fsInodesUsed)/latest(fsInodes))*100 as fsInodeCapacityUtilization, " +
        "latest(fsInodesUsed), latest(fsInodes) FROM K8sNodeSample " +
        "WHERE (fsInodesUsed/fsInodes)*100 < 90 AND clusterName LIKE 'usf-moxe%' " +
        "FACET nodeName TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
      expect(result.dql).toContain('fieldsAdd');
      expect(result.dql).toContain('fsInodeCapacityUtilization');
      expect(result.dql).toContain('toDouble');
    });
  });

  // =========================================================================
  // Group 10: Events & Special Types
  // =========================================================================
  describe('Group 10: Events & Special Types', () => {
    it('should convert InfrastructureEvent to fetch events', () => {
      const result = compiler.compile(
        "SELECT summary, category FROM InfrastructureEvent WHERE category = 'kubernetes' LIMIT 50"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch events');
      expect(result.dql).toContain('filter');
      expect(result.dql).toContain('limit 50');
    });

    it('should convert histogram to count with bin', () => {
      const result = compiler.compile(
        "SELECT histogram(duration) FROM Transaction WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('count()');
      expect(result.dql).toContain('bin(duration');
      expect(result.warnings.some((w) => w.includes('histogram'))).toBe(true);
    });

    it('should convert PageView browser query', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM PageView WHERE pageUrl LIKE '%checkout%' FACET userAgentName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch bizevents');
      expect(result.dql).toContain('page.url');
      expect(result.dql).toContain('browser.name');
    });
  });

  // =========================================================================
  // Group 11: Structural Completeness
  // =========================================================================
  describe('Group 11: Structural Completeness', () => {
    it('should warn on COMPARE WITH', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction COMPARE WITH 1 week ago TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('shift:');
      expect(result.warnings.some((w) => w.includes('COMPARE WITH'))).toBe(true);
    });

    it('should add full fidelity comment for EXTRAPOLATE', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction EXTRAPOLATE"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('full fidelity');
      expect(result.warnings.some((w) => w.includes('EXTRAPOLATE'))).toBe(true);
    });

    it('should inline WITH AS CTE', () => {
      const result = compiler.compile(
        "WITH errors AS (SELECT count(*) FROM TransactionError WHERE appName = 'api') " +
        "SELECT count(*) FROM errors WHERE error.class = 'TimeoutError'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('service.name == "api"');
      expect(result.dql).toContain('error.class');
    });

    it('should calculate apdex approximation', () => {
      const result = compiler.compile(
        "SELECT apdex(0.5) FROM Transaction WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf');
      expect(result.dql).toContain('duration');
      expect(result.warnings.some((w) => w.includes('apdex'))).toBe(true);
    });

    it('should convert FACET CASES', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET CASES(WHERE duration < 0.5 AS 'Fast', " +
        "WHERE duration < 2 AS 'Normal', WHERE duration >= 2 AS 'Slow')"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fieldsAdd');
      expect(result.dql).toContain('if(');
      expect(result.dql).toContain('"Fast"');
      expect(result.dql).toContain('by: {_category_');
    });
  });

  // =========================================================================
  // Group 12: Real-World Parser Gaps
  // =========================================================================
  describe('Group 12: Real-World Parser Gaps', () => {
    it('should handle FROM first syntax (FROM Span SELECT)', () => {
      const result = compiler.compile(
        "FROM Span SELECT count(*) WHERE entity.name = 'my-api' FACET http.route TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('makeTimeseries');
      expect(result.dql).toContain('dt.entity.name');
    });

    it('should handle FROM Log SELECT', () => {
      const result = compiler.compile(
        "FROM Log SELECT count(*) WHERE container_name = 'nginx' FACET level"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch logs');
      expect(result.dql).toContain('container_name');
    });

    it('should handle FROM Metric SELECT', () => {
      const result = compiler.compile(
        "FROM Metric SELECT average(apm.service.transaction.duration) WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
      expect(result.dql).toContain('service.name');
    });

    it('should strip SQL comments', () => {
      const result = compiler.compile(
        "SELECT average(duration) -- this is a comment\nFROM Transaction WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('avg(duration)');
    });

    it('should ignore semicolons', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'api';"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('count()');
    });

    it('should handle scientific notation 10e8', () => {
      const result = compiler.compile(
        "SELECT rate((bytecountestimate() / 10e8) * .30, 1 month) FROM Span"
      );
      expect(result.success).toBe(true);
    });

    it('should handle IS TRUE / IS FALSE', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM TransactionError WHERE error IS NOT FALSE AND appId IN ('123')"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('error != false');
      expect(result.dql).toContain('appId');
    });

    it('should handle OR coalesce in function args', () => {
      const result = compiler.compile(
        "SELECT average(memoryFreePercent OR memoryFreeBytes/memoryTotalBytes*100) " +
        "FROM SystemSample TIMESERIES FACET hostname"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
    });

    it('should handle FROM Span SELECT with aliases', () => {
      const result = compiler.compile(
        "FROM Span SELECT count(*) AS 'Total', average(duration.ms) AS 'Avg' " +
        "WHERE entity.name = 'api' COMPARE WITH 1 week ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('Total=count()');
      expect(result.warnings.some((w) => w.includes('COMPARE WITH'))).toBe(true);
    });

    it('should handle CASES in mid facet position', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Span WHERE http.route = '/api' FACET http.statusCode, " +
        "CASES(WHERE http.statusCode >= 200 AND http.statusCode < 400 AS 'Success', " +
        "WHERE http.statusCode >= 400 AS 'Error') COMPARE WITH 1 week ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('if(');
      expect(result.dql).toContain('"Success"');
    });

    it('should handle WITH inline FROM first aparse', () => {
      const result = compiler.compile(
        "FROM Span WITH aparse(host.name, 'search-cron-*-job%') AS (job) " +
        "SELECT average(duration.ms) WHERE service.name = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch spans');
      expect(result.dql).toContain('avg(duration)');
    });

    it('should handle WITH inline SELECT first', () => {
      const result = compiler.compile(
        "SELECT average(k8s.container.cpuUsedCores) FROM Metric " +
        "WITH aparse(k8s.jobName, 'search-cron-*') AS (job) WHERE containerName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
    });

    it('should handle template variables', () => {
      const result = compiler.compile(
        "SELECT average(k8s.container.cpuUsedCores) FROM Metric " +
        "WHERE k8s.containerName = {{api}} AND k8s.clusterName = 'prod'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
    });

    it('should handle bracket access field', () => {
      const result = compiler.compile(
        "SELECT sum(apm.service.error.count['count']) / count(apm.service.transaction.duration) " +
        "FROM Metric WHERE appName = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('timeseries');
    });

    it('should handle if condition in SELECT', () => {
      const result = compiler.compile(
        "FROM Log SELECT trace.id, level, if(level='ERROR', context, '') as error " +
        "WHERE service.name = 'api' LIMIT 20"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('fetch logs');
      expect(result.dql).toContain('if(');
      expect(result.dql).toContain('limit 20');
    });
  });

  // =========================================================================
  // Group 13: High Priority Gaps (SLIDE BY, derivative, jparse, FACET ORDER BY)
  // =========================================================================
  describe('Group 13: High Priority Gaps', () => {
    it('should handle SLIDE BY clause', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction TIMESERIES 5 minutes SLIDE BY 1 minute"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('rolling(');
      expect(result.dql).toContain('interval: 1m');
    });

    it('should handle SLIDE BY AUTO', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction TIMESERIES 5 minutes SLIDE BY AUTO"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('rolling(');
    });

    it('should handle SLIDE BY MAX', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction TIMESERIES 5 minutes SLIDE BY MAX"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('rolling(');
    });

    it('should handle TIMESERIES MAX without SLIDE BY', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction TIMESERIES MAX"
      );
      expect(result.success).toBe(true);
    });

    it('should convert derivative function', () => {
      const result = compiler.compile(
        "SELECT derivative(count(*), 1 minute) FROM Transaction TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('delta(');
    });

    it('should convert derivative simple', () => {
      const result = compiler.compile(
        "FROM Metric SELECT derivative(apm.service.transaction.duration) TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('delta(');
    });

    it('should convert jparse with path', () => {
      const result = compiler.compile(
        "FROM Log SELECT jparse(message, '$.error.code') WHERE service.name = 'api'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('[`error.code`]');
    });

    it('should handle jparse simple', () => {
      const result = compiler.compile(
        "FROM Log SELECT jparse(message) WHERE level = 'ERROR'"
      );
      expect(result.success).toBe(true);
    });

    it('should handle FACET ORDER BY aggregate', () => {
      const result = compiler.compile(
        "FROM Transaction SELECT average(duration) TIMESERIES FACET appName ORDER BY max(responseSize)"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('FACET ORDER BY');
    });

    it('should preserve sort with FACET ORDER BY', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET appName ORDER BY count(*) DESC"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('sort count() desc');
      expect(result.dql).toContain('FACET ORDER BY');
    });
  });

  // =========================================================================
  // Group 14: Medium Priority Gaps (JOIN, clamp, buckets, cdf, etc.)
  // =========================================================================
  describe('Group 14: Medium Priority Gaps', () => {
    it('should convert clamp_max', () => {
      const result = compiler.compile(
        "SELECT clamp_max(average(duration), 10) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('if(avg(duration) > 10, 10, else:avg(duration))');
    });

    it('should convert clamp_min', () => {
      const result = compiler.compile(
        "SELECT clamp_min(average(duration), 1) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('if(avg(duration) < 1, 1, else:avg(duration))');
    });

    it('should convert clamp_max and clamp_min combined', () => {
      const result = compiler.compile(
        "SELECT clamp_max(average(duration), 10), clamp_min(average(duration), 1) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('if(');
      expect(result.dql).toContain('> 10');
      expect(result.dql).toContain('< 1');
    });

    it('should convert cdfPercentage', () => {
      const result = compiler.compile(
        "FROM PageView SELECT cdfPercentage(firstPaint, 0.5, 1.0)"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf(');
      expect(result.dql).toContain('<= 0.5');
      expect(result.dql).toContain('<= 1');
    });

    it('should convert bucketPercentile specific', () => {
      const result = compiler.compile(
        "SELECT bucketPercentile(duration_bucket, 50, 75, 90) FROM Metric"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('percentile(');
    });

    it('should convert bucketPercentile default', () => {
      const result = compiler.compile(
        "SELECT bucketPercentile(duration_bucket) FROM Metric"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('percentile(duration_bucket');
    });

    it('should convert getField', () => {
      const result = compiler.compile(
        "SELECT getField(percentile(duration, 95), '95.0') FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('[`95.0`]');
    });

    it('should convert inner JOIN with subquery', () => {
      const result = compiler.compile(
        "FROM PageView JOIN (FROM PageAction SELECT count(*) FACET session, currentUrl) ON session " +
        "SELECT count(*) FACET browserTransactionName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup');
    });

    it('should convert LEFT JOIN with subquery', () => {
      const result = compiler.compile(
        "FROM PageView LEFT JOIN (FROM PageAction SELECT count(*) FACET session) ON session " +
        "SELECT count(*) FACET browserTransactionName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup');
      expect(result.dql).toContain('LEFT');
    });

    it('should convert JOIN with different keys', () => {
      const result = compiler.compile(
        "FROM Transaction JOIN (FROM Metric SELECT average(duration) FACET appName) ON name = appName " +
        "SELECT average(duration)"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup');
    });

    it('should handle WITH TIMEZONE', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction SINCE Monday UNTIL Tuesday WITH TIMEZONE 'America/New_York'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('America/New_York');
    });

    it('should handle PREDICT clause', () => {
      const result = compiler.compile(
        "FROM Transaction SELECT count(*) WHERE error IS TRUE TIMESERIES PREDICT"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('PREDICT');
      expect(result.dql).toContain('Davis AI');
    });

    it('should handle SHOW EVENT TYPES', () => {
      const result = compiler.compile("SHOW EVENT TYPES SINCE 1 day ago");
      expect(result.success).toBe(true);
      expect(result.dql).toContain('SHOW EVENT TYPES');
      expect(result.dql).toContain('Schema browser');
    });

    it('should convert ln to log', () => {
      const result = compiler.compile(
        "SELECT ln(duration) FROM Transaction LIMIT 10"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('log(duration)');
    });

    it('should convert cardinality', () => {
      const result = compiler.compile(
        "SELECT cardinality(appName) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countDistinct(');
    });

    it('should handle predictLinear', () => {
      const result = compiler.compile(
        "SELECT predictLinear(cpuPercent, 3600) FROM SystemSample"
      );
      expect(result.success).toBe(true);
    });

    it('should handle blob passthrough', () => {
      const result = compiler.compile("SELECT blob(message) FROM Log LIMIT 5");
      expect(result.success).toBe(true);
    });

    it('should handle mapKeys passthrough', () => {
      const result = compiler.compile("SELECT mapKeys(tags) FROM Transaction");
      expect(result.success).toBe(true);
    });

    it('should handle mapValues passthrough', () => {
      const result = compiler.compile("SELECT mapValues(tags) FROM Transaction");
      expect(result.success).toBe(true);
    });

    it('should handle keyset metadata', () => {
      const result = compiler.compile("SELECT keyset() FROM Transaction");
      expect(result.success).toBe(true);
      expect(result.dql).toContain('Schema browser');
    });

    it('should handle eventType metadata', () => {
      const result = compiler.compile("SELECT eventType() FROM Transaction");
      expect(result.success).toBe(true);
      expect(result.dql).toContain('Schema browser');
    });

    it('should handle bytecountestimate ingest', () => {
      const result = compiler.compile(
        "SELECT bytecountestimate() FROM Transaction SINCE 1 day ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('bytecountestimate');
    });

    it('should convert aggregationendtime', () => {
      const result = compiler.compile(
        "SELECT aggregationendtime(), count(*) FROM Transaction TIMESERIES 1 hour"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('end(');
    });

    it('should convert buckets to bin', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET buckets(duration, 10, 5)"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('bin(');
    });

    // -- Combinations & edge cases --

    it('should handle SLIDE BY plus FACET ORDER BY combined', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction " +
        "FACET appName ORDER BY max(duration) " +
        "TIMESERIES 5 minutes SLIDE BY 1 minute"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('SLIDE BY');
      expect(result.dql).toContain('FACET ORDER BY');
    });

    it('should handle derivative timeseries facet', () => {
      const result = compiler.compile(
        "SELECT derivative(count(*), 1 minute) FROM Transaction TIMESERIES FACET appName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('delta(');
    });

    it('should handle clamp plus jparse in same query', () => {
      const result = compiler.compile(
        "FROM Log SELECT clamp_max(numeric(jparse(message, '$.latency')), 1000) WHERE level = 'INFO'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('if(');
      expect(result.dql).toContain('1000');
    });

    it('should handle WITH TIMEZONE plus COMPARE WITH', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction SINCE 1 day ago COMPARE WITH 1 week ago " +
        "WITH TIMEZONE 'America/Chicago'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('America/Chicago');
      expect(result.dql).not.toContain('shift:');
    });

    it('should handle PREDICT plus timeseries', () => {
      const result = compiler.compile(
        "SELECT average(duration) FROM Transaction TIMESERIES 1 hour PREDICT"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('Davis AI');
    });

    // -- Subquery / Lookup tests --

    it('should convert IN SELECT subquery to lookup', () => {
      const result = compiler.compile(
        "FROM Span SELECT duration, db.statement WHERE service.name = 'my-api' " +
        "AND parentId in (SELECT id from Span where service.name = 'my-api' " +
        "and name = 'list-cmd-01' limit max) limit max"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup [fetch spans');
      expect(result.dql).toContain('sourceField:span.parent_id');
      expect(result.dql).toContain('lookupField:span.id');
      expect(result.dql).toContain('isNotNull(sub.span.id)');
    });

    it('should convert IN FROM subquery to lookup', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Span WHERE service.name = 'order-api' " +
        "AND trace.id IN (FROM Span SELECT trace.id WHERE appName = 'auth-api' " +
        "AND name = 'authenticate') FACET name TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup [fetch spans');
      expect(result.dql).toContain('sourceField:trace.id');
      expect(result.dql).toContain('lookupField:trace.id');
      expect(result.dql).toContain('isNotNull(sub.trace.id)');
    });

    it('should convert NOT IN subquery to lookup isNull', () => {
      const result = compiler.compile(
        "FROM Span SELECT count(*) WHERE name NOT IN (SELECT name FROM Span WHERE error.class IS NOT NULL)"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('lookup [fetch spans');
      expect(result.dql).toContain('isNull(sub.span.name)');
    });

    it('should simplify duration.ms/1000', () => {
      const result = compiler.compile(
        "SELECT (duration.ms)/1000 as seconds FROM Span WHERE name = 'mongodb.find'"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('duration');
      expect(result.dql).not.toContain('/ 1000');
    });
  });

  // =========================================================================
  // Group 14a: Every aggregation function
  // =========================================================================
  describe('Group 14a: Aggregation Functions', () => {
    it('should produce valid DQL for count(*)', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('count()');
    });

    it('should produce valid DQL for sum(field)', () => {
      const result = compiler.compile("SELECT sum(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('sum(duration)');
    });

    it('should produce valid DQL for average(field)', () => {
      const result = compiler.compile("SELECT average(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('avg(duration)');
    });

    it('should produce valid DQL for max(field)', () => {
      const result = compiler.compile("SELECT max(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('max(duration)');
    });

    it('should produce valid DQL for min(field)', () => {
      const result = compiler.compile("SELECT min(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('min(duration)');
    });

    it('should produce valid DQL for percentile(field, 95)', () => {
      const result = compiler.compile("SELECT percentile(duration, 95) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('percentile(duration, 95)');
    });

    it('should produce valid DQL for percentile multi', () => {
      const result = compiler.compile("SELECT percentile(duration, 50, 90, 95, 99) FROM Transaction");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('p50=');
      expect(code).toContain('p99=');
    });

    it('should produce valid DQL for uniqueCount to countDistinctExact', () => {
      const result = compiler.compile("SELECT uniqueCount(appName) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countDistinctExact(service.name)');
    });

    it('should produce valid DQL for uniques to collectDistinct', () => {
      const result = compiler.compile("SELECT uniques(appName) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('collectDistinct(service.name)');
    });

    it('should produce valid DQL for latest to takeLast', () => {
      const result = compiler.compile("SELECT latest(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('takeLast(duration)');
    });

    it('should produce valid DQL for earliest to takeFirst', () => {
      const result = compiler.compile("SELECT earliest(timestamp) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('takeFirst(timestamp)');
    });

    it('should produce valid DQL for median to percentile(50)', () => {
      const result = compiler.compile("SELECT median(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('percentile(duration, 50)');
    });

    it('should produce valid DQL for stddev', () => {
      const result = compiler.compile("SELECT stddev(duration) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('stddev(');
    });

    it('should produce valid DQL for rate count 1m', () => {
      const result = compiler.compile("SELECT rate(count(*), 1 minute) FROM Transaction");
      assertValidDql(result);
    });

    it('should produce valid DQL for percentage to countIf', () => {
      const result = compiler.compile("SELECT percentage(count(*), WHERE duration > 1) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should produce valid DQL for filter(count) to countIf', () => {
      const result = compiler.compile("SELECT filter(count(*), WHERE error IS true) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should produce valid DQL for filter(sum) to sumIf', () => {
      const result = compiler.compile("SELECT filter(sum(duration), WHERE error IS true) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('sumIf(');
    });

    it('should produce valid DQL for filter(avg) to avgIf', () => {
      const result = compiler.compile("SELECT filter(average(duration), WHERE duration > 1) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('avgIf(');
    });

    it('should produce valid DQL for apdex (no raw apdex)', () => {
      const result = compiler.compile("SELECT apdex(duration, 0.5) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).not.toContain('apdex(');
    });

    it('should produce valid DQL for histogram to bin', () => {
      const result = compiler.compile("SELECT histogram(duration, 10, 20) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('bin(');
    });

    it('should produce valid DQL for derivative count 1m', () => {
      const result = compiler.compile("SELECT derivative(count(*), 1 minute) FROM Transaction TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('delta(');
    });

    it('should produce valid DQL for cdfPercentage', () => {
      const result = compiler.compile("FROM PageView SELECT cdfPercentage(duration, 1, 3, 5)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });
  });

  // =========================================================================
  // Group 14b: Every scalar/string/math function
  // =========================================================================
  describe('Group 14b: Scalar Functions', () => {
    it('should convert substring 3-arg named', () => {
      const result = compiler.compile("SELECT substring(request.uri, 0, 50) FROM Transaction LIMIT 10");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('from:0');
      expect(code).toContain('to:50');
    });

    it('should convert substring 2-arg', () => {
      const result = compiler.compile("SELECT substring(request.uri, 5) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('substring(');
    });

    it('should convert indexOf', () => {
      const result = compiler.compile("SELECT indexOf(name, '.') FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('indexOf(span.name');
    });

    it('should convert length to stringLength', () => {
      const result = compiler.compile("SELECT length(name) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('stringLength(span.name');
    });

    it('should convert lower', () => {
      const result = compiler.compile("SELECT lower(name) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('lower(span.name');
    });

    it('should convert upper', () => {
      const result = compiler.compile("SELECT upper(name) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('upper(span.name');
    });

    it('should convert concat', () => {
      const result = compiler.compile("SELECT concat(appName, '-', name) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('concat(service.name');
    });

    it('should convert abs', () => {
      const result = compiler.compile("SELECT abs(duration - 1) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('abs(');
    });

    it('should convert ceil', () => {
      const result = compiler.compile("SELECT ceil(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('ceil(');
    });

    it('should convert floor', () => {
      const result = compiler.compile("SELECT floor(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('floor(');
    });

    it('should convert round', () => {
      const result = compiler.compile("SELECT round(duration, 2) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('round(');
    });

    it('should convert sqrt', () => {
      const result = compiler.compile("SELECT sqrt(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('sqrt(');
    });

    it('should convert pow', () => {
      const result = compiler.compile("SELECT pow(duration, 2) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('pow(');
    });

    it('should convert log10', () => {
      const result = compiler.compile("SELECT log10(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('log10(');
    });

    it('should convert ln to log', () => {
      const result = compiler.compile("SELECT ln(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('log(duration');
    });

    it('should convert exp', () => {
      const result = compiler.compile("SELECT exp(duration) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('exp(');
    });

    it('should convert numeric to toDouble', () => {
      const result = compiler.compile("SELECT numeric('123') FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('toDouble(');
    });

    it('should convert string to toString', () => {
      const result = compiler.compile("SELECT string(httpResponseCode) FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('toString(');
    });

    it('should convert if(cond, a, b)', () => {
      const result = compiler.compile("SELECT if(duration > 1, 'slow', 'fast') FROM Transaction LIMIT 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('if(');
    });
  });

  // =========================================================================
  // Group 14c: Every time function
  // =========================================================================
  describe('Group 14c: Time Functions', () => {
    it('should convert dateOf to formatTimestamp', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET dateOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('formatTimestamp(');
    });

    it('should convert hourOf to getHour', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET hourOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getHour(');
    });

    it('should convert minuteOf to getMinute', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET minuteOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getMinute(');
    });

    it('should convert dayOfWeek to getDayOfWeek', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET dayOfWeek(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getDayOfWeek(');
    });

    it('should convert weekOf to getWeekOfYear', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET weekOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getWeekOfYear(');
    });

    it('should convert monthOf to getMonth', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET monthOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getMonth(');
    });

    it('should convert yearOf to getYear', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET yearOf(timestamp)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('getYear(');
    });

    it('should convert aggregationendtime to end()', () => {
      const result = compiler.compile("SELECT aggregationendtime(), count(*) FROM Transaction TIMESERIES 1 hour");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('end(');
    });
  });

  // =========================================================================
  // Group 14d: Every event type -> DQL data source
  // =========================================================================
  describe('Group 14d: Event Types', () => {
    it('should map Transaction to fetch spans', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch spans');
    });

    it('should map TransactionError to fetch spans with otel status', () => {
      const result = compiler.compile("SELECT count(*) FROM TransactionError");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('fetch spans');
      expect(code).toContain('otel.status_code');
    });

    it('should map Span to fetch spans', () => {
      const result = compiler.compile("SELECT count(*) FROM Span");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch spans');
    });

    it('should map Log to fetch logs', () => {
      const result = compiler.compile("FROM Log SELECT count(*)");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch logs');
    });

    it('should map LogEvent to fetch logs', () => {
      const result = compiler.compile("SELECT count(*) FROM LogEvent");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch logs');
    });

    it('should map SystemSample to timeseries', () => {
      const result = compiler.compile("SELECT average(cpuPercent) FROM SystemSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map ProcessSample to timeseries', () => {
      const result = compiler.compile("SELECT average(cpuPercent) FROM ProcessSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map NetworkSample to timeseries', () => {
      const result = compiler.compile("SELECT average(transmitBytesPerSecond) FROM NetworkSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map K8sContainerSample to timeseries', () => {
      const result = compiler.compile("SELECT average(cpuUsedCores) FROM K8sContainerSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map K8sNodeSample to timeseries', () => {
      const result = compiler.compile("SELECT average(cpuUsedCores) FROM K8sNodeSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map K8sPodSample to timeseries', () => {
      const result = compiler.compile("SELECT average(cpuUsedCores) FROM K8sPodSample TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should map K8sClusterSample', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sClusterSample");
      assertValidDql(result);
    });

    it('should map K8sDeploymentSample', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sDeploymentSample");
      assertValidDql(result);
    });

    it('should map PageView to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM PageView");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });

    it('should map PageAction to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM PageAction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });

    it('should map BrowserInteraction to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM BrowserInteraction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });

    it('should map JavaScriptError to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM JavaScriptError");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });

    it('should map AjaxRequest to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM AjaxRequest");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });

    it('should map SyntheticCheck to synthetic', () => {
      const result = compiler.compile("SELECT count(*) FROM SyntheticCheck");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('dt.synthetic');
    });

    it('should map InfrastructureEvent to events', () => {
      const result = compiler.compile("SELECT count(*) FROM InfrastructureEvent");
      assertValidDql(result);
    });

    it('should map AwsLambdaInvocation to fetch spans', () => {
      const result = compiler.compile("SELECT count(*) FROM AwsLambdaInvocation");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch spans');
    });

    it('should map NrCustomAppEvent to fetch bizevents', () => {
      const result = compiler.compile("SELECT count(*) FROM NrCustomAppEvent");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch bizevents');
    });
  });

  // =========================================================================
  // Group 14e: Critical field mappings
  // =========================================================================
  describe('Group 14e: Field Mappings', () => {
    it('should map appName to service.name', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName = 'x'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('service.name');
    });

    it('should map host to host.name', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET host");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('host.name');
    });

    it('should map hostname to host.name', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET hostname");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('host.name');
    });

    it('should map httpResponseCode to http.response.status_code', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET httpResponseCode");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('http.response.status_code');
    });

    it('should map http.statusCode to http.response.status_code', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE http.statusCode = 200");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('http.response.status_code');
    });

    it('should map transactionType to span.kind', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE transactionType = 'Web'");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('span.kind');
      expect(code).not.toContain('transactionType');
    });

    it('should map request.uri to http.request.path', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE request.uri LIKE '%api%'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('http.request.path');
    });

    it('should map request.method to http.request.method', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET request.method");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('http.request.method');
    });

    it('should map errorType to error.type', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET errorType");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('error.type');
      expect(code).not.toContain('errorType');
    });

    it('should map errorMessage to error.message', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET errorMessage");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('error.message');
    });

    it('should map message to content for Log', () => {
      const result = compiler.compile("SELECT count(*) FROM Log WHERE message LIKE '%error%'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('content');
    });

    it('should map level to loglevel for Log', () => {
      const result = compiler.compile("SELECT count(*) FROM Log WHERE level = 'ERROR'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('loglevel');
    });

    it('should map traceId to trace_id', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET traceId");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('trace_id');
    });

    it('should map parentId to span.parent_id', () => {
      const result = compiler.compile("SELECT count(*) FROM Span FACET parentId");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('span.parent_id');
    });

    it('should map clusterName to k8s.cluster.name', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sContainerSample WHERE clusterName = 'test'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('k8s.cluster.name');
    });

    it('should map podName to k8s.pod.name', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sContainerSample FACET podName");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('k8s.pod.name');
    });

    it('should map containerName to k8s.container.name', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sContainerSample FACET containerName");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('k8s.container.name');
    });

    it('should map nodeName to k8s.node.name', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sNodeSample FACET nodeName");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('k8s.node.name');
    });

    it('should map namespaceName to k8s.namespace.name', () => {
      const result = compiler.compile("SELECT count(*) FROM K8sContainerSample FACET namespaceName");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('k8s.namespace.name');
    });

    it('should map deploymentName to k8s.deployment.name', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET deploymentName");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('k8s.deployment.name');
      expect(code).not.toContain('deploymentName');
    });

    it('should map pageUrl to page.url', () => {
      const result = compiler.compile("SELECT count(*) FROM PageView FACET pageUrl");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('page.url');
    });

    it('should map userAgentName to browser.name', () => {
      const result = compiler.compile("SELECT count(*) FROM PageView FACET userAgentName");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('browser.name');
    });

    it('should map databaseCallCount to db.call_count', () => {
      const result = compiler.compile("SELECT sum(databaseCallCount) FROM Transaction");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('db.call_count');
      expect(code).not.toContain('databaseCallCount');
    });

    it('should map externalCallCount to http.call_count', () => {
      const result = compiler.compile("SELECT sum(externalCallCount) FROM Transaction");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('http.call_count');
      expect(code).not.toContain('externalCallCount');
    });
  });

  // =========================================================================
  // Group 14f: Every operator/condition type
  // =========================================================================
  describe('Group 14f: Operators', () => {
    it('should convert = to ==', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName = 'test'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('== "test"');
    });

    it('should preserve !=', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName != 'test'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('!= "test"');
    });

    it('should preserve >', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE duration > 1");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('> 1');
    });

    it('should preserve >=', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE duration >= 0.5");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('>= 500us');
    });

    it('should preserve <', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE duration < 2");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('< 2');
    });

    it('should preserve <=', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE duration <= 10");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('<= 10');
    });

    it('should handle IS NULL', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE error IS NULL");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('isNull(');
    });

    it('should handle IS NOT NULL', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE error IS NOT NULL");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('isNotNull(');
    });

    it('should handle IN list', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName IN ('a', 'b', 'c')");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('in(service.name, {"a", "b", "c"})');
    });

    it('should handle NOT IN list', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName NOT IN ('x', 'y')");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('not in(service.name, {"x", "y"})');
    });

    it('should convert LIKE %x% to contains', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE name LIKE '%payment%'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('contains(');
    });

    it('should convert LIKE x% to startsWith', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE name LIKE 'api/%'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('startsWith(');
    });

    it('should convert LIKE %x to endsWith', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE name LIKE '%/health'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('endsWith(');
    });

    it('should convert NOT LIKE to not(contains(', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE name NOT LIKE '%test%'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('not(contains(');
    });

    it('should convert RLIKE (no raw RLIKE)', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE name RLIKE '.*api.*'");
      assertValidDql(result);
      expect(codeLines(result.dql)).not.toContain('RLIKE');
    });

    it('should handle IS true', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE error IS true");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('== true');
    });

    it('should handle IS false', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE error IS false");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('== false');
    });

    it('should preserve AND', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName = 'a' AND duration > 1");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain(' and ');
    });

    it('should preserve OR', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName = 'a' OR appName = 'b'");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain(' or ');
    });

    it('should handle nested AND/OR', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction WHERE (appName = 'a' OR appName = 'b') AND duration > 1");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain(' or ');
      expect(code).toContain(' and ');
    });
  });

  // =========================================================================
  // Group 14g: Every alias edge case
  // =========================================================================
  describe('Group 14g: Aliases', () => {
    it('should backtick alias "duration"', () => {
      const result = compiler.compile("SELECT average(duration) AS 'duration' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`duration`=');
    });

    it('should backtick alias "timestamp"', () => {
      const result = compiler.compile("SELECT max(timestamp) AS 'timestamp' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`timestamp`=');
    });

    it('should backtick alias "from"', () => {
      const result = compiler.compile("SELECT count(*) AS 'from' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`from`=');
    });

    it('should backtick alias "to"', () => {
      const result = compiler.compile("SELECT count(*) AS 'to' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`to`=');
    });

    it('should backtick alias "in"', () => {
      const result = compiler.compile("SELECT count(*) AS 'in' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`in`=');
    });

    it('should backtick alias "filter"', () => {
      const result = compiler.compile("SELECT count(*) AS 'filter' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`filter`=');
    });

    it('should backtick alias "fetch"', () => {
      const result = compiler.compile("SELECT count(*) AS 'fetch' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`fetch`=');
    });

    it('should backtick alias "sort"', () => {
      const result = compiler.compile("SELECT count(*) AS 'sort' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`sort`=');
    });

    it('should backtick alias "not"', () => {
      const result = compiler.compile("SELECT count(*) AS 'not' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`not`=');
    });

    it('should backtick alias "true"', () => {
      const result = compiler.compile("SELECT count(*) AS 'true' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`true`=');
    });

    it('should backtick alias "null"', () => {
      const result = compiler.compile("SELECT count(*) AS 'null' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`null`=');
    });

    it('should backtick digit-prefix alias 2XX', () => {
      const result = compiler.compile(
        "SELECT percentage(count(*), WHERE http.statusCode >= 200 AND http.statusCode < 300) " +
        "AS '2XX' FROM Transaction"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`2XX`');
    });

    it('should backtick digit-prefix alias 4XX', () => {
      const result = compiler.compile(
        "SELECT percentage(count(*), WHERE http.statusCode >= 400 AND http.statusCode < 500) " +
        "AS '4XX' FROM Transaction"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`4XX`');
    });

    it('should backtick digit-prefix alias 5XX', () => {
      const result = compiler.compile(
        "SELECT percentage(count(*), WHERE http.statusCode >= 500) AS '5XX' FROM Transaction"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`5XX`');
    });

    it('should backtick special char alias $/Month', () => {
      const result = compiler.compile("SELECT count(*) / 1000 AS '$/Month' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`$/Month`');
    });

    it('should backtick space alias "Requests thousands"', () => {
      const result = compiler.compile("SELECT count(*) / 1000 AS 'Requests thousands' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`Requests thousands`');
    });

    it('should backtick dot alias "Avg.Duration"', () => {
      const result = compiler.compile("SELECT average(duration) AS 'Avg.Duration' FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('`Avg.Duration`');
    });

    it('should handle parens alias "Count (total)"', () => {
      const result = compiler.compile("SELECT count(*) AS 'Count (total)' FROM Transaction");
      assertValidDql(result);
    });

    it('should handle ampersand alias "P&L"', () => {
      const result = compiler.compile("SELECT count(*) AS 'P&L' FROM Transaction");
      assertValidDql(result);
    });
  });

  // =========================================================================
  // Group 14h: Timeseries, Compare With, Slide By
  // =========================================================================
  describe('Group 14h: Timeseries', () => {
    it('should convert TIMESERIES to makeTimeseries', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction TIMESERIES");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('makeTimeseries');
    });

    it('should handle TIMESERIES 5 minutes interval', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction TIMESERIES 5 minutes");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('interval: 5m');
    });

    it('should handle TIMESERIES 1 hour interval', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction TIMESERIES 1 hour");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('interval: 1h');
    });

    it('should handle TIMESERIES AUTO (no interval)', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction TIMESERIES AUTO");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('makeTimeseries');
      expect(code).not.toContain('interval:');
    });

    it('should strip SINCE/UNTIL from output', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction SINCE 1 hour ago UNTIL 30 minutes ago");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).not.toContain('SINCE');
      expect(code).not.toContain('UNTIL');
    });

    it('should strip EXTRAPOLATE from output', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction EXTRAPOLATE");
      assertValidDql(result);
      expect(codeLines(result.dql)).not.toContain('EXTRAPOLATE');
    });

    it('should use shift for COMPARE WITH on metric', () => {
      const result = compiler.compile("SELECT average(cpuPercent) FROM SystemSample TIMESERIES COMPARE WITH 1 week ago");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('shift:-7d');
    });

    it('should handle COMPARE WITH on span (comment)', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction TIMESERIES COMPARE WITH 1 day ago");
      assertValidDql(result);
    });

    it('should convert SLIDE BY to rolling', () => {
      const result = compiler.compile("SELECT average(duration) FROM Transaction TIMESERIES 5 minutes SLIDE BY 1 minute");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('rolling(');
    });

    it('should convert SLIDE BY AUTO to rolling', () => {
      const result = compiler.compile("SELECT average(duration) FROM Transaction TIMESERIES 10 minutes SLIDE BY AUTO");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('rolling(');
    });

    it('should handle LIMIT N', () => {
      const result = compiler.compile("SELECT count(*) FROM Transaction FACET appName LIMIT 25");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('limit 25');
    });
  });

  // =========================================================================
  // Group 14i: Complex real-world patterns
  // =========================================================================
  describe('Group 14i: Real-World Patterns', () => {
    it('should handle error rate filter/filter * 100', () => {
      const result = compiler.compile(
        "SELECT filter(count(*), WHERE error IS true) / filter(count(*), WHERE duration > 0) * 100 " +
        "AS 'Error Rate' FROM Transaction WHERE appName = 'prod-order-api' TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should handle multi percentage status codes', () => {
      const result = compiler.compile(
        "SELECT percentage(count(http.statusCode), WHERE http.statusCode >= 200 AND http.statusCode < 300) AS '2XX', " +
        "percentage(count(http.statusCode), WHERE http.statusCode >= 400 AND http.statusCode < 500) AS '4XX', " +
        "percentage(count(http.statusCode), WHERE http.statusCode >= 500) AS '5XX' " +
        "FROM Transaction WHERE appName = 'prod-auth-api' TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should handle K8s memory util multi metric', () => {
      const result = compiler.compile(
        "SELECT latest(memoryUsedBytes) / latest(memoryLimitBytes) * 100 " +
        "FROM K8sContainerSample WHERE clusterName = 'app-prod' FACET podName TIMESERIES"
      );
      assertValidDql(result);
    });

    it('should handle log error by service and level', () => {
      const result = compiler.compile(
        "FROM Log SELECT count(*) WHERE level IN ('ERROR', 'FATAL') FACET service.name, level TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('fetch logs');
    });

    it('should handle throughput multi app', () => {
      const result = compiler.compile(
        "SELECT rate(count(*), 1 minute) FROM Transaction " +
        "WHERE appName IN ('api-1', 'api-2', 'api-3') FACET appName TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('in(service.name');
    });

    it('should handle subquery trace correlation', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE appName = 'order-api' " +
        "AND trace.id IN (FROM Span SELECT trace.id WHERE appName = 'auth-api' " +
        "AND name = 'authenticate') FACET httpResponseCode TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('lookup');
    });

    it('should handle funnel analysis', () => {
      const result = compiler.compile(
        "SELECT funnel(session, WHERE page = '/home' AS 'Home', " +
        "WHERE page = '/cart' AS 'Cart', WHERE page = '/checkout' AS 'Checkout') FROM PageView"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should handle count/avg/p95/filter combined', () => {
      const result = compiler.compile(
        "SELECT count(*) AS 'Total', average(duration) AS 'Avg', " +
        "percentile(duration, 95) AS 'P95', " +
        "filter(count(*), WHERE error IS true) AS 'Errors' " +
        "FROM Transaction WHERE appName = 'prod-api' TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf(');
    });

    it('should handle infra CPU with hostname filter', () => {
      const result = compiler.compile(
        "SELECT average(cpuPercent) FROM SystemSample WHERE hostname LIKE 'prod-%' FACET hostname TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries');
    });

    it('should handle clamp_max/clamp_min combined', () => {
      const result = compiler.compile(
        "SELECT clamp_max(average(duration), 10), clamp_min(count(*), 0) FROM Transaction"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('if(');
    });

    it('should handle FROM prefix non-standard order', () => {
      const result = compiler.compile(
        "FROM Transaction SELECT count(*), average(duration) WHERE appName = 'test' FACET appName TIMESERIES AUTO"
      );
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('fetch spans');
      expect(code).toContain('service.name');
    });

    it('should handle custom event facet limit', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM NrCustomAppEvent WHERE eventType = 'OrderPlaced' FACET customerSegment LIMIT 20"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('limit 20');
    });
  });

  // =========================================================================
  // Group 14j: Session 69 regression tests
  // =========================================================================
  describe('Group 14j: Session 69 Regression', () => {
    it('should handle matchesPhrase in CASES', () => {
      const result = compiler.compile(
        'SELECT count(*) FROM BrowserInteraction FACET CASES ' +
        '(matchesPhrase(targetUrl, "/search2") as \'Coveo\', ' +
        'matchesPhrase(targetUrl, "/search") as \'Legacy\')'
      );
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('contains(targetUrl');
      expect(code).toContain('"Coveo"');
      expect(code).toContain('"Legacy"');
    });

    it('should handle multi-line NRQL', () => {
      const result = compiler.compile("SELECT\n  count(*)\nFROM\n  Transaction");
      assertValidDql(result);
      const firstLine = result.dql.split('\n')[0];
      expect(firstLine.includes('\n') === false || firstLine.startsWith('//')).toBe(true);
    });

    it('should handle apdex t:3 threshold', () => {
      const result = compiler.compile("SELECT apdex(duration, t:3) FROM BrowserInteraction");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('countIf(duration < 3');
      expect(code).toContain('countIf(duration >= 3');
    });

    it('should handle apdex t:0.5 threshold', () => {
      const result = compiler.compile("SELECT apdex(duration, t:0.5) FROM BrowserInteraction");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('countIf(duration < 0.5');
      expect(code).toContain('countIf(duration >= 0.5');
    });

    it('should handle K8s isReady entity fetch', () => {
      const result = compiler.compile("SELECT latest(isReady) FROM K8sPodSample WHERE clusterName = 'prod'");
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('entity');
      expect(code).not.toContain('timeseries');
    });
  });

  // =========================================================================
  // Group 14k: Audit fixes
  // =========================================================================
  describe('Group 14k: Audit Fixes', () => {
    it('should preserve id dimension in metric context', () => {
      const result = compiler.compile(
        "SELECT latest(consumer_lag) FROM Metric WHERE id = 'lkc_123' FACET topic"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).not.toContain('span.id');
    });

    it('should preserve target dimension in metric context', () => {
      const result = compiler.compile(
        "SELECT average(kafka.consumer.lag) FROM Metric WHERE target = 'my-cluster'"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).not.toContain('http.route');
    });

    it('should map entity.name in span context', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction WHERE entity.name = 'my-svc'"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('dt.entity.name');
    });

    it('should handle percentage simple (no nested agg)', () => {
      const result = compiler.compile(
        "SELECT percentage(count(*), WHERE error IS TRUE) FROM Transaction"
      );
      assertValidDql(result);
      const code = codeLines(result.dql);
      expect(code).toContain('countIf');
      expect(code).toContain('count()');
    });

    it('should produce apdex warning', () => {
      const result = compiler.compile("SELECT apdex(duration, t:0.5) FROM Transaction");
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('countIf');
      expect(result.warnings.some((w) => w.includes('apdex'))).toBe(true);
    });

    it('should use braces for multi metric', () => {
      const result = compiler.compile(
        "SELECT average(cpuPercent), average(memoryUsedPercent) FROM SystemSample FACET hostname TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('timeseries {');
    });

    it('should use filter braces for metric filter', () => {
      const result = compiler.compile(
        "SELECT average(cpuPercent) FROM SystemSample WHERE hostname = 'web-1' TIMESERIES"
      );
      assertValidDql(result);
      expect(codeLines(result.dql)).toContain('filter:{');
    });
  });

  // =========================================================================
  // Phase 1 Regression: COMPARE WITH Append
  // =========================================================================
  describe('Phase 1 Regression: COMPARE WITH Append', () => {
    it('should generate append for day-over-day compare', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction COMPARE WITH 1 day ago SINCE 1 hour ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('append');
      expect(result.dql).toContain('from:now()-1d');
      expect(result.dql).toContain('_comparison = "current"');
      expect(result.dql).toContain('_comparison = "previous');
    });

    it('should generate append for week-over-week compare', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction COMPARE WITH 1 week ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('append');
      expect(result.dql).toContain('from:now()-7d');
    });

    it('should generate append with facet for compare', () => {
      const result = compiler.compile(
        "SELECT count(*) FROM Transaction FACET appName COMPARE WITH 1 day ago"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('append');
      expect(result.dql).toContain('by:');
      // Both current and shifted pipelines should have the facet
      const byCount = (result.dql.match(/by:/g) || []).length;
      expect(byCount).toBeGreaterThanOrEqual(2);
    });

    it('should still use shift for metric compare', () => {
      const result = compiler.compile(
        "SELECT average(cpuPercent) FROM SystemSample COMPARE WITH 1 day ago TIMESERIES"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('shift:-1d');
      expect(result.dql).not.toContain('append');
    });
  });

  // =========================================================================
  // Phase 1 Regression: capture() Function
  // =========================================================================
  describe('Phase 1 Regression: Capture Function', () => {
    it('should convert capture with named groups', () => {
      const result = compiler.compile(
        String.raw`SELECT capture(message, '(?P<method>\w+)\s+(?P<path>/\S+)') FROM Log`
      );
      expect(result.success).toBe(true);
      // Without RegexToDPLConverter, falls back to extract()
      expect(result.dql).toContain('extract(');
      expect(result.dql).toContain('method');
      expect(result.dql).toContain('path');
    });

    it('should convert capture with digit group', () => {
      const result = compiler.compile(
        String.raw`SELECT capture(message, '(?P<status>\d+)') FROM Log`
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('extract(');
      expect(result.dql).toContain('status');
    });

    it('should preserve field mapping in capture (message -> content)', () => {
      const result = compiler.compile(
        String.raw`SELECT capture(message, '(?P<code>\d+)') FROM Log`
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('content');
    });
  });

  // =========================================================================
  // Phase 1 Regression: Nested Filter in Aggregation
  // =========================================================================
  describe('Phase 1 Regression: Nested Filter in Aggregation', () => {
    it('should convert count with filter to countIf', () => {
      const result = compiler.compile(
        "SELECT count(*, filter(WHERE error IS TRUE)) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('countIf(');
      expect(result.dql).toContain('error == true');
    });

    it('should convert sum with filter to sumIf', () => {
      const result = compiler.compile(
        "SELECT sum(duration, filter(WHERE appName = 'api')) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('sumIf(');
      expect(result.dql).toContain('duration');
    });

    it('should convert average with filter to avgIf', () => {
      const result = compiler.compile(
        "SELECT average(duration, filter(WHERE httpResponseCode >= 500)) FROM Transaction"
      );
      expect(result.success).toBe(true);
      expect(result.dql).toContain('avgIf(');
      expect(result.dql).toContain('duration');
    });
  });

  // =========================================================================
  // Issue gh #13 (Dynatrace-NewRelic): golden-metric alias expansion bug.
  //
  // Pre-lex shorthand expansion used `\b<name>\b` which matched the trailing
  // `throughput` in `newrelic.goldenmetrics.apm.application.throughput`
  // because `\b` treats `.` → `t` as a word boundary. The fix uses
  // `(?<![.\w])<name>\b` so the shorthand is only expanded when the name
  // appears as a standalone token.
  // =========================================================================
  describe('Shorthand lookbehind regression (gh #13)', () => {
    it('preserves `throughput` at end of a dotted metric identifier', () => {
      const result = compiler.compile(
        "SELECT average(`newrelic.goldenmetrics.apm.application.throughput`) "
        + "FROM Metric FACET entity.guid, appName"
      );
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('rate(count(*), 1 minute)');
      expect(result.dql).not.toContain('count(*)');
      expect(result.dql).toContain('newrelic.goldenmetrics.apm.application.throughput');
    });

    it('preserves `errorRate` at end of a dotted metric identifier', () => {
      const result = compiler.compile(
        "SELECT average(`newrelic.goldenmetrics.apm.application.errorRate`) FROM Metric"
      );
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('percentage(count(*)');
      expect(result.dql).toContain('newrelic.goldenmetrics.apm.application.errorRate');
    });

    it('preserves `apdexScore` at end of a dotted metric identifier', () => {
      const result = compiler.compile(
        "SELECT latest(`some.vendor.apdexScore`) FROM Metric"
      );
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('apdex(duration)');
      expect(result.dql).toContain('some.vendor.apdexScore');
    });

    it('still expands bare `throughput`', () => {
      const result = compiler.compile("SELECT throughput FROM Transaction");
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('throughput');
    });

    it('still expands bare `errorRate`', () => {
      const result = compiler.compile("SELECT errorRate FROM Transaction");
      expect(result.success).toBe(true);
      expect(result.dql).not.toContain('errorRate');
    });

    it('emits a well-formed metric identifier (no function call leak)', () => {
      const result = compiler.compile(
        "SELECT average(`newrelic.goldenmetrics.apm.application.throughput`) FROM Metric"
      );
      expect(result.success).toBe(true);
      const m = result.dql.match(/avg\(([^)]+)\)/);
      expect(m).not.toBeNull();
      const metricIdent = (m![1] as string).trim();
      expect(metricIdent).toMatch(/^[a-zA-Z][\w.]*$/);
    });
  });
});
