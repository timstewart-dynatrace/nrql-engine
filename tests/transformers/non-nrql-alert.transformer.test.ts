import { describe, it, expect, beforeEach } from 'vitest';
import { NonNrqlAlertConditionTransformer } from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';
import { FALLBACK_QUERY } from '../../src/transformers/detector-utils.js';

function inputMap(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.analyzer.input.map((i) => [i.key, i.value]));
}

function propMap(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.eventTemplate.properties.map((p) => [p.key, p.value]));
}

describe('NonNrqlAlertConditionTransformer (Gen3 Davis anomaly detectors)', () => {
  let transformer: NonNrqlAlertConditionTransformer;

  beforeEach(() => {
    transformer = new NonNrqlAlertConditionTransformer();
  });

  it('should map APM responseTime to a detector split by dt.smartscape.service', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      name: 'Slow service',
      metric: 'apm.service.responseTime',
      terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 500 }],
      policyName: 'Prod SLA',
    });
    expect(result.success).toBe(true);
    const det = result.data!.anomalyDetectors[0]!;
    expect(det.schemaId).toBe('builtin:davis.anomaly-detectors');
    expect(det).not.toHaveProperty('detectorId');
    expect(det.value.enabled).toBe(true);
    expect(det.value.title).toBe('[Migrated] Slow service');
    const inputs = inputMap(det);
    expect(inputs['query']).toBe(
      'timeseries avg(dt.service.request.response_time), by:{dt.smartscape.service}',
    );
    expect(inputs['threshold']).toBe('500.0');
    expect(propMap(det)).toMatchObject({
      'source.type': 'apm',
      'source.condition': 'Slow service',
      'source.policy': 'Prod SLA',
      'source.metric': 'apm.service.responseTime',
      'migrated.from': 'newrelic',
    });
  });

  it('should map infra cpu to host.cpu.usage split by dt.smartscape.host', () => {
    const result = transformer.transform({
      conditionType: 'INFRA_METRIC',
      name: 'CPU high',
      metric: 'system.cpu.usagePct',
      terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 90 }],
    });
    expect(inputMap(result.data!.anomalyDetectors[0]!)['query']).toBe(
      'timeseries avg(dt.host.cpu.usage), by:{dt.smartscape.host}',
    );
  });

  it('should emit the inert fallback (no split) for metrics without a verified Grail key', () => {
    for (const [conditionType, metric, key] of [
      ['INFRA_PROCESS', 'process.cpuPercent', 'builtin:tech.generic.cpu.usage'],
      ['BROWSER', 'browser.lcp', 'builtin:apps.web.largestContentfulPaint'],
    ] as const) {
      const result = transformer.transform({ conditionType, metric });
      expect(inputMap(result.data!.anomalyDetectors[0]!)['query']).toBe(
        `// UNMAPPED METRIC: ${key}\n${FALLBACK_QUERY}`,
      );
      expect(result.warnings.some((w) => w.includes('no verified Grail metric key'))).toBe(true);
    }
  });

  it('should omit the split and warn for synthetic (no Smartscape equivalent)', () => {
    const result = transformer.transform({
      conditionType: 'SYNTHETIC',
      metric: 'synthetic.success',
      terms: [{ priority: 'critical', operator: 'BELOW', threshold: 0.99 }],
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['query']).toBe('timeseries avg(dt.synthetic.http.availability)');
    expect(inputs['alertCondition']).toBe('BELOW');
    expect(result.warnings.some((w) => w.includes("'synthetic_test'"))).toBe(true);
  });

  it('should emit the inert fallback for mobile crash rate (no Grail key)', () => {
    const result = transformer.transform({
      conditionType: 'MOBILE',
      metric: 'mobile.crashRate',
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['query']).toBe(`// UNMAPPED METRIC: builtin:apps.mobile.crash.rate\n${FALLBACK_QUERY}`);
    expect(inputs['query']).not.toMatch(/^timeseries .*builtin:/m);
  });

  it('should emit disabled placeholder detector for unmapped metrics', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.unknown.weirdness',
    });
    expect(result.success).toBe(true);
    const det = result.data!.anomalyDetectors[0]!;
    expect(det.value.enabled).toBe(false);
    expect(inputMap(det)['query']).toBe(
      `// UNMAPPED NR METRIC: apm.unknown.weirdness\n${FALLBACK_QUERY}`,
    );
    expect(result.warnings.some((w) => w.includes('apm.unknown.weirdness'))).toBe(true);
  });

  it('should preserve NR entity GUIDs as an event property and warn', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      entityGuids: ['HOST-ABC', 'SERVICE-DEF'],
    });
    const det = result.data!.anomalyDetectors[0]!;
    expect(propMap(det)['source.entityGuids']).toBe('HOST-ABC,SERVICE-DEF');
    expect(result.warnings.some((w) => w.includes('GUIDs'))).toBe(true);
  });

  it('should map operator correctly', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      terms: [{ priority: 'critical', operator: 'BELOW', threshold: 100 }],
    });
    expect(inputMap(result.data!.anomalyDetectors[0]!)['alertCondition']).toBe('BELOW');
  });

  it('should handle AT_LEAST_ONCE occurrences', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      terms: [
        {
          priority: 'critical',
          operator: 'ABOVE',
          threshold: 500,
          thresholdDuration: 300,
          thresholdOccurrences: 'AT_LEAST_ONCE',
        },
      ],
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['violatingSamples']).toBe('1');
    expect(inputs['slidingWindow']).toBe('5');
  });

  it('should emit a workflow whose davis-problem trigger matches the detector event name', () => {
    const result = transformer.transform({
      conditionType: 'INFRA_METRIC',
      name: 'cpu-hi',
      metric: 'system.cpu.usagePct',
    });
    const det = result.data!.anomalyDetectors[0]!;
    const wf = result.data!.workflows[0]!;
    expect(wf.title).toBe('[Migrated infra_metric] cpu-hi');
    expect(propMap(det)['event.name']).toBe('[Migrated] cpu-hi | infra_metric');
    const config = wf.trigger.eventTrigger.triggerConfiguration;
    expect(config.type).toBe('davis-problem');
    expect(config.value.customFilter).toBe('matchesValue(event.name, "[Migrated] cpu-hi | *")');
    expect(wf).not.toHaveProperty('private');
    expect(Object.keys(wf.tasks)).toEqual(['placeholder_action']);
  });

  it('should fail when conditionType is missing', () => {
    const result = transformer.transform({} as never);
    expect(result.success).toBe(false);
  });
});
