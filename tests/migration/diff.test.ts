/**
 * Tests for migration.diff -- DiffReport and DiffEntry.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

import { DiffReport } from '../../src/migration/index.js';

// ---------------------------------------------------------------------------
// Mock registry
// ---------------------------------------------------------------------------

function createMockRegistry() {
  return {
    dashboardExists: vi.fn().mockResolvedValue(undefined),
    findManagementZone: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiffReport', () => {
  it('should add entry', () => {
    const report = new DiffReport();
    report.add('dashboard', 'Web Overview', 'CREATE', 'Not found in DT');
    expect(report.entries.length).toBe(1);

    const entry = report.entries[0];
    expect(entry.entityType).toBe('dashboard');
    expect(entry.name).toBe('Web Overview');
    expect(entry.action).toBe('CREATE');
    expect(entry.reason).toBe('Not found in DT');
    expect(entry.dtId).toBeUndefined();
  });

  it('should compute summary', () => {
    const report = new DiffReport();
    report.add('dashboard', 'Dash A', 'CREATE', 'Not found in DT');
    report.add('dashboard', 'Dash B', 'CREATE', 'Not found in DT');
    report.add('dashboard', 'Dash C', 'UPDATE', 'Name match found', 'dt-1');
    report.add('management_zone', 'MZ A', 'CONFLICT', 'Multiple matches');

    const summary = report.summary();
    expect(summary).toEqual({ creates: 2, updates: 1, conflicts: 1, orphans: 0 });
  });

  it('should identify creates', async () => {
    const mockRegistry = createMockRegistry();
    const transformed = {
      dashboards: [
        { name: 'New Dashboard' },
        { name: 'Another New' },
      ],
    };

    const report = await DiffReport.generateDiff(transformed, mockRegistry);
    const creates = report.getCreates();
    expect(creates.length).toBe(2);
    expect(creates.every((e) => e.action === 'CREATE')).toBe(true);
    expect(creates[0].name).toBe('New Dashboard');
  });

  it('should identify updates', async () => {
    const mockRegistry = createMockRegistry();
    mockRegistry.dashboardExists.mockImplementation(
      (name: string) => Promise.resolve(name === 'Existing Dash' ? 'dt-abc' : undefined),
    );

    const transformed = {
      dashboards: [
        { name: 'Existing Dash' },
        { name: 'Brand New Dash' },
      ],
    };

    const report = await DiffReport.generateDiff(transformed, mockRegistry);

    const updates = report.getUpdates();
    expect(updates.length).toBe(1);
    expect(updates[0].name).toBe('Existing Dash');
    expect(updates[0].dtId).toBe('dt-abc');

    const creates = report.getCreates();
    expect(creates.length).toBe(1);
    expect(creates[0].name).toBe('Brand New Dash');
  });

  it('should handle empty data', async () => {
    const mockRegistry = createMockRegistry();
    const report = await DiffReport.generateDiff({}, mockRegistry);
    expect(report.entries.length).toBe(0);
    expect(report.summary()).toEqual({ creates: 0, updates: 0, conflicts: 0, orphans: 0 });
    expect(report.getCreates()).toEqual([]);
    expect(report.getUpdates()).toEqual([]);
  });
});
