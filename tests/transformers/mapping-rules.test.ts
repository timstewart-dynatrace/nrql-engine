/**
 * Tests for transformers/mapping-rules.ts — EntityMapper and value mappings.
 *
 * Ported from Python: tests/unit/test_mapping_rules.py (51 tests)
 */

import { describe, expect, it } from 'vitest';

import {
  ALERT_PRIORITY_MAP,
  CHART_TYPE_MAP,
  ENTITY_MAPPINGS,
  EntityMapper,
  FILL_OPTION_MAP,
  MONITOR_PERIOD_MAP,
  NOTIFICATION_TYPE_MAP,
  OPERATOR_MAP,
  SLO_TIME_UNIT_MAP,
  SYNTHETIC_MONITOR_TYPE_MAP,
  THRESHOLD_OCCURRENCES_MAP,
  VISUALIZATION_TYPE_MAP,
} from '../../src/transformers/mapping-rules.js';

// ─── Mapping dictionaries ───────────────────────────────────────────────────

describe('VISUALIZATION_TYPE_MAP', () => {
  it('should map line to DATA_EXPLORER', () => {
    expect(VISUALIZATION_TYPE_MAP['viz.line']).toBe('DATA_EXPLORER');
  });

  it('should map billboard to SINGLE_VALUE', () => {
    expect(VISUALIZATION_TYPE_MAP['viz.billboard']).toBe('SINGLE_VALUE');
  });

  it('should map markdown', () => {
    expect(VISUALIZATION_TYPE_MAP['viz.markdown']).toBe('MARKDOWN');
  });

  it('should map all chart types to known values', () => {
    const expectedTypes = new Set(['DATA_EXPLORER', 'SINGLE_VALUE', 'MARKDOWN']);
    const actualTypes = new Set(Object.values(VISUALIZATION_TYPE_MAP));
    for (const t of actualTypes) {
      expect(expectedTypes).toContain(t);
    }
  });
});

describe('CHART_TYPE_MAP', () => {
  it('should map LINE', () => {
    expect(CHART_TYPE_MAP['LINE']).toBe('LINE');
  });

  it('should map STACKED_BAR to COLUMN', () => {
    expect(CHART_TYPE_MAP['STACKED_BAR']).toBe('COLUMN');
  });
});

describe('ALERT_PRIORITY_MAP', () => {
  it('should map critical to ERROR', () => {
    expect(ALERT_PRIORITY_MAP['critical']).toBe('ERROR');
  });

  it('should map warning to WARN', () => {
    expect(ALERT_PRIORITY_MAP['warning']).toBe('WARN');
  });
});

describe('OPERATOR_MAP', () => {
  it('should map ABOVE', () => {
    expect(OPERATOR_MAP['ABOVE']).toBe('ABOVE');
  });

  it('should map BELOW', () => {
    expect(OPERATOR_MAP['BELOW']).toBe('BELOW');
  });

  it('should map ABOVE_OR_EQUALS to ABOVE_OR_EQUAL', () => {
    expect(OPERATOR_MAP['ABOVE_OR_EQUALS']).toBe('ABOVE_OR_EQUAL');
  });
});

describe('SYNTHETIC_MONITOR_TYPE_MAP', () => {
  it('should map SIMPLE to HTTP', () => {
    expect(SYNTHETIC_MONITOR_TYPE_MAP['SIMPLE']).toBe('HTTP');
  });

  it('should map BROWSER', () => {
    expect(SYNTHETIC_MONITOR_TYPE_MAP['BROWSER']).toBe('BROWSER');
  });

  it('should map SCRIPT_API to HTTP', () => {
    expect(SYNTHETIC_MONITOR_TYPE_MAP['SCRIPT_API']).toBe('HTTP');
  });
});

describe('MONITOR_PERIOD_MAP', () => {
  it('should map EVERY_MINUTE to 1', () => {
    expect(MONITOR_PERIOD_MAP['EVERY_MINUTE']).toBe(1);
  });

  it('should map EVERY_HOUR to 60', () => {
    expect(MONITOR_PERIOD_MAP['EVERY_HOUR']).toBe(60);
  });

  it('should map EVERY_DAY to 1440', () => {
    expect(MONITOR_PERIOD_MAP['EVERY_DAY']).toBe(1440);
  });
});

