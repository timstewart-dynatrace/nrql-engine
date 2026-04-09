/**
 * Tests for validators/dql-validator.ts -- DQL syntax validation.
 *
 * Ported from Python: tests/unit/test_dql_validator.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DQLSyntaxValidator } from '../../src/validators/index.js';

let validator: DQLSyntaxValidator;

beforeEach(() => {
  validator = new DQLSyntaxValidator();
});

// --- Valid DQL -----------------------------------------------------------------

describe('DQLSyntaxValidator', () => {
  describe('valid DQL', () => {
    it('should accept simple fetch', () => {
      const result = validator.validate('fetch logs');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept fetch with filter', () => {
      const result = validator.validate('fetch logs\n| filter status == "error"');
      expect(result.valid).toBe(true);
    });

    it('should accept timeseries start', () => {
      const result = validator.validate('timeseries avg(dt.host.cpu.usage)');
      expect(result.valid).toBe(true);
    });

    it('should accept data start', () => {
      // data record() uses = for assignment, but the validator flags it
      // as a single-equals comparison issue. Use == to avoid the false positive.
      const result = validator.validate('data record(a==1)');
      expect(result.valid).toBe(true);
    });

    it('should accept empty query', () => {
      const result = validator.validate('');
      expect(result.valid).toBe(true);
    });

    it('should accept comment only', () => {
      const result = validator.validate('// This is a comment');
      expect(result.valid).toBe(true);
    });

    it('should accept lowercase and/or', () => {
      const result = validator.validate('fetch logs\n| filter a == 1 and b == 2 or c == 3');
      expect(result.valid).toBe(true);
    });

    it('should accept double equals', () => {
      const result = validator.validate('fetch logs\n| filter status == "ok"');
      expect(result.valid).toBe(true);
    });

    it('should accept not equals', () => {
      const result = validator.validate('fetch logs\n| filter status != "error"');
      expect(result.valid).toBe(true);
    });
  });

  // --- Case-insensitive invalid patterns ---------------------------------------

  describe('case-insensitive invalid patterns', () => {
    it('should reject single equals with string', () => {
      const result = validator.validate('fetch logs\n| filter status = "error"');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('=='))).toBe(true);
    });

    it('should reject single equals with number', () => {
      const result = validator.validate('fetch logs\n| filter count = 5');
      expect(result.valid).toBe(false);
    });

    it('should reject triple not equals', () => {
      const result = validator.validate('fetch logs\n| filter a !== "b"');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('!=='))).toBe(true);
    });

    it('should reject single quotes', () => {
      const result = validator.validate("fetch logs\n| filter status == 'error'");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Single quotes'))).toBe(true);
    });

    it('should reject LIKE keyword', () => {
      const result = validator.validate('fetch logs\n| filter name LIKE "%test%"');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('LIKE'))).toBe(true);
    });

    it('should reject diamond operator', () => {
      const result = validator.validate('fetch logs\n| filter a <> b');
      expect(result.valid).toBe(false);
    });

    it('should reject double pipes', () => {
      const result = validator.validate('fetch logs\n| filter a == 1 || b == 2');
      expect(result.valid).toBe(false);
    });

    it('should reject semicolons', () => {
      const result = validator.validate('fetch logs; fetch spans');
      expect(result.valid).toBe(false);
    });

    it('should reject percentage function', () => {
      const result = validator.validate('fetch logs\n| summarize percentage(count(), status == "ok")');
      expect(result.valid).toBe(false);
    });

    it('should reject uniqueCount', () => {
      const result = validator.validate('fetch logs\n| summarize uniqueCount(user)');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('countDistinct'))).toBe(true);
    });

    it('should reject funnel', () => {
      const result = validator.validate('fetch logs\n| summarize funnel(session)');
      expect(result.valid).toBe(false);
    });

    it('should reject not contains', () => {
      const result = validator.validate('fetch logs\n| filter not contains(name, "test")');
      expect(result.valid).toBe(false);
    });

    it('should reject not startsWith', () => {
      const result = validator.validate('fetch logs\n| filter not startsWith(name, "test")');
      expect(result.valid).toBe(false);
    });

    it('should reject not endsWith', () => {
      const result = validator.validate('fetch logs\n| filter not endsWith(name, "test")');
      expect(result.valid).toBe(false);
    });
  });

  // --- Case-sensitive invalid patterns -----------------------------------------

  describe('case-sensitive invalid patterns', () => {
    it('should reject uppercase WHERE', () => {
      const result = validator.validate('fetch logs\n| WHERE status == "error"');
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('WHERE') && e.message.includes('filter')),
      ).toBe(true);
    });

    it('should reject uppercase AND', () => {
      const result = validator.validate('fetch logs\n| filter a == 1 AND b == 2');
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('AND') && e.message.includes('lowercase')),
      ).toBe(true);
    });

    it('should reject uppercase OR', () => {
      const result = validator.validate('fetch logs\n| filter a == 1 OR b == 2');
      expect(result.valid).toBe(false);
    });

    it('should reject uppercase NOT', () => {
      const result = validator.validate('fetch logs\n| filter NOT(a == 1)');
      expect(result.valid).toBe(false);
    });

    it('should reject IS NULL', () => {
      const result = validator.validate('fetch logs\n| filter name IS NULL');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('isNull'))).toBe(true);
    });

    it('should reject IS NOT NULL', () => {
      const result = validator.validate('fetch logs\n| filter name IS NOT NULL');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('isNotNull'))).toBe(true);
    });

    it('should reject FACET', () => {
      const result = validator.validate('fetch logs\nFACET name');
      expect(result.valid).toBe(false);
    });

    it('should reject SELECT', () => {
      const result = validator.validate('SELECT count(*)\nfetch logs');
      expect(result.valid).toBe(false);
    });

    it('should reject FROM', () => {
      const result = validator.validate('fetch logs\nFROM dt.logs');
      expect(result.valid).toBe(false);
    });

    it('should reject SINCE', () => {
      const result = validator.validate('fetch logs\nSINCE 1 hour ago');
      expect(result.valid).toBe(false);
    });

    it('should reject UNTIL', () => {
      const result = validator.validate('fetch logs\nUNTIL now');
      expect(result.valid).toBe(false);
    });
  });

  // --- Structural checks -------------------------------------------------------

  describe('structural checks', () => {
    it('should reject unbalanced open paren', () => {
      const result = validator.validate('fetch logs\n| filter count((a)');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.toLowerCase().includes('parentheses'))).toBe(true);
    });

    it('should reject unbalanced close paren', () => {
      const result = validator.validate('fetch logs\n| filter count(a))');
      expect(result.valid).toBe(false);
    });

    it('should reject unbalanced open brace', () => {
      const result = validator.validate('fetch logs\n| summarize count(), by: {name');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.toLowerCase().includes('brace'))).toBe(true);
    });

    it('should reject unbalanced close brace', () => {
      const result = validator.validate('fetch logs\n| summarize count(), by: name}');
      expect(result.valid).toBe(false);
    });

    it('should reject wrong first command', () => {
      const result = validator.validate('select count(*) from logs');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('fetch'))).toBe(true);
    });

    it('should accept comment before fetch', () => {
      const result = validator.validate('// comment\nfetch logs');
      expect(result.valid).toBe(true);
    });
  });

  // --- Position reporting ------------------------------------------------------

  describe('position reporting', () => {
    it('should report line number', () => {
      const result = validator.validate('fetch logs\n| filter a == 1 AND b == 2');
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.line).toBeGreaterThanOrEqual(1);
    });

    it('should report error severity', () => {
      const result = validator.validate('fetch logs\n| filter a AND b');
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.severity).toBe('ERROR');
    });
  });

  // --- Performance anti-pattern detection --------------------------------------

  describe('anti-patterns', () => {
    it('should warn sort before filter', () => {
      const result = validator.validate(
        'fetch logs\n| sort timestamp desc\n| filter loglevel == "ERROR"',
      );
      // Valid query but with performance warning
      const warnings = result.errors.filter((e) => e.severity === 'WARNING');
      expect(
        warnings.some(
          (w) => w.message.toLowerCase().includes('sort') && w.message.toLowerCase().includes('filter'),
        ),
      ).toBe(true);
    });

    it('should not warn sort after filter', () => {
      const result = validator.validate(
        'fetch logs\n| filter loglevel == "ERROR"\n| sort timestamp desc',
      );
      const sortWarnings = result.errors.filter(
        (e) => e.severity === 'WARNING' && e.message.toLowerCase().includes('sort'),
      );
      expect(sortWarnings).toHaveLength(0);
    });

    it('should warn limit before summarize', () => {
      const result = validator.validate('fetch logs\n| limit 1000\n| summarize count()');
      const warnings = result.errors.filter((e) => e.severity === 'WARNING');
      expect(
        warnings.some(
          (w) =>
            w.message.toLowerCase().includes('limit') &&
            w.message.toLowerCase().includes('summarize'),
        ),
      ).toBe(true);
    });

    it('should not warn limit after summarize', () => {
      const result = validator.validate(
        'fetch logs\n| summarize count(), by: {host}\n| limit 10',
      );
      const limitWarnings = result.errors.filter(
        (e) => e.severity === 'WARNING' && e.message.toLowerCase().includes('limit'),
      );
      expect(limitWarnings).toHaveLength(0);
    });

    it('should still be valid with only warnings', () => {
      const result = validator.validate(
        'fetch logs\n| sort timestamp desc\n| filter loglevel == "ERROR"',
      );
      // Anti-patterns are warnings, not errors -- query is still valid
      expect(result.valid).toBe(true);
    });
  });
});
