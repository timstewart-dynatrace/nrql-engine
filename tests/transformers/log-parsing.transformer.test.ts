/**
 * Tests for LogParsingTransformer.
 *
 * Ported from Python: tests/unit/test_log_parsing_transformer.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LogParsingTransformer } from '../../src/transformers/index.js';

let logParsingTransformer: LogParsingTransformer;

beforeEach(() => {
  logParsingTransformer = new LogParsingTransformer();
});

// ═════════════════════════════════════════════════════════════════════════════
// Result defaults
// ═════════════════════════════════════════════════════════════════════════════

describe('LogParsingTransformResult', () => {
  it('should return result with data array', () => {
    const rule = {
      name: 'Test',
      type: 'regex',
      pattern: '(\\w+)',
      attributes: ['word'],
    };
    const result = logParsingTransformer.transform(rule);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Regex Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('LogParsingTransform regex', () => {
  it('should create processing rule with dpl pattern', () => {
    const rule = {
      name: 'Extract IP',
      type: 'regex',
      pattern: '(\\d+\\.\\d+\\.\\d+\\.\\d+) - (\\w+)',
      attributes: ['ip_address', 'user'],
      enabled: true,
    };
    const result = logParsingTransformer.transform(rule);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const pr = result.data![0]!;
    expect(pr.type).toBe('ATTRIBUTE_EXTRACTION');
    expect(pr.name).toContain('[Migrated]');
    expect(pr.enabled).toBe(true);
    expect(pr.source).toBe('content');
  });

  it('should handle empty pattern', () => {
    const rule = {
      name: 'Empty Pattern',
      type: 'regex',
      pattern: '',
      attributes: [],
    };
    const result = logParsingTransformer.transform(rule);
    expect(result.success).toBe(true);
    const pr = result.data![0]!;
    expect(pr.pattern).toContain('TODO');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Grok Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('LogParsingTransform grok', () => {
  it('should warn about manual conversion', () => {
    const rule = {
      name: 'Apache Log',
      type: 'grok',
      pattern: '%{COMMONAPACHELOG}',
      enabled: true,
    };
    const result = logParsingTransformer.transform(rule);
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(
      result.warnings.some(
        (w) => w.toLowerCase().includes('manual') || w.toLowerCase().includes('grok'),
      ),
    ).toBe(true);
    const pr = result.data![0]!;
    expect(pr.enabled).toBe(false);
  });

  it('should include todo in pattern', () => {
    const rule = {
      name: 'Syslog',
      type: 'grok',
      pattern: '%{SYSLOGLINE}',
    };
    const result = logParsingTransformer.transform(rule);
    const pr = result.data![0]!;
    expect(pr.pattern).toContain('TODO');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Disabled Rule
// ═════════════════════════════════════════════════════════════════════════════

describe('LogParsingTransform disabled', () => {
  it('should keep disabled state', () => {
    const rule = {
      name: 'Old Rule',
      type: 'regex',
      pattern: 'error: (.+)',
      attributes: ['message'],
      enabled: false,
    };
    const result = logParsingTransformer.transform(rule);
    expect(result.success).toBe(true);
    const pr = result.data![0]!;
    expect(pr.enabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transform All
// ═════════════════════════════════════════════════════════════════════════════

describe('LogParsingTransformAll', () => {
  it('should transform multiple rules', () => {
    const rules = [
      { name: 'Rule 1', type: 'regex', pattern: '(\\w+)', attributes: ['word'] },
      { name: 'Rule 2', type: 'grok', pattern: '%{IP}' },
      { name: 'Rule 3', type: 'regex', pattern: 'status=(\\d+)', attributes: ['status'], enabled: false },
    ];
    const results = logParsingTransformer.transformAll(rules);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
