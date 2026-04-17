/**
 * Tests for TagTransformer (Gen3 default) and LegacyTagTransformer (Gen2 opt-in).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TagTransformer, LegacyTagTransformer } from '../../src/transformers/index.js';

// ═════════════════════════════════════════════════════════════════════════════
// Gen3 default — OpenPipeline enrichment
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransformer (Gen3 OpenPipeline enrichment)', () => {
  let transformer: TagTransformer;

  beforeEach(() => {
    transformer = new TagTransformer();
  });

  it('should return empty data for no tags', () => {
    const result = transformer.transform({ name: 'bare', type: 'APPLICATION', tags: [] });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('should emit OpenPipeline enrichment rule for a tag', () => {
    const result = transformer.transform({
      name: 'my-service',
      type: 'APPLICATION',
      tags: [{ key: 'environment', values: ['production'] }],
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const rule = result.data![0]!;
    expect(rule.schemaId).toBe('builtin:openpipeline.logs.pipelines');
    expect(rule.displayName).toContain('[Migrated]');
    expect(rule.displayName).toContain('environment=production');
    expect(rule.pipelines).toEqual(['spans', 'logs']);
    expect(rule.matcher).toBe('matchesValue(service.name, "my-service")');
    expect(rule.fieldsAdd).toEqual([{ field: 'environment', value: 'production' }]);
  });

  it('should route HOST entities to logs + metrics pipelines with host.name matcher', () => {
    const result = transformer.transform({
      name: 'web-host-01',
      type: 'HOST',
      tags: [{ key: 'team', values: ['platform'] }],
    });
    const rule = result.data![0]!;
    expect(rule.pipelines).toEqual(['logs', 'metrics']);
    expect(rule.matcher).toBe('matchesValue(host.name, "web-host-01")');
  });

  it('should emit one rule per tag value', () => {
    const result = transformer.transform({
      name: 'api-gateway',
      type: 'APPLICATION',
      tags: [
        { key: 'env', values: ['staging', 'production'] },
        { key: 'team', values: ['backend'] },
      ],
    });
    expect(result.data).toHaveLength(3);
  });

  it('should warn and skip empty tag keys', () => {
    const result = transformer.transform({
      name: 'svc',
      type: 'APPLICATION',
      tags: [{ key: '', values: ['x'] }],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings[0]).toContain('Empty tag key');
  });

  it('should succeed with missing tags key', () => {
    const result = transformer.transform({ name: 'no-tags', type: 'HOST' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should transform multiple entities via transformAll', () => {
    const results = transformer.transformAll([
      { name: 'svc-1', type: 'APPLICATION', tags: [{ key: 'env', values: ['prod'] }] },
      { name: 'host-1', type: 'HOST', tags: [{ key: 'region', values: ['us-east-1'] }] },
      { name: 'svc-2', type: 'APPLICATION', tags: [] },
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0]!.data).toHaveLength(1);
    expect(results[1]!.data).toHaveLength(1);
    expect(results[2]!.data).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Gen2 opt-in — classic Auto-Tag Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('LegacyTagTransformer (Gen2 Auto-Tag Rule)', () => {
  let transformer: LegacyTagTransformer;

  beforeEach(() => {
    transformer = new LegacyTagTransformer();
  });

  it('should emit a legacy warning on every call', () => {
    const result = transformer.transform({ name: 'svc', type: 'APPLICATION', tags: [] });
    expect(result.warnings[0]).toContain('Gen2');
    expect(result.warnings[0]).toContain('legacy');
  });

  it('should create auto-tag rule with ENTITY_NAME CONTAINS', () => {
    const result = transformer.transform({
      name: 'my-service',
      type: 'APPLICATION',
      tags: [{ key: 'environment', values: ['production'] }],
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const rule = result.data![0]!;
    expect(rule.name).toContain('[Migrated]');
    expect(rule.name).toContain('environment');
    expect(rule.rules[0]!.valueFormat).toBe('production');
    expect(rule.rules[0]!.type).toBe('SERVICE');
  });

  it('should map host entity type', () => {
    const result = transformer.transform({
      name: 'web-host-01',
      type: 'HOST',
      tags: [{ key: 'team', values: ['platform'] }],
    });
    expect(result.data![0]!.rules[0]!.type).toBe('HOST');
  });

  it('should include entity name in conditions', () => {
    const result = transformer.transform({
      name: 'checkout-service',
      type: 'APM_APPLICATION',
      tags: [{ key: 'tier', values: ['frontend'] }],
    });
    const condition = result.data![0]!.rules[0]!.conditions[0]!;
    expect(condition.comparisonInfo.value).toBe('checkout-service');
  });

  it('should emit one rule per tag value', () => {
    const result = transformer.transform({
      name: 'api-gateway',
      type: 'APPLICATION',
      tags: [
        { key: 'env', values: ['staging', 'production'] },
        { key: 'team', values: ['backend'] },
      ],
    });
    expect(result.data).toHaveLength(3);
  });
});
