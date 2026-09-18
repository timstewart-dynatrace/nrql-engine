import { describe, it, expect, beforeEach } from 'vitest';
import { BaselineAlertTransformer } from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';
import { FALLBACK_QUERY } from '../../src/transformers/detector-utils.js';

function inputMap(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.analyzer.input.map((i) => [i.key, i.value]));
}

function propMap(det: DTAnomalyDetector): Record<string, string> {
  return Object.fromEntries(det.value.eventTemplate.properties.map((p) => [p.key, p.value]));
}

describe('BaselineAlertTransformer (Gen3 §6 detector shape)', () => {
  let transformer: BaselineAlertTransformer;

  beforeEach(() => {
    transformer = new BaselineAlertTransformer();
  });

  it('should emit a canonical adaptive Davis anomaly detector for BASELINE kind', () => {
    const result = transformer.transform({
      kind: 'BASELINE',
      name: 'Slow baseline',
      nrql: { query: 'SELECT average(duration) FROM Transaction TIMESERIES' },
      direction: 'UPPER_ONLY',
      sensitivity: 'HIGH',
      trainingWindowSeconds: 14 * 86400,
      policyName: 'Prod SLA',
    });
    expect(result.success).toBe(true);
    const d = result.data!.detector;
    expect(result.data!.anomalyDetectors).toEqual([d]);
    expect(Object.keys(d).sort()).toEqual(['schemaId', 'scope', 'value']);
    expect(d.schemaId).toBe('builtin:davis.anomaly-detectors');
    expect(Object.keys(d.value).sort()).toEqual(
      ['analyzer', 'description', 'enabled', 'eventTemplate', 'executionSettings', 'source', 'title'],
    );
    expect(d.value.executionSettings).toEqual({});
    expect(d.value.analyzer.name).toBe(
      'dt.statistics.ui.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer',
    );
    for (const item of d.value.analyzer.input) {
      expect(typeof item.value).toBe('string');
      expect(item.value.length).toBeGreaterThan(0);
    }
    const inputs = inputMap(d);
    expect(inputs['alertCondition']).toBe('ABOVE');
    expect(inputs['numberOfSignalFluctuations']).toBe('2.0');
    expect(inputs['query']).toContain('makeTimeseries avg(duration)');
    expect(propMap(d)['event.name']).toBe('[Migrated] Slow baseline | baseline');
    expect(result.warnings.some((w) => w.includes('training window'))).toBe(true);
  });

  it('should map direction LOWER_ONLY → BELOW and UPPER_AND_LOWER → OUTSIDE_BOUNDS', () => {
    const below = transformer.transform({ kind: 'BASELINE', nrql: { query: 'q' }, direction: 'LOWER_ONLY' });
    expect(inputMap(below.data!.detector)['alertCondition']).toBe('BELOW');
    const both = transformer.transform({ kind: 'BASELINE', nrql: { query: 'q' }, direction: 'UPPER_AND_LOWER' });
    expect(inputMap(both.data!.detector)['alertCondition']).toBe('OUTSIDE_BOUNDS');
  });

  it('should put the OUTLIER facet into the query by: split (no dimensions input — D21)', () => {
    const result = transformer.transform({
      kind: 'OUTLIER',
      name: 'svc-outliers',
      nrql: { query: 'SELECT average(duration) FROM Transaction' },
    });
    const inputs = inputMap(result.data!.detector);
    expect(inputs).not.toHaveProperty('dimensions');
    expect(inputs).not.toHaveProperty('learningPeriodDays');
    expect(inputs['query']!.split('\n').at(-1)).toMatch(/by: \{dt\.smartscape\.service\}$/);
    expect(result.warnings.some((w) => w.includes('no facet'))).toBe(true);
  });

  it('should never emit raw NRQL in the analyzer query', () => {
    const result = transformer.transform({
      kind: 'BASELINE',
      nrql: { query: 'SELECT FROM WHERE ((( nonsense' },
    });
    const q = inputMap(result.data!.detector)['query']!;
    expect(q.startsWith('// UNCONVERTED NRQL: ')).toBe(true);
    expect(q.endsWith(FALLBACK_QUERY)).toBe(true);
    expect(propMap(result.data!.detector)['original.nrql']).toBe('SELECT FROM WHERE ((( nonsense');
  });

  it('should warn and disable when NRQL is missing', () => {
    const result = transformer.transform({ kind: 'BASELINE' });
    expect(result.warnings.some((w) => w.includes('no NRQL source'))).toBe(true);
    expect(result.data!.detector.value.enabled).toBe(false);
    expect(inputMap(result.data!.detector)['query']).toBe(FALLBACK_QUERY);
  });

  it('should default sensitivity to MEDIUM (3.0 signal fluctuations)', () => {
    const result = transformer.transform({ kind: 'BASELINE', nrql: { query: 'q' } });
    expect(inputMap(result.data!.detector)['numberOfSignalFluctuations']).toBe('3.0');
  });
});
