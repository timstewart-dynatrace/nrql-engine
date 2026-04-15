import { describe, it, expect, beforeEach } from 'vitest';
import { NonNrqlAlertConditionTransformer } from '../../src/transformers/index.js';

describe('NonNrqlAlertConditionTransformer', () => {
  let transformer: NonNrqlAlertConditionTransformer;

  beforeEach(() => {
    transformer = new NonNrqlAlertConditionTransformer();
  });

  it('should map APM responseTime to builtin:service.response.time', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      name: 'Slow service',
      metric: 'apm.service.responseTime',
      terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 500 }],
      policyName: 'Prod SLA',
    });
    expect(result.success).toBe(true);
    const event = result.data!.metricEvent;
    expect(event.enabled).toBe(true);
    expect((event.queryDefinition as Record<string, unknown>).metricKey).toBe(
      'builtin:service.response.time',
    );
    expect(event.entityTags['nr-migrated']).toBe('prod-sla');
    expect((event.monitoringStrategy as Record<string, unknown>).threshold).toBe(500);
  });

  it('should map infra cpu to host.cpu.usage with entity dimension dt.entity.host', () => {
    const result = transformer.transform({
      conditionType: 'INFRA_METRIC',
      name: 'CPU high',
      metric: 'system.cpu.usagePct',
      terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 90 }],
    });
    const qd = result.data!.metricEvent.queryDefinition as Record<string, unknown>;
    expect(qd.metricKey).toBe('builtin:host.cpu.usage');
    expect((qd.entityFilter as Record<string, unknown>).dimensionKey).toBe('dt.entity.host');
  });

  it('should map synthetic success to availability metric', () => {
    const result = transformer.transform({
      conditionType: 'SYNTHETIC',
      metric: 'synthetic.success',
      terms: [{ priority: 'critical', operator: 'BELOW', threshold: 0.99 }],
    });
    expect((result.data!.metricEvent.queryDefinition as Record<string, unknown>).metricKey).toBe(
      'builtin:synthetic.http.availability',
    );
  });

  it('should map browser LCP to largestContentfulPaint', () => {
    const result = transformer.transform({
      conditionType: 'BROWSER',
      metric: 'browser.lcp',
    });
    expect((result.data!.metricEvent.queryDefinition as Record<string, unknown>).metricKey).toBe(
      'builtin:apps.web.largestContentfulPaint',
    );
  });

  it('should map mobile crash rate', () => {
    const result = transformer.transform({
      conditionType: 'MOBILE',
      metric: 'mobile.crashRate',
    });
    const qd = result.data!.metricEvent.queryDefinition as Record<string, unknown>;
    expect(qd.metricKey).toBe('builtin:apps.mobile.crash.rate');
    expect((qd.entityFilter as Record<string, unknown>).dimensionKey).toBe(
      'dt.entity.mobile_application',
    );
  });

  it('should emit disabled placeholder for unmapped metrics', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.unknown.weirdness',
    });
    expect(result.success).toBe(true);
    expect(result.data!.metricEvent.enabled).toBe(false);
    expect(result.warnings.some((w) => w.includes('apm.unknown.weirdness'))).toBe(true);
  });

  it('should carry entity GUIDs into entity filter conditions', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      entityGuids: ['HOST-ABC', 'SERVICE-DEF'],
    });
    const conditions = (
      (result.data!.metricEvent.queryDefinition as Record<string, unknown>).entityFilter as Record<
        string,
        unknown
      >
    ).conditions as Array<{ type: string; value: string }>;
    expect(conditions).toHaveLength(2);
    expect(conditions[0]!.type).toBe('ENTITY_ID');
  });

  it('should map operator correctly', () => {
    const result = transformer.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      terms: [{ priority: 'critical', operator: 'BELOW', threshold: 100 }],
    });
    expect((result.data!.metricEvent.monitoringStrategy as Record<string, unknown>).alertCondition).toBe(
      'BELOW',
    );
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
    expect(
      (result.data!.metricEvent.monitoringStrategy as Record<string, unknown>).violatingSamples,
    ).toBe(1);
  });
});