describe('NOTIFICATION_TYPE_MAP', () => {
  it('should map EMAIL to email', () => {
    expect(NOTIFICATION_TYPE_MAP['EMAIL']).toBe('email');
  });

  it('should map SLACK to slack', () => {
    expect(NOTIFICATION_TYPE_MAP['SLACK']).toBe('slack');
  });

  it('should map PAGERDUTY to pagerduty', () => {
    expect(NOTIFICATION_TYPE_MAP['PAGERDUTY']).toBe('pagerduty');
  });
});

describe('ENTITY_MAPPINGS', () => {
  it('should contain all mapping categories', () => {
    const expected = new Set([
      'visualization_types',
      'chart_types',
      'alert_priorities',
      'operators',
      'threshold_occurrences',
      'synthetic_monitor_types',
      'monitor_periods',
      'notification_types',
      'aggregations',
      'fill_options',
      'slo_time_units',
    ]);
    expect(new Set(Object.keys(ENTITY_MAPPINGS))).toEqual(expected);
  });
});

// ─── EntityMapper ────────────────────────────────────────────────────────────

describe('EntityMapper', () => {
  function createMapper(): EntityMapper {
    return new EntityMapper();
  }

  describe('init', () => {
    it('should register default mappings', () => {
      const mapper = createMapper();
      expect(mapper.getMapping('dashboard')).toBeDefined();
      expect(mapper.getMapping('alert_policy')).toBeDefined();
      expect(mapper.getMapping('alert_condition')).toBeDefined();
      expect(mapper.getMapping('synthetic_monitor')).toBeDefined();
      expect(mapper.getMapping('slo')).toBeDefined();
      expect(mapper.getMapping('workload')).toBeDefined();
    });

    it('should return undefined for unknown type', () => {
      const mapper = createMapper();
      expect(mapper.getMapping('nonexistent')).toBeUndefined();
    });
  });

  describe('registerMapping', () => {
    it('should register custom mapping', () => {
      const mapper = createMapper();
      mapper.registerMapping({
        sourceType: 'custom',
        targetType: 'target',
        fieldMappings: [],
      });
      const mapping = mapper.getMapping('custom');
      expect(mapping).toBeDefined();
      expect(mapping!.targetType).toBe('target');
    });

    it('should override existing mapping', () => {
      const mapper = createMapper();
      mapper.registerMapping({
        sourceType: 'dashboard',
        targetType: 'new_type',
        fieldMappings: [],
      });
      expect(mapper.getMapping('dashboard')!.targetType).toBe('new_type');
    });
  });

  describe('mapValue', () => {
    it('should map known value', () => {
      const mapper = createMapper();
      const result = mapper.mapValue('PUBLIC_READ_ONLY', { PUBLIC_READ_ONLY: true }, false);
      expect(result).toBe(true);
    });

    it('should return default for unknown value', () => {
      const mapper = createMapper();
      const result = mapper.mapValue('UNKNOWN', { A: 1 }, 42);
      expect(result).toBe(42);
    });

    it('should return default for null value', () => {
      const mapper = createMapper();
      const result = mapper.mapValue(null, { A: 1 }, 'default');
      expect(result).toBe('default');
    });

    it('should return original when no default', () => {
      const mapper = createMapper();
      const result = mapper.mapValue('UNKNOWN', { A: 1 });
      expect(result).toBe('UNKNOWN');
    });
  });

  describe('getNestedValue', () => {
    it('should get simple key', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ name: 'test' }, 'name')).toBe('test');
    });

    it('should get nested key', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ level1: { level2: 'value' } }, 'level1.level2')).toBe(
        'value',
      );
    });

    it('should get array index', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ items: ['a', 'b', 'c'] }, 'items[1]')).toBe('b');
    });

    it('should get nested array value', () => {
      const mapper = createMapper();
      const obj = { items: [{ name: 'first' }, { name: 'second' }] };
      expect(mapper.getNestedValue(obj, 'items[0].name')).toBe('first');
    });

    it('should return undefined for missing key', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ name: 'test' }, 'missing')).toBeUndefined();
    });

    it('should return undefined for missing nested key', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ level1: {} }, 'level1.level2')).toBeUndefined();
    });

    it('should return undefined for out of bounds index', () => {
      const mapper = createMapper();
      expect(mapper.getNestedValue({ items: ['a'] }, 'items[5]')).toBeUndefined();
    });
  });

  describe('setNestedValue', () => {
    it('should set simple key', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = {};
      mapper.setNestedValue(obj, 'name', 'test');
      expect(obj['name']).toBe('test');
    });

    it('should set nested key', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = {};
      mapper.setNestedValue(obj, 'level1.level2', 'value');
      expect((obj['level1'] as Record<string, unknown>)['level2']).toBe('value');
    });

    it('should create intermediate dicts', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = {};
      mapper.setNestedValue(obj, 'a.b.c', 'deep');
      expect(
        ((obj['a'] as Record<string, unknown>)['b'] as Record<string, unknown>)['c'],
      ).toBe('deep');
    });

    it('should set array value', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = {};
      mapper.setNestedValue(obj, 'items[0]', 'first');
      expect((obj['items'] as unknown[])[0]).toBe('first');
    });

    it('should set nested array value', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = {};
      mapper.setNestedValue(obj, 'items[0].name', 'test');
      expect(((obj['items'] as unknown[])[0] as Record<string, unknown>)['name']).toBe('test');
    });

    it('should extend array if needed', () => {
      const mapper = createMapper();
      const obj: Record<string, unknown> = { items: [] };
      mapper.setNestedValue(obj, 'items[2]', 'third');
      const items = obj['items'] as unknown[];
      expect(items.length).toBe(3);
      expect(items[2]).toBe('third');
    });
  });
});

