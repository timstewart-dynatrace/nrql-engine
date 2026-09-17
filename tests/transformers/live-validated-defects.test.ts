/**
 * Live-validated Gen3 defect regressions (D1–D21).
 *
 * Mirrors Python NewRelic-to-Dynatrace-Migration-Utilities
 * `tests/unit/test_dynatrace_client.py`: `TestDetectorQueryIsTimeseries`,
 * `TestNonNrqlDetectorQueries`, `TestSeverityFanoutWorkflowsKept`,
 * `TestWorkflowTriggerAndEnvelopeShape`,
 * `TestDetectorInputsAcceptedBySettingsValidator`
 * (evidence: docs/live-validation-2026-09.md in that repo).
 */

import { describe, expect, it } from 'vitest';

import {
  AIOpsTransformer,
  AlertTransformer,
  BaselineAlertTransformer,
  InfrastructureTransformer,
  KeyTransactionTransformer,
  NonNrqlAlertConditionTransformer,
} from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';
import {
  FALLBACK_QUERY,
  GRAIL_METRIC_KEYS,
  addSplitDimension,
  alertConditionFor,
  dealertingSamples,
  ensureTimeseries,
  metricTimeseriesQuery,
  nrqlToAnalyzerQuery,
  sampleSettings,
} from '../../src/transformers/detector-utils.js';
import {
  davisProblemTrigger,
  migratedEventFilter,
  migratedEventName,
  type DTDavisProblemWorkflow,
} from '../../src/transformers/workflow-utils.js';
import type { NRNonNrqlConditionType } from '../../src/transformers/non-nrql-alert.transformer.js';

function inputs(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.analyzer.input.map((i) => [i.key, i.value]));
}

function props(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.eventTemplate.properties.map((p) => [p.key, p.value]));
}

