import { describe, it, expect, beforeEach } from 'vitest';
import { ChangeTrackingTransformer } from '../../src/transformers/index.js';

describe('ChangeTrackingTransformer', () => {
  let transformer: ChangeTrackingTransformer;

  beforeEach(() => {
    transformer = new ChangeTrackingTransformer();
  });

  it('should fail when neither entityName nor entityGuid is provided', () => {
    const result = transformer.transform({ category: 'DEPLOYMENT' });
    expect(result.success).toBe(false);
  });

  it('should emit CUSTOM_DEPLOYMENT for DEPLOYMENT category', () => {
    const result = transformer.transform({
      category: 'DEPLOYMENT',
      entityName: 'checkout-service',
      version: 'v2.3.1',
      user: 'alice',
    });
    expect(result.success).toBe(true);
    expect(result.data!.eventPayload.eventType).toBe('CUSTOM_DEPLOYMENT');
    expect(result.data!.eventPayload.entitySelector).toBe('entityName("checkout-service")');
    expect(result.data!.eventPayload.properties['version']).toBe('v2.3.1');
    expect(result.data!.eventPayload.properties['user']).toBe('alice');
  });

  it('should emit CUSTOM_CONFIGURATION for FEATURE_FLAG category', () => {
    const result = transformer.transform({
      category: 'FEATURE_FLAG',
      entityGuid: 'ABC-123',
    });
    expect(result.data!.eventPayload.eventType).toBe('CUSTOM_CONFIGURATION');
    expect(result.data!.eventPayload.entitySelector).toBe('entityId("ABC-123")');
  });

  it('should default OTHER to CUSTOM_INFO', () => {
    const result = transformer.transform({ entityName: 'svc' });
    expect(result.data!.eventPayload.eventType).toBe('CUSTOM_INFO');
  });

  it('should include customAttributes in properties', () => {
    const result = transformer.transform({
      category: 'DEPLOYMENT',
      entityName: 'svc',
      customAttributes: { commit: 'abc123', pipeline: 'prod-pipeline' },
    });
    expect(result.data!.eventPayload.properties['commit']).toBe('abc123');
    expect(result.data!.eventPayload.properties['pipeline']).toBe('prod-pipeline');
  });

  it('should warn on non-ISO timestamp and omit startTime', () => {
    const result = transformer.transform({
      category: 'DEPLOYMENT',
      entityName: 'svc',
      timestamp: 'not-a-date',
    });
    expect(result.warnings.some((w) => w.includes('not ISO-8601'))).toBe(true);
    expect(result.data!.eventPayload.startTime).toBeUndefined();
  });

  it('should include valid ISO timestamp as startTime', () => {
    const result = transformer.transform({
      category: 'DEPLOYMENT',
      entityName: 'svc',
      timestamp: '2026-04-14T12:00:00Z',
    });
    expect(result.data!.eventPayload.startTime).toBe('2026-04-14T12:00:00Z');
  });

  it('should emit Workflow trigger stub matcher', () => {
    const result = transformer.transform({
      category: 'DEPLOYMENT',
      entityName: 'svc',
    });
    expect(result.data!.workflowTriggerStub.matcher).toContain('CUSTOM_DEPLOYMENT');
    expect(result.data!.workflowTriggerStub.matcher).toContain('nr-migrated');
  });

  it('should emit manual steps about ingest token', () => {
    const result = transformer.transform({ entityName: 'svc' });
    expect(result.warnings.some((w) => w.includes('events.ingest'))).toBe(true);
  });
});
