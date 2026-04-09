/**
 * Tests for InfrastructureTransformer.
 *
 * Ported from Python: tests/unit/test_infrastructure_transformer.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InfrastructureTransformer } from '../../src/transformers/index.js';

let infraTransformer: InfrastructureTransformer;

beforeEach(() => {
  infraTransformer = new InfrastructureTransformer();
});

// ═════════════════════════════════════════════════════════════════════════════
// Result defaults
// ═════════════════════════════════════════════════════════════════════════════

describe('InfrastructureTransformResult', () => {
  it('should return result with data array', () => {
    const condition = {
      name: 'Test',
      type: 'host_not_reporting',
      criticalThreshold: { durationMinutes: 5 },
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Host Not Reporting
// ═════════════════════════════════════════════════════════════════════════════

describe('InfraTransform host not reporting', () => {
  it('should map to host availability metric', () => {
    const condition = {
      name: 'Host Down',
      type: 'host_not_reporting',
      enabled: true,
      criticalThreshold: { durationMinutes: 5 },
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const event = result.data![0]!;
    expect(event.metricId).toBe('builtin:host.availability');
    expect(event.alertCondition).toBe('BELOW');
    expect(event.enabled).toBe(true);
    expect(event.name).toContain('[Migrated]');
  });

  it('should use duration from threshold', () => {
    const condition = {
      name: 'Host Down',
      type: 'host_not_reporting',
      criticalThreshold: { durationMinutes: 10 },
    };
    const result = infraTransformer.transform(condition);
    const event = result.data![0]!;
    expect(event.samples).toBe(10);
    expect(event.violatingSamples).toBe(10);
    expect(event.dealertingSamples).toBe(20);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Process Not Running
// ═════════════════════════════════════════════════════════════════════════════

describe('InfraTransform process not running', () => {
  it('should map to process count metric', () => {
    const condition = {
      name: 'Nginx Down',
      type: 'process_not_running',
      enabled: true,
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const event = result.data![0]!;
    expect(event.metricId).toBe('builtin:tech.generic.process.count');
    expect(event.alertCondition).toBe('BELOW');
    expect(event.alertConditionValue).toBe(1);
  });

  it('should warn on process filter', () => {
    const condition = {
      name: 'Custom Process',
      type: 'process_not_running',
      processWhereClause: "commandName = 'myapp'",
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(
      result.warnings.some(
        (w) =>
          w.toLowerCase().includes('process filter') ||
          w.includes('processWhereClause') ||
          w.toLowerCase().includes('manual'),
      ),
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Infra Metric
// ═════════════════════════════════════════════════════════════════════════════

describe('InfraTransform metric', () => {
  it('should map known metric', () => {
    const condition = {
      name: 'High CPU',
      type: 'infra_metric',
      event_type: 'SystemSample',
      select_value: 'cpuPercent',
      comparison: 'above',
      criticalThreshold: { value: 90, durationMinutes: 5 },
      enabled: true,
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    const event = result.data![0]!;
    expect(event.metricId).toBe('builtin:host.cpu.usage');
    expect(event.alertCondition).toBe('ABOVE');
    expect(event.alertConditionValue).toBe(90);
  });

  it('should warn on unmapped metric', () => {
    const condition = {
      name: 'Custom Metric',
      type: 'infra_metric',
      event_type: 'SystemSample',
      select_value: 'customGauge',
      comparison: 'above',
      criticalThreshold: { value: 100, durationMinutes: 3 },
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes('no direct mapping'))).toBe(true);
    const event = result.data![0]!;
    expect(event.metricId).toContain('customGauge');
  });

  it('should map below operator', () => {
    const condition = {
      name: 'Low Disk',
      type: 'infra_metric',
      select_value: 'diskUsedPercent',
      comparison: 'below',
      criticalThreshold: { value: 10, durationMinutes: 5 },
    };
    const result = infraTransformer.transform(condition);
    const event = result.data![0]!;
    expect(event.alertCondition).toBe('BELOW');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Unknown Type
// ═════════════════════════════════════════════════════════════════════════════

describe('InfraTransform unknown', () => {
  it('should warn and create placeholder', () => {
    const condition = {
      name: 'Mystery Condition',
      type: 'custom_integration',
    };
    const result = infraTransformer.transform(condition);
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes('unknown'))).toBe(true);
    const event = result.data![0]!;
    expect(event.enabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transform All
// ═════════════════════════════════════════════════════════════════════════════

describe('InfraTransformAll', () => {
  it('should transform multiple conditions', () => {
    const conditions = [
      { name: 'Host Down', type: 'host_not_reporting', criticalThreshold: { durationMinutes: 5 } },
      {
        name: 'High CPU',
        type: 'infra_metric',
        select_value: 'cpuPercent',
        comparison: 'above',
        criticalThreshold: { value: 90, durationMinutes: 5 },
      },
      { name: 'Nginx', type: 'process_not_running' },
    ];
    const results = infraTransformer.transformAll(conditions);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
