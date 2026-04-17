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

  it('should honor rrule FREQ=WEEKLY;BYDAY=MO,WE,FR', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    });
    expect(result.data!.window.schedule.scheduleType).toBe('WEEKLY');
    expect(result.data!.window.schedule.daysOfWeek).toEqual([
      'MONDAY',
      'WEDNESDAY',
      'FRIDAY',
    ]);
  });

  it('should honor rrule FREQ=DAILY', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=DAILY',
    });
    expect(result.data!.window.schedule.scheduleType).toBe('DAILY');
  });

  it('should downgrade FREQ=YEARLY to MONTHLY with warning', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=YEARLY',
    });
    expect(result.data!.window.schedule.scheduleType).toBe('MONTHLY');
    expect(result.warnings.some((w) => w.includes('YEARLY'))).toBe(true);
  });

  it('should warn on INTERVAL != 1', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    });
    expect(result.warnings.some((w) => w.includes('INTERVAL=2'))).toBe(true);
  });

  it('should warn on unsupported rrule parts', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=MONTHLY;BYMONTH=3;BYSETPOS=-1;COUNT=5;UNTIL=20261231',
    });
    expect(result.warnings.some((w) => w.includes('BYMONTH'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('BYSETPOS'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('COUNT'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('UNTIL'))).toBe(true);
  });

  it('should strip BYDAY position prefixes like "2MO"', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=MONTHLY;BYDAY=2MO',
    });
    expect(result.data!.window.schedule.scheduleType).toBe('MONTHLY');
  });

  it('should warn on unrecognized BYDAY tokens', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      rrule: 'FREQ=WEEKLY;BYDAY=ZZ',
    });
    expect(result.warnings.some((w) => w.includes('BYDAY token'))).toBe(true);
  });

  it('should take rrule precedence over recurrence + daysOfWeek', () => {
    const result = transformer.transform({
      kind: 'SCHEDULED',
      recurrence: 'DAILY',
      daysOfWeek: ['MONDAY'],
      rrule: 'FREQ=WEEKLY;BYDAY=SA,SU',
    });
    expect(result.data!.window.schedule.scheduleType).toBe('WEEKLY');
    expect(result.data!.window.schedule.daysOfWeek).toEqual(['SATURDAY', 'SUNDAY']);
  });
});

describe('translateScimFilter', () => {
  it('should return empty filter untouched', async () => {
    const { translateScimFilter } = await import('../../src/transformers/index.js');
    expect(translateScimFilter('').filter).toBe('');
  });

  it('should rewrite userName / emails.value to email', async () => {
    const { translateScimFilter } = await import('../../src/transformers/index.js');
    const a = translateScimFilter('userName eq "alice@example.com"');
    expect(a.filter).toBe('email eq "alice@example.com"');
    const b = translateScimFilter('emails.value eq "bob@example.com"');
    expect(b.filter).toBe('email eq "bob@example.com"');
  });

  it('should rewrite name.givenName / name.familyName / active', async () => {
    const { translateScimFilter } = await import('../../src/transformers/index.js');
    const r = translateScimFilter(
      'name.givenName eq "Alice" and name.familyName eq "Smith" and active eq true',
    );
    expect(r.filter).toBe('firstName eq "Alice" and lastName eq "Smith" and enabled eq true');
  });

  it('should warn on meta.* attribute references', async () => {
    const { translateScimFilter } = await import('../../src/transformers/index.js');
    const r = translateScimFilter('meta.created ge "2026-01-01T00:00:00Z"');
    expect(r.warnings.some((w) => w.includes('meta.'))).toBe(true);
  });

  it('should preserve complex logical operators', async () => {
    const { translateScimFilter } = await import('../../src/transformers/index.js');
    const r = translateScimFilter(
      '(userName co "alice" or userName co "bob") and active eq true',
    );
    expect(r.filter).toContain('email co "alice"');
    expect(r.filter).toContain('email co "bob"');
    expect(r.filter).toContain('enabled eq true');
  });
});
