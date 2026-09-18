/**
 * Gen3 `builtin:davis.anomaly-detectors` v1.0.14 shape regressions.
 *
 * Mirrors Python tests in NewRelic-to-Dynatrace-Migration-Utilities:
 * `tests/unit/test_phase17_modules.py::TestAnomalyDetectorGen3Schema`,
 * `tests/unit/test_dynatrace_client.py::TestAnomalyDetectorWirePayload` and
 * `::TestAnalyzerInputQueryIsDql`.
 */

import { vi, describe, it, expect, type Mock } from 'vitest';
import axios from 'axios';

import {
  AlertTransformer,
  NonNrqlAlertConditionTransformer,
} from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';
import { FALLBACK_QUERY, nrqlToAnalyzerQuery } from '../../src/transformers/detector-utils.js';
import { tasksListToDict } from '../../src/transformers/workflow-utils.js';
import { DynatraceClient } from '../../src/clients/index.js';

vi.mock('axios', () => {
  const instance = { request: vi.fn() };
  return { default: { create: vi.fn(() => instance), isAxiosError: vi.fn(() => false) } };
});

const REQUIRED_VALUE_FIELDS = ['enabled', 'title', 'description', 'source', 'executionSettings', 'analyzer', 'eventTemplate'];
const FORBIDDEN_VALUE_FIELDS = ['name', 'strategy'];
const ALLOWED_QUERY_PREFIXES = ['fetch', 'timeseries', '//'];
const FORBIDDEN_NRQL_TOKENS = ['SELECT', 'FROM '];

function alertDetector(nrql: string): { det: DTAnomalyDetector; warnings: string[] } {
  const r = new AlertTransformer().transform({
    name: 'Golden Signals',
    id: 'pol-1',
    conditions: [
      {
        conditionType: 'NRQL',
        name: 'latency',
        nrql: { query: nrql },
        terms: [{ threshold: 500, priority: 'critical', operator: 'ABOVE' }],
      },
    ],
  });
  expect(r.success).toBe(true);
  return { det: r.data!.anomalyDetectors[0]!, warnings: r.warnings };
}

function nonNrqlDetector(): DTAnomalyDetector {
  const r = new NonNrqlAlertConditionTransformer().transform({
    conditionType: 'APM',
    name: 'svc',
    metric: 'apm.service.errorRate',
    terms: [{ priority: 'critical', threshold: 1 }],
  });
  return r.data!.anomalyDetectors[0]!;
}

function queryOf(det: DTAnomalyDetector): string {
  return det.value.analyzer.input.find((i) => i.key === 'query')!.value;
}

