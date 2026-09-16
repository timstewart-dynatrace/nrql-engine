import { describe, it, expect, beforeEach } from 'vitest';
import { NonNrqlAlertConditionTransformer } from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';

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
    expect(det.detectorId).toBe('davis-apm-slow-service');
    expect(det.value.enabled).toBe(true);
    expect(det.value.title).toBe('[Migrated] Slow service');
    const inputs = inputMap(det);
    expect(inputs['query']).toBe(
      'timeseries avg(builtin:service.response.time), by:{dt.smartscape.service}',
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
      'timeseries avg(builtin:host.cpu.usage), by:{dt.smartscape.host}',
    );
  });

  it('should map process metrics to dt.smartscape.process', () => {
    const result = transformer.transform({
      conditionType: 'INFRA_PROCESS',
      metric: 'process.cpuPercent',
    });
    expect(inputMap(result.data!.anomalyDetectors[0]!)['query']).toContain(
      'by:{dt.smartscape.process}',
    );
  });

  it('should map browser LCP split by dt.smartscape.frontend', () => {
    const result = transformer.transform({
      conditionType: 'BROWSER',
      metric: 'browser.lcp',
    });
    expect(inputMap(result.data!.anomalyDetectors[0]!)['query']).toBe(
      'timeseries avg(builtin:apps.web.largestContentfulPaint), by:{dt.smartscape.frontend}',
    );
  });

  it('should omit the split and warn for synthetic (no Smartscape equivalent)', () => {
    const result = transformer.transform({
      conditionType: 'SYNTHETIC',
      metric: 'synthetic.success',
      terms: [{ priority: 'critical', operator: 'BELOW', threshold: 0.99 }],
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['query']).toBe('timeseries avg(builtin:synthetic.http.availability)');
    expect(inputs['alertCondition']).toBe('BELOW');
    expect(result.warnings.some((w) => w.includes("'synthetic_test'"))).toBe(true);
  });

  it('should omit the split and warn for mobile (no Smartscape equivalent)', () => {
    const result = transformer.transform({
      conditionType: 'MOBILE',
      metric: 'mobile.crashRate',
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['query']).toBe('timeseries avg(builtin:apps.mobile.crash.rate)');
    expect(result.warnings.some((w) => w.includes("'mobile_application'"))).toBe(true);
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
      '// UNMAPPED NR METRIC: apm.unknown.weirdness\ntimeseries count()',
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

  it('should emit a workflow whose davis_event trigger targets the detector id', () => {
    const result = transformer.transform({
      conditionType: 'INFRA_METRIC',
      name: 'cpu-hi',
      metric: 'system.cpu.usagePct',
    });
    const det = result.data!.anomalyDetectors[0]!;
    const wf = result.data!.workflows[0]!;
    expect(wf.title).toBe('[Migrated infra_metric] cpu-hi');
    expect(wf.trigger.event.config.davis_event.detectorIds).toEqual([det.detectorId]);
    expect(Object.keys(wf.tasks)).toEqual(['placeholder_action']);
  });

  it('should fail when conditionType is missing', () => {
    const result = transformer.transform({} as never);
    expect(result.success).toBe(false);
  });
});