describe('THRESHOLD_OCCURRENCES_MAP', () => {
  it('should map ALL', () => {
    expect(THRESHOLD_OCCURRENCES_MAP['ALL']).toBe('ALL');
  });

  it('should map AT_LEAST_ONCE', () => {
    expect(THRESHOLD_OCCURRENCES_MAP['AT_LEAST_ONCE']).toBe('AT_LEAST_ONCE');
  });
});

describe('FILL_OPTION_MAP', () => {
  it('should map NONE to DROP_DATA', () => {
    expect(FILL_OPTION_MAP['NONE']).toBe('DROP_DATA');
  });

  it('should map LAST_VALUE to USE_LAST_VALUE', () => {
    expect(FILL_OPTION_MAP['LAST_VALUE']).toBe('USE_LAST_VALUE');
  });
});

describe('SLO_TIME_UNIT_MAP', () => {
  it('should map DAY', () => {
    expect(SLO_TIME_UNIT_MAP['DAY']).toBe('DAY');
  });

  it('should map MONTH', () => {
    expect(SLO_TIME_UNIT_MAP['MONTH']).toBe('MONTH');
  });
});

describe('default mapping fields', () => {
  it('should have required name field on dashboard mapping', () => {
    const mapper = new EntityMapper();
    const mapping = mapper.getMapping('dashboard')!;
    const nameField = mapping.fieldMappings.find((f) => f.sourceField === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.required).toBe(true);
  });

  it('should have required target field on SLO mapping', () => {
    const mapper = new EntityMapper();
    const mapping = mapper.getMapping('slo')!;
    const targetField = mapping.fieldMappings.find(
      (f) => f.sourceField === 'objectives[0].target',
    );
    expect(targetField).toBeDefined();
    expect(targetField!.required).toBe(true);
  });

  it('should map alert condition name to summary', () => {
    const mapper = new EntityMapper();
    const mapping = mapper.getMapping('alert_condition')!;
    const nameField = mapping.fieldMappings.find((f) => f.sourceField === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.targetField).toBe('summary');
  });
});
