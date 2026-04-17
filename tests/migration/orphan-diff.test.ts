import { describe, it, expect } from 'vitest';
import { DiffReport } from '../../src/migration/diff.js';

describe('DiffReport ORPHAN detection (P15-03)', () => {
  it('adds ORPHAN entries when DT has migrated entities not in transformed set', async () => {
    const registry = {
      dashboardExists: async (_name: string) => undefined,
      findManagementZone: async (_name: string) => undefined,
      listDashboards: async () => [
        { id: 'DB-1', name: '[Migrated] Leftover dash', payload: { name: '[Migrated] Leftover dash' } },
      ],
    };
    const report = await DiffReport.generateDiff(
      { dashboards: [] },
      registry,
    );
    expect(report.getOrphans()).toHaveLength(1);
    expect(report.getOrphans()[0]!.action).toBe('ORPHAN');
    expect(report.getOrphans()[0]!.dtId).toBe('DB-1');
  });

  it('does not flag DT entities that are in the transformed set', async () => {
    const registry = {
      dashboardExists: async (_name: string) => 'DB-1',
      findManagementZone: async (_name: string) => undefined,
      listDashboards: async () => [
        { id: 'DB-1', name: 'Prod', payload: { name: '[Migrated] Prod' } },
      ],
    };
    const report = await DiffReport.generateDiff(
      { dashboards: [{ name: 'Prod' }] },
      registry,
    );
    expect(report.getOrphans()).toHaveLength(0);
  });

  it('does not flag organic DT entities that do not look migrated', async () => {
    const registry = {
      dashboardExists: async (_name: string) => undefined,
      findManagementZone: async (_name: string) => undefined,
      listDashboards: async () => [
        { id: 'DB-organic', name: 'Team dash', payload: { name: 'Team dash' } },
      ],
    };
    const report = await DiffReport.generateDiff({ dashboards: [] }, registry);
    expect(report.getOrphans()).toHaveLength(0);
  });

  it('covers both dashboards and management zones', async () => {
    const registry = {
      dashboardExists: async (_name: string) => undefined,
      findManagementZone: async (_name: string) => undefined,
      listDashboards: async () => [
        { id: 'D1', name: '[Migrated] x', payload: { name: '[Migrated] x' } },
      ],
      listManagementZones: async () => [
        { id: 'MZ1', name: '[Migrated Legacy] z', payload: { name: '[Migrated Legacy] z' } },
      ],
    };
    const report = await DiffReport.generateDiff(
      { dashboards: [], management_zones: [] },
      registry,
    );
    const orphans = report.getOrphans();
    expect(orphans).toHaveLength(2);
    expect(orphans.find((o) => o.entityType === 'dashboard')).toBeDefined();
    expect(orphans.find((o) => o.entityType === 'management_zone')).toBeDefined();
  });

  it('summary includes orphans count', async () => {
    const registry = {
      dashboardExists: async (_name: string) => undefined,
      findManagementZone: async (_name: string) => undefined,
      listDashboards: async () => [
        { id: 'D1', name: '[Migrated] x', payload: { name: '[Migrated] x' } },
      ],
    };
    const report = await DiffReport.generateDiff({ dashboards: [] }, registry);
    expect(report.summary().orphans).toBe(1);
  });

  it('back-compat: registry without listDashboards still works (no orphans)', async () => {
    const registry = {
      dashboardExists: async (_name: string) => undefined,
      findManagementZone: async (_name: string) => undefined,
    };
    const report = await DiffReport.generateDiff(
      { dashboards: [{ name: 'Prod' }] },
      registry,
    );
    expect(report.getOrphans()).toHaveLength(0);
  });
});
