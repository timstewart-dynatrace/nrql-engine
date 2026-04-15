import { describe, it, expect, beforeEach } from 'vitest';
import { MultiLocationSyntheticTransformer } from '../../src/transformers/index.js';

describe('MultiLocationSyntheticTransformer', () => {
  let transformer: MultiLocationSyntheticTransformer;

  beforeEach(() => {
    transformer = new MultiLocationSyntheticTransformer();
  });

  it('should fail without monitorName', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({
      monitorName: '' as any,
      totalLocations: 5,
      failingLocationThreshold: 3,
    });
    expect(result.success).toBe(false);
  });

  it('should fail when threshold exceeds total', () => {
    const result = transformer.transform({
      monitorName: 'check',
      totalLocations: 3,
      failingLocationThreshold: 5,
    });
    expect(result.success).toBe(false);
  });

  it('should emit a Metric Event with DQL countDistinctExact(location.id)', () => {
    const result = transformer.transform({
      monitorName: 'api-health',
      totalLocations: 5,
      failingLocationThreshold: 3,
    });
    expect(result.success).toBe(true);
    const ev = result.data!.metricEvent;
    expect(ev.schemaId).toBe('builtin:anomaly-detection.metric-events');
    expect(ev.queryDefinition.query).toContain('countDistinctExact(location.id)');
    expect(ev.queryDefinition.query).toContain('"api-health"');
    expect(ev.queryDefinition.query).toContain('success == false');
    // threshold is (N-1) so `ABOVE threshold` matches when ≥N
    expect(ev.monitoringStrategy.threshold).toBe(2);
    expect(ev.monitoringStrategy.alertCondition).toBe('ABOVE');
  });

  it('should carry the threshold into the event template description', () => {
    const result = transformer.transform({
      monitorName: 'check',
      totalLocations: 6,
      failingLocationThreshold: 4,
    });
    expect(result.data!.metricEvent.eventTemplate.description).toContain(
      '4 of 6',
    );
  });

  it('should default enabled=true; honor explicit false', () => {
    const a = transformer.transform({
      monitorName: 'a',
      totalLocations: 5,
      failingLocationThreshold: 2,
    });
    expect(a.data!.metricEvent.enabled).toBe(true);

    const b = transformer.transform({
      monitorName: 'b',
      totalLocations: 5,
      failingLocationThreshold: 2,
      enabled: false,
    });
    expect(b.data!.metricEvent.enabled).toBe(false);
  });
});
