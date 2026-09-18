import { describe, it, expect, beforeEach } from 'vitest';
import { KeyTransactionTransformer } from '../../src/transformers/index.js';

describe('KeyTransactionTransformer', () => {
  let transformer: KeyTransactionTransformer;

  beforeEach(() => {
    transformer = new KeyTransactionTransformer();
  });

  it('should fail without a name', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(false);
  });

  it('should not emit an ownership.teams object (invalid for tagging)', () => {
    const result = transformer.transform({
      name: 'Checkout Submit',
      applicationName: 'checkout',
    });
    expect(result.success).toBe(true);
    expect('criticalServiceTag' in result.data!).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain('builtin:ownership.teams');
    expect(result.warnings.some((w) => w.includes('dt.owner'))).toBe(true);
  });

  it('should emit SLO bound to the application service', () => {
    const result = transformer.transform({
      name: 'Checkout Submit',
      applicationName: 'checkout',
    });
    const slo = result.data!.slo;
    expect('schemaId' in slo).toBe(false);
    expect(slo.criteria[0]!.target).toBe(95);
    expect(slo.customSli.indicator).toContain('contains(entityName, "checkout")');
    expect(slo.customSli.indicator).toContain('total[] <= 500000'); // default 500ms
    expect(slo.tags).toContain('key_transaction:checkout-submit');
  });

  it('should emit Workflow tagged with nr-migrated', () => {
    const result = transformer.transform({ name: 'Checkout Submit' });
    const config = result.data!.workflow.trigger.eventTrigger.triggerConfiguration;
    expect(config.type).toBe('davis-problem');
    expect(config.value.customFilter).toBe('');
    expect(Object.keys(result.data!.workflow.tasks)).toEqual(['placeholder_action']);
    const tags = config.value.entityTags;
    expect(tags['nr-migrated']).toBe('checkout-submit');
    expect(tags['critical-service']).toBeUndefined();
  });

  it('should disable the Workflow when enabled=false', () => {
    const result = transformer.transform({ name: 'Kt', enabled: false });
    expect(result.data!.workflow.trigger.eventTrigger.isActive).toBe(false);
  });

  it('should carry a response-time threshold warning into warnings', () => {
    const result = transformer.transform({
      name: 'Kt',
      responseTimeThresholdMs: 500,
    });
    expect(result.warnings.some((w) => w.includes('500ms'))).toBe(true);
  });

  it('should default applicationName to name when missing', () => {
    const result = transformer.transform({ name: 'standalone-tx' });
    expect(result.data!.slo.customSli.indicator).toContain('contains(entityName, "standalone-tx")');
  });

  it('should use responseTimeThresholdMs, then apdexTarget, for the latency threshold', () => {
    const sla = transformer.transform({ name: 'A', responseTimeThresholdMs: 300, apdexTarget: 2 });
    expect(sla.data!.slo.customSli.indicator).toContain('total[] <= 300000');
    const apdex = transformer.transform({ name: 'B', apdexTarget: 0.25 });
    expect(apdex.data!.slo.customSli.indicator).toContain('total[] <= 250000');
  });

  it('should batch via transformAll', () => {
    const results = transformer.transformAll([
      { name: 'A' },
      { name: 'B' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
