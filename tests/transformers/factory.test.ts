import { describe, it, expect } from 'vitest';
import {
  createTransformer,
  hasLegacyVariant,
  LEGACY_SUPPORTED_KINDS,
  AlertTransformer,
  LegacyAlertTransformer,
  NotificationTransformer,
  LegacyNotificationTransformer,
  TagTransformer,
  LegacyTagTransformer,
  WorkloadTransformer,
  LegacyWorkloadTransformer,
  DashboardTransformer,
  LegacyDashboardTransformer,
  SLOTransformer,
  LegacySLOTransformer,
  SyntheticTransformer,
  LegacySyntheticTransformer,
  DropRuleTransformer,
  InfrastructureTransformer,
  LogParsingTransformer,
} from '../../src/transformers/index.js';

describe('createTransformer factory', () => {
  it('should route Gen3 default for each legacy-capable kind', () => {
    expect(createTransformer('alert')).toBeInstanceOf(AlertTransformer);
    expect(createTransformer('notification')).toBeInstanceOf(NotificationTransformer);
    expect(createTransformer('tag')).toBeInstanceOf(TagTransformer);
    expect(createTransformer('workload')).toBeInstanceOf(WorkloadTransformer);
    expect(createTransformer('dashboard')).toBeInstanceOf(DashboardTransformer);
    expect(createTransformer('slo')).toBeInstanceOf(SLOTransformer);
    expect(createTransformer('synthetic')).toBeInstanceOf(SyntheticTransformer);
  });

  it('should route Legacy* for each kind with { legacy: true }', () => {
    expect(createTransformer('alert', { legacy: true })).toBeInstanceOf(
      LegacyAlertTransformer,
    );
    expect(createTransformer('notification', { legacy: true })).toBeInstanceOf(
      LegacyNotificationTransformer,
    );
    expect(createTransformer('tag', { legacy: true })).toBeInstanceOf(
      LegacyTagTransformer,
    );
    expect(createTransformer('workload', { legacy: true })).toBeInstanceOf(
      LegacyWorkloadTransformer,
    );
    expect(createTransformer('dashboard', { legacy: true })).toBeInstanceOf(
      LegacyDashboardTransformer,
    );
    expect(createTransformer('slo', { legacy: true })).toBeInstanceOf(
      LegacySLOTransformer,
    );
    expect(createTransformer('synthetic', { legacy: true })).toBeInstanceOf(
      LegacySyntheticTransformer,
    );
  });

  it('should return Gen3 class unchanged for Gen3-only kinds', () => {
    expect(createTransformer('drop-rule')).toBeInstanceOf(DropRuleTransformer);
    expect(createTransformer('drop-rule', { legacy: true })).toBeInstanceOf(
      DropRuleTransformer,
    );
    expect(createTransformer('infrastructure')).toBeInstanceOf(
      InfrastructureTransformer,
    );
    expect(createTransformer('log-parsing')).toBeInstanceOf(LogParsingTransformer);
  });

  it('should throw on unknown kind', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createTransformer('mystery' as any)).toThrow();
  });

  it('hasLegacyVariant should reflect LEGACY_SUPPORTED_KINDS', () => {
    expect(hasLegacyVariant('alert')).toBe(true);
    expect(hasLegacyVariant('drop-rule')).toBe(false);
    expect(LEGACY_SUPPORTED_KINDS.has('dashboard')).toBe(true);
    expect(LEGACY_SUPPORTED_KINDS.has('infrastructure')).toBe(false);
    expect(LEGACY_SUPPORTED_KINDS.size).toBe(7);
  });
});