function codeOnly(query: string): string {
  return query
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

const SUBJECTS: Array<[string, () => DTAnomalyDetector]> = [
  ['AlertTransformer', () => alertDetector('SELECT average(duration) FROM Transaction FACET appName').det],
  ['NonNrqlAlertConditionTransformer', nonNrqlDetector],
];

describe.each(SUBJECTS)('%s — v1.0.14 detector shape', (_label, make) => {
  it('has all required value fields', () => {
    const value = make().value as unknown as Record<string, unknown>;
    for (const f of REQUIRED_VALUE_FIELDS) expect(value).toHaveProperty(f);
  });

  it('has no forbidden value fields', () => {
    const value = make().value as unknown as Record<string, unknown>;
    for (const f of FORBIDDEN_VALUE_FIELDS) expect(value).not.toHaveProperty(f);
  });

  it('source is text, not an object', () => {
    expect(make().value.source).toBe('newrelic-migration');
  });

  it('executionSettings is empty (actor injected at import — D16)', () => {
    expect(make().value.executionSettings).toEqual({});
  });

  it('envelope has only Settings fields (no detectorId — D3)', () => {
    expect(Object.keys(make()).sort()).toEqual(['schemaId', 'scope', 'value']);
  });

  it('eventTemplate contains only properties, all non-empty {key,value}', () => {
    const et = make().value.eventTemplate;
    expect(Object.keys(et)).toEqual(['properties']);
    for (const p of et.properties) {
      expect(Object.keys(p).sort()).toEqual(['key', 'value']);
      expect(typeof p.value).toBe('string');
      expect(p.value.length).toBeGreaterThan(0);
    }
  });

  it('analyzer has canonical name and string {key,value} inputs with minLength 1', () => {
    const analyzer = make().value.analyzer;
    expect(analyzer.name).toBe(
      'dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer',
    );
    for (const item of analyzer.input) {
      expect(Object.keys(item).sort()).toEqual(['key', 'value']);
      expect(typeof item.key).toBe('string');
      expect(typeof item.value).toBe('string');
      expect(item.value.length).toBeGreaterThan(0);
    }
  });

  it('analyzer query is DQL, not NRQL', () => {
    const q = queryOf(make());
    expect(ALLOWED_QUERY_PREFIXES).toContain(q.trimStart().split(/\s+/)[0]);
    for (const tok of FORBIDDEN_NRQL_TOKENS) expect(codeOnly(q)).not.toContain(tok);
  });

  it('emits no classic dt.entity references anywhere', () => {
    expect(JSON.stringify(make())).not.toContain('dt.entity');
  });
});

describe('Analyzer input query is DQL (AlertTransformer)', () => {
  it('compiles a golden-metric NRQL to DQL', () => {
    const { det } = alertDetector(
      'SELECT average(`newrelic.goldenmetrics.apm.application.throughput`) FROM Metric FACET entity.guid, appName',
    );
    const q = queryOf(det);
    expect(ALLOWED_QUERY_PREFIXES).toContain(q.trimStart().split(/\s+/)[0]);
    for (const tok of FORBIDDEN_NRQL_TOKENS) expect(codeOnly(q)).not.toContain(tok);
    expect(q).not.toContain('dt.entity');
  });

  it('falls back to commented placeholder for unparseable NRQL', () => {
    const { det, warnings } = alertDetector('SELECT FROM WHERE ((( nonsense');
    const q = queryOf(det);
    expect(q.startsWith('// UNCONVERTED NRQL: SELECT FROM WHERE ((( nonsense\n')).toBe(true);
    expect(codeOnly(q)).toBe(FALLBACK_QUERY);
    expect(q).not.toContain('timeseries count()'); // D11: count() without a metric is invalid
    expect(warnings.some((w) => w.includes('placeholder query'))).toBe(true);
  });

  it('nrqlToAnalyzerQuery returns placeholder for empty NRQL', () => {
    expect(nrqlToAnalyzerQuery('   ')).toBe(FALLBACK_QUERY);
  });

  it('nrqlToAnalyzerQuery falls back on LOW confidence', () => {
    const warnings: string[] = [];
    const fake = {
      compile: () => ({ success: true, dql: 'fetch logs', confidence: 'LOW' }),
    } as never;
    expect(nrqlToAnalyzerQuery('SELECT  x\n FROM y', warnings, fake)).toBe(
      `// UNCONVERTED NRQL: SELECT x FROM y\n${FALLBACK_QUERY}`,
    );
    expect(warnings[0]).toContain('LOW');
  });
});

describe('Anomaly detector wire payload (DynatraceClient.createSettingsObject)', () => {
  it('serialized POST body matches the v1.0.14 schema', async () => {
    const client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com',
      rateLimit: 0,
    });
    const createMock = axios.create as Mock;
    const http = createMock.mock.results[createMock.mock.results.length - 1]!.value as {
      request: Mock;
    };
    http.request.mockResolvedValueOnce({ data: [{ objectId: 'o1' }], status: 200, statusText: 'OK' });

    const { det } = alertDetector('SELECT average(duration) FROM Transaction');
    await client.createSettingsObject(
      det.schemaId,
      det.value as unknown as Record<string, unknown>,
      det.scope,
    );

    const cfg = http.request.mock.calls[0]![0] as { data: unknown };
    // Round-trip through JSON exactly as axios serializes the body.
    const body = JSON.parse(JSON.stringify(cfg.data)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!['schemaId']).toBe('builtin:davis.anomaly-detectors');
    const value = body[0]!['value'] as Record<string, unknown>;
    for (const f of ['title', 'source', 'analyzer', 'executionSettings']) {
      expect(value).toHaveProperty(f);
    }
    for (const f of FORBIDDEN_VALUE_FIELDS) expect(value).not.toHaveProperty(f);
    expect(typeof value['source']).toBe('string');
    expect(Object.keys(value['eventTemplate'] as object)).toEqual(['properties']);
    expect(value['executionSettings']).toEqual({});
    const analyzer = value['analyzer'] as { name: string; input: Array<{ value: unknown }> };
    expect(analyzer.name.startsWith('dt.statistics.ui.anomaly_detection.')).toBe(true);
    expect(analyzer.input.every((i) => typeof i.value === 'string' && i.value !== '')).toBe(true);
  });
});

describe('tasksListToDict', () => {
  it('keys by slugged name, suffixes collisions, preserves order', () => {
    const out = tasksListToDict([
      { name: 'Send Email' },
      { name: 'send-email' },
      { name: '' },
      { name: 'send_email' },
    ]);
    expect(Object.keys(out)).toEqual(['send_email', 'send_email_2', 'task_2', 'send_email_3']);
  });

  it('is idempotent on dict input', () => {
    const dict = { a: { name: 'a' } };
    expect(tasksListToDict(dict)).toBe(dict);
  });
});