function code(query: string): string {
  return query
    .split('\n')
    .filter((l) => !l.startsWith('//'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// D1 / D11
// ---------------------------------------------------------------------------

describe('Detector query is timeseries (D1/D11)', () => {
  it('summarize becomes makeTimeseries', () => {
    const dql = 'fetch spans\n| filter dt.service.name == "x"\n| summarize avg(duration), by: {span.name}';
    expect(ensureTimeseries(dql)).toBe(
      'fetch spans\n| filter dt.service.name == "x"\n| makeTimeseries avg(duration), by: {span.name}',
    );
  });

  it('percentage arithmetic is split into series', () => {
    const dql = 'fetch spans\n| summarize (100.0 * countIf(request.is_failed == true) / count())';
    expect(ensureTimeseries(dql)).toBe(
      'fetch spans\n| makeTimeseries { nr_agg0 = countIf(request.is_failed == true), nr_agg1 = count() }' +
        '\n| fieldsAdd value0 = (100.0 * nr_agg0[] / nr_agg1[])\n| fieldsRemove nr_agg0, nr_agg1',
    );
  });

  it('comments and timeseries pass through', () => {
    const dql = '// Original NRQL: x\ntimeseries avg(dt.host.cpu.usage), by: {host.name}';
    expect(ensureTimeseries(dql)).toBe(dql);
  });

  it('trailing sort/limit are dropped; other trailing stages are rejected', () => {
    expect(ensureTimeseries('fetch spans\n| summarize count()\n| sort count() desc\n| limit 10')).toBe(
      'fetch spans\n| makeTimeseries count()',
    );
    // `sorted` is not `sort`: commands match by whole name.
    expect(ensureTimeseries('fetch spans\n| summarize count()\n| sorted x')).toBeNull();
  });

  it('non-timeseries shapes are rejected', () => {
    expect(ensureTimeseries('smartscapeNodes K8S_POD | fields name')).toBeNull();
    expect(ensureTimeseries('fetch spans\n| summarize count()\n| fieldsAdd x = 1')).toBeNull();
    expect(ensureTimeseries('fetch spans\n| fields span.name')).toBeNull();
    expect(
      ensureTimeseries('fetch spans\n| summarize c = count(), by: {a}\n| summarize count()'),
    ).toBeNull();
  });

  it('detector query is never summarize', () => {
    for (const nrql of [
      "SELECT count(*) FROM Transaction WHERE appName = 'a'",
      'SELECT latest(isReady) FROM K8sDeploymentSample',
      '',
    ]) {
      const c = code(nrqlToAnalyzerQuery(nrql));
      expect(c.startsWith('timeseries') || c.startsWith('fetch')).toBe(true);
      expect(c).not.toContain('summarize');
      expect(c.includes('makeTimeseries') || c.startsWith('timeseries')).toBe(true);
    }
  });

  it('fallback is the inert timeseries', () => {
    expect(FALLBACK_QUERY).toBe(
      'timeseries unconverted = count(dt.host.cpu.usage), filter:{host.name == "__nr_migration_unconverted__"}',
    );
    const warnings: string[] = [];
    const out = nrqlToAnalyzerQuery('SELECT latest(isReady) FROM K8sDeploymentSample', warnings);
    expect(out).toBe(`// UNCONVERTED NRQL: SELECT latest(isReady) FROM K8sDeploymentSample\n${FALLBACK_QUERY}`);
    expect(warnings.some((w) => w.includes('not a timeseries'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D2 / D6
// ---------------------------------------------------------------------------

const NON_NRQL_METRICS: Array<[NRNonNrqlConditionType, string]> = [
  ['APM', 'apm.service.responseTime'],
  ['APM', 'apm.service.apdex'],
  ['APM', 'apm.service.errorRate'],
  ['APM', 'apm.service.throughput'],
  ['APM_APP', 'apm.application.responseTime'],
  ['APM_APP', 'apm.application.errorRate'],
  ['INFRA_METRIC', 'system.cpu.usagePct'],
  ['INFRA_METRIC', 'system.memoryUsedPct'],
  ['INFRA_METRIC', 'system.diskUsedPct'],
  ['INFRA_METRIC', 'system.network.receiveBytesPerSec'],
  ['INFRA_METRIC', 'system.network.transmitBytesPerSec'],
  ['INFRA_PROCESS', 'process.cpuPercent'],
  ['INFRA_PROCESS', 'process.memoryResidentSizeBytes'],
  ['SYNTHETIC', 'synthetic.success'],
  ['SYNTHETIC', 'synthetic.duration'],
  ['BROWSER', 'browser.pageLoad'],
  ['BROWSER', 'browser.jsErrors'],
  ['BROWSER', 'browser.lcp'],
  ['BROWSER', 'browser.cls'],
  ['MOBILE', 'mobile.crashRate'],
  ['MOBILE', 'mobile.sessionCount'],
  ['MOBILE', 'mobile.httpRequestDuration'],
  ['EXTERNAL_SERVICE', 'external.responseTime'],
  ['EXTERNAL_SERVICE', 'external.errorRate'],
  ['APM', 'apm.unmapped'],
];

describe('Non-NRQL detector queries (D2/D6)', () => {
  it('GRAIL_METRIC_KEYS matches the Python map exactly', () => {
    expect(GRAIL_METRIC_KEYS).toEqual({
      'builtin:host.cpu.usage': 'dt.host.cpu.usage',
      'builtin:host.mem.usage': 'dt.host.memory.usage',
      'builtin:host.disk.usedPct': 'dt.host.disk.used.percent',
      'builtin:host.cpu.load': 'dt.host.cpu.load',
      'builtin:host.net.bytesRx': 'dt.host.net.nic.bytes_rx',
      'builtin:host.net.bytesTx': 'dt.host.net.nic.bytes_tx',
      'builtin:host.availability': 'dt.host.availability',
      'builtin:tech.generic.process.count': 'dt.process.count',
      'builtin:synthetic.http.availability.location.total': 'dt.synthetic.http.availability',
      'builtin:service.response.time': 'dt.service.request.response_time',
      'builtin:apps.web.actionCount.osAndGeo': 'dt.frontend.request.count',
    });
  });

  it('no classic builtin: keys in any detector query', () => {
    const detectors: DTAnomalyDetector[] = [];
    for (const [conditionType, metric] of NON_NRQL_METRICS) {
      detectors.push(
        ...new NonNrqlAlertConditionTransformer().transform({ conditionType, name: metric, metric })
          .data!.anomalyDetectors,
      );
    }
    detectors.push(
      ...new AlertTransformer().transform({
        name: 'p',
        conditions: [
          { name: 'c', nrql: { query: 'SELECT average(cpuPercent) FROM SystemSample TIMESERIES' } },
          { name: 'apm', conditionType: 'APM' },
        ],
      }).data!.anomalyDetectors,
    );
    expect(detectors.length).toBeGreaterThan(NON_NRQL_METRICS.length);
    for (const det of detectors) {
      const c = code(inputs(det)['query']!);
      expect(c).not.toContain('builtin:');
      expect(c.startsWith('timeseries ') || c.startsWith('fetch ')).toBe(true);
    }
  });

  it('metricTimeseriesQuery maps keys, honours agg, and warns on unmapped keys', () => {
    expect(metricTimeseriesQuery('builtin:host.cpu.usage')).toBe('timeseries avg(dt.host.cpu.usage)');
    expect(metricTimeseriesQuery('builtin:host.cpu.usage', undefined, 'max')).toBe(
      'timeseries max(dt.host.cpu.usage)',
    );
    expect(metricTimeseriesQuery('dt.custom.metric', undefined, 'median')).toBe(
      'timeseries avg(dt.custom.metric)',
    );
    const warnings: string[] = [];
    expect(metricTimeseriesQuery('builtin:apps.mobile.crash.rate', warnings)).toBe(
      `// UNMAPPED METRIC: builtin:apps.mobile.crash.rate\n${FALLBACK_QUERY}`,
    );
    expect(warnings).toEqual([
      "Metric 'builtin:apps.mobile.crash.rate' has no verified Grail metric key; detector emitted with an inert placeholder query for operator review.",
    ]);
  });

  it('operator and AT_LEAST_ONCE are honoured', () => {
    const det = new NonNrqlAlertConditionTransformer().transform({
      conditionType: 'SYNTHETIC',
      name: 'ping',
      metric: 'synthetic.success',
      terms: [
        {
          priority: 'critical',
          threshold: 95,
          operator: 'BELOW',
          thresholdDuration: 600,
          thresholdOccurrences: 'AT_LEAST_ONCE',
        },
      ],
    }).data!.anomalyDetectors[0]!;
    const i = inputs(det);
    expect(i['alertCondition']).toBe('BELOW');
    expect([i['violatingSamples'], i['slidingWindow']]).toEqual(['1', '10']);
    expect(i['query']).toBe('timeseries avg(dt.synthetic.http.availability)');
  });

  it('alertConditionFor / sampleSettings', () => {
    const w: string[] = [];
    expect(alertConditionFor(undefined, 'BELOW', w)).toBe('BELOW');
    expect(alertConditionFor('above_or_equals', 'BELOW', w)).toBe('ABOVE');
    expect(w[0]).toBe(
      'NR operator ABOVE_OR_EQUALS mapped to ABOVE (the analyzer has no inclusive comparison); adjust the threshold if needed.',
    );
    expect(alertConditionFor('EQUALS', 'ABOVE', w)).toBe('ABOVE');
    expect(w[1]).toBe(
      "NR operator 'EQUALS' is not supported by the static threshold analyzer; using ABOVE.",
    );
    expect(sampleSettings(300, 'ALL')).toEqual([5, 5]);
    expect(sampleSettings(300, 'AT_LEAST_ONCE')).toEqual([1, 5]);
    expect(sampleSettings(30, undefined)).toEqual([1, 1]);
  });

  it('unsupported infra operator warns (no EQUALS)', () => {
    const r = new InfrastructureTransformer().transform({
      type: 'infra_metric',
      name: 'm',
      select_value: 'cpuPercent',
      comparison: 'equal',
      criticalThreshold: { value: 90, durationMinutes: 5 },
    });
    expect(r.data![0]!.alertCondition).toBe('ABOVE');
    expect(r.warnings.some((w) => w.includes('not supported'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D5
// ---------------------------------------------------------------------------

describe('Severity fanout workflows kept (D5)', () => {
  it('all fanout workflows returned', () => {
    const r = new AlertTransformer().transform({
      name: 'tiered',
      conditions: [],
      severityRules: [
        { severity: 'ERROR', delayMinutes: 0 },
        { severity: 'AVAILABILITY', delayMinutes: 10 },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data!.workflows).toHaveLength(2);
    expect(r.data!.workflow).toBe(r.data!.workflows[0]);
  });

  it('single workflow still listed', () => {
    const r = new AlertTransformer().transform({ name: 'flat', conditions: [] });
    expect(r.data!.workflows).toHaveLength(1);
    expect(r.data!.workflow).toBe(r.data!.workflows[0]);
  });
});

// ---------------------------------------------------------------------------
// D3 / D4 / D7
// ---------------------------------------------------------------------------

function allOutputs(): { detectors: DTAnomalyDetector[]; workflows: DTDavisProblemWorkflow<{ name?: string }>[] } {
  const detectors: DTAnomalyDetector[] = [];
  const workflows: DTDavisProblemWorkflow<{ name?: string }>[] = [];
  const alert = new AlertTransformer().transform({
    name: 'Checkout',
    conditions: [
      {
        name: 'High errors',
        nrql: { query: 'SELECT count(*) FROM TransactionError' },
        terms: [{ threshold: 5, priority: 'critical' }],
      },
    ],
  }).data!;
  detectors.push(...alert.anomalyDetectors);
  workflows.push(...alert.workflows);
  const nonNrql = new NonNrqlAlertConditionTransformer().transform({
    conditionType: 'SYNTHETIC',
    name: 'ping',
    metric: 'synthetic.success',
  }).data!;
  detectors.push(...nonNrql.anomalyDetectors);
  workflows.push(...nonNrql.workflows);
  detectors.push(
    ...new BaselineAlertTransformer().transform({
      name: 'b',
      kind: 'BASELINE',
      nrql: { query: 'SELECT count(*) FROM Transaction' },
    }).data!.anomalyDetectors,
  );
  workflows.push(
    new KeyTransactionTransformer().transform({ name: 'kt', applicationName: 'svc' }).data!.workflow,
  );
  const aiops = new AIOpsTransformer();
  workflows.push(aiops.transform({ name: 'w' }).data!.workflow);
  workflows.push(aiops.transformV2({ name: 'w2' }).data!.workflow);
  return { detectors, workflows };
}

describe('Workflow trigger and envelope shape (D3/D4/D7)', () => {
  it('detector envelopes have only Settings fields and migrated event names', () => {
    const { detectors } = allOutputs();
    expect(detectors.length).toBeGreaterThanOrEqual(3);
    for (const det of detectors) {
      expect(Object.keys(det).sort()).toEqual(['schemaId', 'scope', 'value']);
      const name = props(det)['event.name']!;
      expect(name.startsWith('[Migrated] ')).toBe(true);
      expect(name).toContain(' | ');
      for (const f of ['displayName', 'dql', 'direction', 'detectorKind']) {
        expect(det.value).not.toHaveProperty(f);
      }
    }
  });

  it('workflows use the davis-problem eventTrigger and dict tasks', () => {
    const { workflows } = allOutputs();
    expect(workflows.length).toBeGreaterThanOrEqual(5);
    for (const wf of workflows) {
      for (const f of ['private', 'migratedFrom', 'detectorIds']) expect(wf).not.toHaveProperty(f);
      expect(JSON.stringify(wf.trigger)).not.toMatch(/davis_event|davisProblem|detectorIds/);
      const config = wf.trigger.eventTrigger.triggerConfiguration;
      expect(config.type).toBe('davis-problem');
      for (const k of ['categories', 'customFilter', 'entityTags', 'entityTagsMatch']) {
        expect(config.value).toHaveProperty(k);
      }
      expect(Array.isArray(wf.tasks)).toBe(false);
      expect(typeof wf.tasks).toBe('object');
    }
  });

  it('alert workflow filter matches its detector event names', () => {
    const r = new AlertTransformer().transform({
      name: 'Prod "EU" alerts',
      conditions: [{ name: 'c1', nrql: { query: 'SELECT count(*) FROM Transaction' } }],
    }).data!;
    const custom = r.workflow.trigger.eventTrigger.triggerConfiguration.value.customFilter;
    const m = /^matchesValue\(event\.name, "(.*)"\)$/.exec(custom);
    expect(m).not.toBeNull();
    const pattern = m![1]!;
    expect(pattern.endsWith('*')).toBe(true);
    const prefix = pattern.slice(0, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    expect(props(r.anomalyDetectors[0]!)['event.name']!.startsWith(prefix)).toBe(true);
  });

  it('migratedEventName / migratedEventFilter escape and strip wildcards', () => {
    expect(migratedEventName('a*b', 'c')).toBe('[Migrated] a-b | c');
    expect(migratedEventFilter('say "hi" \\ bye')).toBe(
      'matchesValue(event.name, "[Migrated] say \\"hi\\" \\\\ bye | *")',
    );
  });

  it('davisProblemTrigger maps severity to a single category and warns otherwise', () => {
    const t = davisProblemTrigger('f', { severity: 'resource_contention' });
    expect(t.eventTrigger.triggerConfiguration.value.categories).toEqual({
      availability: false,
      error: false,
      slowdown: false,
      resource: true,
      custom: false,
      monitoringUnavailable: false,
    });
    const warnings: string[] = [];
    const all = davisProblemTrigger('', { severity: 'INFO', warnings, active: false });
    expect(Object.values(all.eventTrigger.triggerConfiguration.value.categories).every(Boolean)).toBe(true);
    expect(all.eventTrigger.isActive).toBe(false);
    expect(warnings).toEqual([
      "NR severity 'INFO' has no Davis problem category; workflow triggers on all categories.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// D17–D21
// ---------------------------------------------------------------------------

describe('Detector inputs accepted by the Settings validator (D17–D21)', () => {
  it('dealertingSamples never exceeds slidingWindow', () => {
    const dets = [
      ...new AlertTransformer().transform({
        name: 'p',
        conditions: [
          {
            name: 'c',
            nrql: { query: 'SELECT count(*) FROM Transaction' },
            terms: [{ threshold: 1, thresholdDuration: 120 }],
          },
        ],
      }).data!.anomalyDetectors,
      ...new NonNrqlAlertConditionTransformer().transform({
        conditionType: 'INFRA_METRIC',
        name: 's',
        metric: 'system.cpu.usagePct',
        terms: [{ priority: 'critical', threshold: 1, thresholdDuration: 60 }],
      }).data!.anomalyDetectors,
    ];
    for (const det of dets) {
      const i = inputs(det);
      expect(Number(i['dealertingSamples'])).toBeLessThanOrEqual(Number(i['slidingWindow']));
    }
    expect([dealertingSamples(0), dealertingSamples(2), dealertingSamples(9)]).toEqual(['1', '2', '5']);
  });

  it('no non-existent analyzer parameters', () => {
    const dets = new BaselineAlertTransformer().transform({
      name: 'o',
      kind: 'OUTLIER',
      facet: 'dt.service.name',
      trainingWindowSeconds: 14 * 86400,
      nrql: { query: 'SELECT average(duration) FROM Transaction' },
    }).data!.anomalyDetectors;
    for (const det of dets) {
      const keys = Object.keys(inputs(det));
      for (const bad of ['minLocationsFailing', 'learningPeriodDays', 'dimensions']) {
        expect(keys).not.toContain(bad);
      }
      expect(inputs(det)['query']).toMatch(/by: \{dt\.service\.name\}$/);
    }
  });

  it('addSplitDimension appends by: once and skips the inert fallback', () => {
    expect(addSplitDimension('timeseries avg(dt.host.cpu.usage)', 'host.name')).toBe(
      'timeseries avg(dt.host.cpu.usage), by: {host.name}',
    );
    expect(addSplitDimension('fetch spans\n| makeTimeseries count()', 'dt.service.name')).toBe(
      'fetch spans\n| makeTimeseries count(), by: {dt.service.name}',
    );
    const split = 'timeseries avg(x), by: {a}';
    expect(addSplitDimension(split, 'b')).toBe(split);
    expect(addSplitDimension(FALLBACK_QUERY, 'b')).toBe(FALLBACK_QUERY);
    expect(addSplitDimension(split, '')).toBe(split);
  });
});


describe('D23/D24 — live-rejected enums and action ids', () => {
  it('maps NRQL alert operators to ABOVE / BELOW only', async () => {
    const { resolveThreshold } = await import('../../src/transformers/alert.transformer.js');
    const cases: Array<[string, string]> = [
      ['ABOVE_OR_EQUALS', 'ABOVE'],
      ['BELOW_OR_EQUALS', 'BELOW'],
      ['EQUALS', 'ABOVE'],
    ];
    for (const [op, expected] of cases) {
      const warnings: string[] = [];
      const r = resolveThreshold([{ threshold: 1, operator: op, priority: 'critical' } as never], warnings);
      expect(r.alertCondition).toBe(expected);
      expect(warnings.length).toBeGreaterThan(0);
    }
  });
});
