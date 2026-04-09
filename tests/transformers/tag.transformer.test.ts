/**
 * Tests for TagTransformer.
 *
 * Ported from Python: tests/unit/test_tag_transformer.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TagTransformer } from '../../src/transformers/index.js';

let tagTransformer: TagTransformer;

beforeEach(() => {
  tagTransformer = new TagTransformer();
});

// ═════════════════════════════════════════════════════════════════════════════
// Result defaults
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransformResult', () => {
  it('should return result with empty data array for no tags', () => {
    const entity = {
      name: 'bare-service',
      type: 'APPLICATION',
      tags: [],
    };
    const result = tagTransformer.transform(entity);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Single Tag
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransform single tag', () => {
  it('should create auto tag rule', () => {
    const entity = {
      name: 'my-service',
      type: 'APPLICATION',
      tags: [
        { key: 'environment', values: ['production'] },
      ],
    };
    const result = tagTransformer.transform(entity);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const rule = result.data![0]!;
    expect(rule.name).toContain('[Migrated]');
    expect(rule.name).toContain('environment');
    expect(rule.rules[0]!.valueFormat).toBe('production');
    expect(rule.rules[0]!.type).toBe('SERVICE');
  });

  it('should map host entity type', () => {
    const entity = {
      name: 'web-host-01',
      type: 'HOST',
      tags: [
        { key: 'team', values: ['platform'] },
      ],
    };
    const result = tagTransformer.transform(entity);
    const rule = result.data![0]!;
    expect(rule.rules[0]!.type).toBe('HOST');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Multiple Tags
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransform multiple tags', () => {
  it('should create rule per tag value', () => {
    const entity = {
      name: 'api-gateway',
      type: 'APPLICATION',
      tags: [
        { key: 'env', values: ['staging', 'production'] },
        { key: 'team', values: ['backend'] },
      ],
    };
    const result = tagTransformer.transform(entity);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3); // 2 env values + 1 team value
  });

  it('should include entity name in conditions', () => {
    const entity = {
      name: 'checkout-service',
      type: 'APM_APPLICATION',
      tags: [
        { key: 'tier', values: ['frontend'] },
      ],
    };
    const result = tagTransformer.transform(entity);
    const rule = result.data![0]!;
    const condition = rule.rules[0]!.conditions[0]!;
    expect(condition.comparisonInfo.value).toBe('checkout-service');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Empty Tags
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransform empty tags', () => {
  it('should succeed with no rules', () => {
    const entity = {
      name: 'bare-service',
      type: 'APPLICATION',
      tags: [],
    };
    const result = tagTransformer.transform(entity);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should succeed with missing tags key', () => {
    const entity = {
      name: 'no-tags-entity',
      type: 'HOST',
    };
    const result = tagTransformer.transform(entity);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transform All
// ═════════════════════════════════════════════════════════════════════════════

describe('TagTransformAll', () => {
  it('should transform multiple entities', () => {
    const entities = [
      { name: 'svc-1', type: 'APPLICATION', tags: [{ key: 'env', values: ['prod'] }] },
      { name: 'host-1', type: 'HOST', tags: [{ key: 'region', values: ['us-east-1'] }] },
      { name: 'svc-2', type: 'APPLICATION', tags: [] },
    ];
    const results = tagTransformer.transformAll(entities);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0]!.data).toHaveLength(1);
    expect(results[1]!.data).toHaveLength(1);
    expect(results[2]!.data).toHaveLength(0);
  });
});
