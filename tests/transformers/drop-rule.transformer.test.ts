/**
 * Tests for DropRuleTransformer.
 *
 * Ported from Python: tests/unit/test_drop_rule_transformer.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DropRuleTransformer } from '../../src/transformers/index.js';

let dropRuleTransformer: DropRuleTransformer;

beforeEach(() => {
  dropRuleTransformer = new DropRuleTransformer();
});

// ═════════════════════════════════════════════════════════════════════════════
// Result defaults
// ═════════════════════════════════════════════════════════════════════════════

describe('DropRuleTransformResult', () => {
  it('should return empty warnings and data arrays by default', () => {
    const rule = {
      name: 'Test',
      nrqlCondition: 'level = \'DEBUG\'',
      action: 'drop_data',
    };
    const result = dropRuleTransformer.transform(rule);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Basic Drop Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('DropRuleTransform', () => {
  it('should create ingest rule', () => {
    const rule = {
      name: 'Drop Debug Logs',
      nrqlCondition: "level = 'DEBUG'",
      action: 'drop_data',
      enabled: true,
    };
    const result = dropRuleTransformer.transform(rule);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const ir = result.data![0]!;
    expect(ir.type).toBe('DROP');
    expect(ir.name).toContain('[Migrated]');
    expect(ir.enabled).toBe(true);
  });

  it('should convert nrql operators', () => {
    const rule = {
      name: 'Complex Filter',
      nrqlCondition: "status = 200 AND path = '/health'",
      action: 'drop_data',
    };
    const result = dropRuleTransformer.transform(rule);
    const ir = result.data![0]!;
    expect(ir.condition).toContain(' == ');
    expect(ir.condition).toContain(' and ');
  });

  it('should handle empty condition', () => {
    const rule = {
      name: 'Drop All',
      nrqlCondition: '',
      action: 'drop_data',
    };
    const result = dropRuleTransformer.transform(rule);
    const ir = result.data![0]!;
    expect(ir.condition).toContain('matchesValue');
  });

  it('should handle drop attributes action', () => {
    const rule = {
      name: 'Mask PII',
      nrqlCondition: "service = 'payments'",
      action: 'drop_attributes',
      attributes: ['creditCard', 'ssn'],
    };
    const result = dropRuleTransformer.transform(rule);
    const ir = result.data![0]!;
    expect(ir.type).toBe('MASK');
    expect(ir.attributes).toEqual(['creditCard', 'ssn']);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Disabled Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('DropRuleTransform disabled', () => {
  it('should preserve disabled state', () => {
    const rule = {
      name: 'Old Rule',
      nrqlCondition: "env = 'test'",
      action: 'drop_data',
      enabled: false,
    };
    const result = dropRuleTransformer.transform(rule);
    expect(result.success).toBe(true);
    const ir = result.data![0]!;
    expect(ir.enabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transform All
// ═════════════════════════════════════════════════════════════════════════════

describe('DropRuleTransformAll', () => {
  it('should transform multiple rules', () => {
    const rules = [
      { name: 'R1', nrqlCondition: "level = 'DEBUG'", action: 'drop_data' },
      { name: 'R2', nrqlCondition: 'status = 200', action: 'drop_data', enabled: false },
      { name: 'R3', nrqlCondition: '', action: 'drop_data' },
    ];
    const results = dropRuleTransformer.transformAll(rules);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
