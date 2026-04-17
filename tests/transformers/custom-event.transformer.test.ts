import { describe, it, expect, beforeEach } from 'vitest';
import { CustomEventTransformer } from '../../src/transformers/index.js';

describe('CustomEventTransformer', () => {
  let transformer: CustomEventTransformer;

  beforeEach(() => {
    transformer = new CustomEventTransformer();
  });

  it('should fail when eventType is missing', () => {
    const result = transformer.transform({ eventType: '' });
    expect(result.success).toBe(false);
  });

  it('should emit bizevent ingest rule with correct schema and path', () => {
    const result = transformer.transform({
      eventType: 'CheckoutCompleted',
      attributes: [
        { name: 'orderId', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.ingestRule.schemaId).toBe('builtin:bizevents.http.incoming.rules');
    expect(result.data!.ingestRule.eventType).toBe('CheckoutCompleted');
    expect(result.data!.ingestRule.source.path).toBe('/platform/ingest/v1/events.bizevents');
  });

  it('should emit OpenPipeline processing rule with event.type matcher', () => {
    const result = transformer.transform({ eventType: 'UserSignup' });
    expect(result.data!.processingRule.matcher).toBe(
      'matchesValue(event.type, "UserSignup")',
    );
    expect(result.data!.processingRule.fieldsAdd).toContainEqual({
      field: 'nr.original_event_type',
      value: 'UserSignup',
    });
  });

  it('should preserve explicit attribute list', () => {
    const result = transformer.transform({
      eventType: 'Order',
      attributes: [
        { name: 'id', type: 'string' },
        { name: 'total', type: 'number' },
        { name: 'paid', type: 'boolean' },
      ],
    });
    expect(result.data!.attributes).toHaveLength(3);
  });

  it('should infer attribute types from sample when schema is missing', () => {
    const result = transformer.transform({
      eventType: 'Order',
      sample: { id: 'abc', total: 12.5, paid: true },
    });
    const byName = Object.fromEntries(result.data!.attributes.map((a) => [a.name, a.type]));
    expect(byName.id).toBe('string');
    expect(byName.total).toBe('number');
    expect(byName.paid).toBe('boolean');
    expect(result.warnings.some((w) => w.includes('inferred from sample'))).toBe(true);
  });

  it('should emit a DQL rewrite example', () => {
    const result = transformer.transform({ eventType: 'CartAdd' });
    expect(result.data!.dqlRewrite).toContain('fetch bizevents');
    expect(result.data!.dqlRewrite).toContain('event.type == "CartAdd"');
  });

  it('should emit manual-step warnings about client code + token rotation', () => {
    const result = transformer.transform({ eventType: 'E' });
    expect(result.warnings.some((w) => w.includes('recordCustomEvent'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('ingest API token'))).toBe(true);
  });
});
