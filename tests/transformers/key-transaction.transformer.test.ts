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

  it('should emit critical-service tag keyed by slug', () => {
    const result = transformer.transform({
      name: 'Checkout Submit',
      applicationName: 'checkout',
    });
    expect(result.success).toBe(true);
    expect(result.data!.criticalServiceTag.tag.value).toBe('checkout-submit');
    expect(result.data!.criticalServiceTag.entitySelector).toContain('type(SERVICE)');
    expect(result.data!.criticalServiceTag.entitySelector).toContain('checkout');
  });

  it('should emit SLO bound to the application service', () => {
    const result = transformer.transform({
      name: 'Checkout Submit',
      applicationName: 'checkout',
    });
    const slo = result.data!.slo;
    expect(slo.schemaId).toBe('builtin:monitoring.slo');
    expect(slo.metricExpression).toBe('builtin:service.response.time');
    expect(slo.target).toBe(95);
    expect(slo.filter).toContain('entityName("checkout")');
  });

  it('should emit Workflow tagged with critical-service + nr-migrated', () => {
    const result = transformer.transform({ name: 'Checkout Submit' });
    const tags = result.data!.workflow.trigger.event.config.davisProblem.entityTags;
    expect(tags['critical-service']).toBe('checkout-submit');
    expect(tags['nr-migrated']).toBe('checkout-submit');
  });

  it('should disable the Workflow when enabled=false', () => {
    const result = transformer.transform({ name: 'Kt', enabled: false });
    expect(result.data!.workflow.trigger.event.active).toBe(false);
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
    expect(result.data!.slo.filter).toContain('standalone-tx');
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
