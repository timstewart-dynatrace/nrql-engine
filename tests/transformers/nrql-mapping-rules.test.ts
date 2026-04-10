/**
 * Tests for compiler/emitter.ts — NRQL-to-DQL mapping tables.
 *
 * Ported from Python: tests/unit/test_nrql_mapping_rules.py (62 tests)
 * Adapted for TypeScript map names and values:
 *   Python EVENT_TYPE_MAP → TS EVENT_TYPE_MAP (alias for QUERY_CLASS_MAP)
 *   Python AGG_MAP        → TS FUNC_MAP
 *   Python ATTR_MAP       → TS FIELD_MAP
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPE_MAP,
  FIELD_MAP,
  FUNC_MAP,
} from '../../src/compiler/emitter.js';

// ─── EVENT_TYPE_MAP ──────────────────────────────────────────────────────────

describe('EVENT_TYPE_MAP', () => {
  it('should map transaction to spans', () => {
    expect(EVENT_TYPE_MAP['transaction']).toBe('spans');
  });

  it('should map transactionerror to spans', () => {
    expect(EVENT_TYPE_MAP['transactionerror']).toBe('spans');
  });

  it('should map span to spans', () => {
    expect(EVENT_TYPE_MAP['span']).toBe('spans');
  });

  it('should map log to logs', () => {
    expect(EVENT_TYPE_MAP['log']).toBe('logs');
  });

  it('should map metric to METRIC', () => {
    expect(EVENT_TYPE_MAP['metric']).toBe('METRIC');
  });

  it('should map systemsample to METRIC', () => {
    expect(EVENT_TYPE_MAP['systemsample']).toBe('METRIC');
  });

  it('should map processsample to METRIC', () => {
    expect(EVENT_TYPE_MAP['processsample']).toBe('METRIC');
  });

  it('should map k8s node sample', () => {
    expect(EVENT_TYPE_MAP['k8snodesample']).toBe('K8S_NODE_METRIC');
  });

  it('should map k8s container sample', () => {
    expect(EVENT_TYPE_MAP['k8scontainersample']).toBe('K8S_WORKLOAD_METRIC');
  });

  it('should map k8s pod sample', () => {
    expect(EVENT_TYPE_MAP['k8spodsample']).toBe('K8S_POD_METRIC');
  });

  it('should map syntheticcheck', () => {
    expect(EVENT_TYPE_MAP['syntheticcheck']).toBe('dt.synthetic.http.request');
  });

  it('should map pageview to bizevents', () => {
    expect(EVENT_TYPE_MAP['pageview']).toBe('bizevents');
  });

  it('should map browserinteraction to bizevents', () => {
    expect(EVENT_TYPE_MAP['browserinteraction']).toBe('bizevents');
  });

  it('should map javascripterror to bizevents', () => {
    expect(EVENT_TYPE_MAP['javascripterror']).toBe('bizevents');
  });

  it('should map infrastructureevent to EVENTS', () => {
    expect(EVENT_TYPE_MAP['infrastructureevent']).toBe('EVENTS');
  });

  it('should map lambda to spans', () => {
    expect(EVENT_TYPE_MAP['awslambdainvocation']).toBe('spans');
  });

  it('should map custom events to bizevents', () => {
    expect(EVENT_TYPE_MAP['nrcustomappevent']).toBe('bizevents');
  });
});

// ─── FUNC_MAP (Python: AGG_MAP) ─────────────────────────────────────────────

describe('FUNC_MAP', () => {
  // Core aggregations
  it('should map count', () => {
    expect(FUNC_MAP['count']).toBe('count');
  });

  it('should map sum', () => {
    expect(FUNC_MAP['sum']).toBe('sum');
  });

  it('should map average to avg', () => {
    expect(FUNC_MAP['average']).toBe('avg');
  });

  it('should map avg', () => {
    expect(FUNC_MAP['avg']).toBe('avg');
  });

  it('should map percentile', () => {
    expect(FUNC_MAP['percentile']).toBe('percentile');
  });

  it('should map stddev', () => {
    expect(FUNC_MAP['stddev']).toBe('stddev');
  });

  // NR-specific to DQL
  it('should map latest to takeLast', () => {
    expect(FUNC_MAP['latest']).toBe('takeLast');
  });

  it('should map earliest to takeFirst', () => {
    expect(FUNC_MAP['earliest']).toBe('takeFirst');
  });

  it('should map uniquecount to countDistinctExact', () => {
    expect(FUNC_MAP['uniquecount']).toBe('countDistinctExact');
  });

  it('should map uniques to collectDistinct', () => {
    expect(FUNC_MAP['uniques']).toBe('collectDistinct');
  });

  // String functions
  it('should map length to stringLength', () => {
    expect(FUNC_MAP['length']).toBe('stringLength');
  });

  it('should map concat', () => {
    expect(FUNC_MAP['concat']).toBe('concat');
  });

  // Math functions
  it('should map pow', () => {
    expect(FUNC_MAP['pow']).toBe('pow');
  });

  // Time functions
  it('should map hourof to getHour', () => {
    expect(FUNC_MAP['hourof']).toBe('getHour');
  });

  it('should map dayofweek to getDayOfWeek', () => {
    expect(FUNC_MAP['dayofweek']).toBe('getDayOfWeek');
  });

  it('should map weekof to getWeekOfYear', () => {
    expect(FUNC_MAP['weekof']).toBe('getWeekOfYear');
  });

  // Grail reference additions
  it('should map variance', () => {
    expect(FUNC_MAP['variance']).toBe('variance');
  });

  // String functions from Grail reference
  it('should map indexof to indexOf', () => {
    expect(FUNC_MAP['indexof']).toBe('indexOf');
  });

  it('should map startswith to startsWith', () => {
    expect(FUNC_MAP['startswith']).toBe('startsWith');
  });

  it('should map endswith to endsWith', () => {
    expect(FUNC_MAP['endswith']).toBe('endsWith');
  });

  it('should map matchesvalue to contains', () => {
    expect(FUNC_MAP['matchesvalue']).toBe('contains');
  });

  it('should map matchesphrase to contains', () => {
    expect(FUNC_MAP['matchesphrase']).toBe('contains');
  });

  it('should map trim', () => {
    expect(FUNC_MAP['trim']).toBe('trim');
  });

  // Boolean/conditional
  it('should map numeric to toDouble', () => {
    expect(FUNC_MAP['numeric']).toBe('toDouble');
  });

  // Type conversion
  it('should map tolong to toLong', () => {
    expect(FUNC_MAP['tolong']).toBe('toLong');
  });

  it('should map todouble to toDouble', () => {
    expect(FUNC_MAP['todouble']).toBe('toDouble');
  });

  // Additional TS-specific mappings
  it('should map rate to count', () => {
    expect(FUNC_MAP['rate']).toBe('count');
  });

  it('should map median to percentile', () => {
    expect(FUNC_MAP['median']).toBe('percentile');
  });

  it('should map substring', () => {
    expect(FUNC_MAP['substring']).toBe('substring');
  });

  it('should map lower', () => {
    expect(FUNC_MAP['lower']).toBe('lower');
  });

  it('should map upper', () => {
    expect(FUNC_MAP['upper']).toBe('upper');
  });

  it('should map capture to extract', () => {
    expect(FUNC_MAP['capture']).toBe('extract');
  });

  it('should map aparse to parse', () => {
    expect(FUNC_MAP['aparse']).toBe('parse');
  });

  it('should map replace to replaceAll', () => {
    expect(FUNC_MAP['replace']).toBe('replaceAll');
  });

  it('should map abs', () => {
    expect(FUNC_MAP['abs']).toBe('abs');
  });
});

// ─── FIELD_MAP (Python: ATTR_MAP) ──────────────────────────────────────────

describe('FIELD_MAP', () => {
  it('should map appName to service.name', () => {
    expect(FIELD_MAP['appName']).toBe('service.name');
  });

  it('should map host to host.name', () => {
    expect(FIELD_MAP['host']).toBe('host.name');
  });

  it('should map duration', () => {
    expect('duration' in FIELD_MAP).toBe(true);
  });

  it('should have HTTP attributes', () => {
    const httpAttrs = Object.keys(FIELD_MAP).filter(
      (k) => k.toLowerCase().includes('http') || k.includes('Http'),
    );
    expect(httpAttrs.length).toBeGreaterThan(0);
  });

  it('should have K8s attributes', () => {
    const k8sAttrs = Object.keys(FIELD_MAP).filter((k) => k.toLowerCase().includes('k8s'));
    expect(k8sAttrs.length).toBeGreaterThan(0);
  });

  it('should map hostname to host.name', () => {
    expect(FIELD_MAP['hostname']).toBe('host.name');
  });

  it('should map transactionname to span.name', () => {
    expect(FIELD_MAP['transactionname']).toBe('span.name');
  });

  it('should map httpresponsecode to status code', () => {
    expect(FIELD_MAP['httpresponsecode']).toBe('http.response.status_code');
  });

  it('should map message to content', () => {
    expect(FIELD_MAP['message']).toBe('content');
  });

  it('should map level to loglevel', () => {
    expect(FIELD_MAP['level']).toBe('loglevel');
  });
});
