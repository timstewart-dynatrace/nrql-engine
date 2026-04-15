import { describe, it, expect, beforeEach } from 'vitest';
import { MaintenanceWindowTransformer } from '../../src/transformers/index.js';

describe('MaintenanceWindowTransformer', () => {
  let transformer: MaintenanceWindowTransformer;

  beforeEach(() => {
    transformer = new MaintenanceWindowTransformer();
  });

  it('should emit a ONCE window by default', () => {
    const result = transformer.transform({ kind: 'SCHEDULED', name: 'Deploy' });
    expect(result.success).toBe(true);
    expect(result.data!.window.schedule.scheduleType).toBe('ONCE');
    expect(result.data!.window.generalProperties.type).toBe('PLANNED');
    expect(result.data!.window.generalProperties.suppression).toBe(
      'DETECT_PROBLEMS_DONT_ALERT',
    );
  });

  it('should honor WEEKLY recurrence with daysOfWeek', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      name: 'Weekly maint',
      recurrence: 'WEEKLY',
      daysOfWeek: ['SUNDAY', 'SATURDAY'],
      startTime: '02:00',
      endTime: '04:00',
      timezone: 'America/New_York',
      startDate: '2026-01-01',
    });
    const s = result.data!.window.schedule;
    expect(s.scheduleType).toBe('WEEKLY');
    expect(s.daysOfWeek).toEqual(['SUNDAY', 'SATURDAY']);
    expect(s.timeZone).toBe('America/New_York');
    expect(s.recurrenceRange.startDate).toBe('2026-01-01');
  });

  it('should include endDate when provided', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
    expect(result.data!.window.schedule.recurrenceRange.endDate).toBe('2026-02-01');
  });

  it('should omit daysOfWeek when recurrence is not WEEKLY', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      recurrence: 'DAILY',
      daysOfWeek: ['MONDAY'],
    });
    expect(result.data!.window.schedule.daysOfWeek).toBeUndefined();
  });

  it('should convert MUTE_RULE with NRQL into filterSegmentDql TODO', () => {
    const result = transformer.transform({
      kind: 'MUTE_RULE',
      name: 'Silence staging',
      muteNrql: "env = 'staging'",
    });
    expect(result.data!.window.filterSegmentDql).toContain('NRQL source:');
    expect(result.data!.window.filterSegmentDql).toContain('TODO');
  });

  it('should warn on MUTE_RULE without NRQL', () => {
    const result = transformer.transform({ kind: 'MUTE_RULE', name: 'empty' });
    expect(result.warnings.some((w) => w.includes('MUTE_RULE'))).toBe(true);
    expect(result.data!.window.filterSegmentDql).toBeUndefined();
  });

  it('should honor DONT_DETECT_PROBLEMS suppression override', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      suppressionMode: 'DONT_DETECT_PROBLEMS',
    });
    expect(result.data!.window.generalProperties.suppression).toBe('DONT_DETECT_PROBLEMS');
  });

  it('should emit manual-step warnings about mute rule semantics and timezone', () => {
    const result = transformer.transform({ kind: 'MUTE_RULE' });
    expect(result.warnings.some((w) => w.includes('no direct equivalent'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('timezone'))).toBe(true);
  });
});
