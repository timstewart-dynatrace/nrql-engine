import { describe, it, expect } from 'vitest';
import {
  WarningCode,
  ErrorCode,
  WARNING_LABELS,
  warningsByCode,
  emitted,
} from '../../src/utils/warning-codes.js';

describe('WarningCode taxonomy', () => {
  it('should expose every code value as its own string literal', () => {
    // The WarningCode enum is string-backed — each member is its own id
    expect(WarningCode.CONFIDENCE_LOW).toBe('CONFIDENCE_LOW');
    expect(WarningCode.PHASE19_UPLIFT).toBe('PHASE19_UPLIFT');
  });

  it('should have a human label for every WarningCode member', () => {
    for (const key of Object.values(WarningCode)) {
      expect(WARNING_LABELS[key]).toBeTruthy();
    }
  });

  it('should bucket a list of codes with warningsByCode', () => {
    const codes = [
      WarningCode.CONFIDENCE_LOW,
      WarningCode.CONFIDENCE_LOW,
      WarningCode.RATE_LIMITED,
    ];
    const bucket = warningsByCode(codes);
    expect(bucket[WarningCode.CONFIDENCE_LOW]).toHaveLength(2);
    expect(bucket[WarningCode.RATE_LIMITED]).toHaveLength(1);
  });

  it('should accept CodedWarning objects mixed with bare codes', () => {
    const bucket = warningsByCode([
      { code: WarningCode.METRIC_UNMAPPED, message: 'x' },
      WarningCode.METRIC_UNMAPPED,
    ]);
    expect(bucket[WarningCode.METRIC_UNMAPPED]).toHaveLength(2);
  });

  it('emitted() passes the message through unchanged', () => {
    expect(emitted(WarningCode.CONFIDENCE_LOW, 'low')).toBe('low');
  });

  it('ErrorCode values are stable strings', () => {
    expect(ErrorCode.PARSE_ERROR).toBe('PARSE_ERROR');
    expect(ErrorCode.EMIT_ERROR).toBe('EMIT_ERROR');
  });
});
