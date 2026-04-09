/**
 * Tests for migration.retry -- FailedEntities.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FailedEntities } from '../../src/migration/index.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'retry-test-'));
}

function createSampleFailedEntities(): FailedEntities {
  const fe = new FailedEntities();
  fe.add('dashboard', 'Web Overview', 'API timeout');
  fe.add('dashboard', 'Mobile Stats', '403 Forbidden');
  fe.add('management_zone', 'Production', 'Validation error');
  return fe;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FailedEntities', () => {
  it('should add and retrieve', () => {
    const fe = createSampleFailedEntities();
    // Access entries through filtering since entries is private
    const dashboardNames = fe.getFailedNames('dashboard');
    expect(dashboardNames.length).toBe(2);
    expect(dashboardNames[0]).toBe('Web Overview');

    const mzNames = fe.getFailedNames('management_zone');
    expect(mzNames.length).toBe(1);
    expect(mzNames[0]).toBe('Production');
  });

  it('should save and load', () => {
    const tmpDir = createTmpDir();
    try {
      const fe = createSampleFailedEntities();
      const path = join(tmpDir, 'failures.json');
      fe.save(path);

      const loaded = FailedEntities.load(path);
      const dashNames = loaded.getFailedNames('dashboard');
      expect(dashNames.length).toBe(2);
      expect(dashNames[0]).toBe('Web Overview');

      const mzNames = loaded.getFailedNames('management_zone');
      expect(mzNames.length).toBe(1);
      expect(mzNames[0]).toBe('Production');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should filter by type', () => {
    const fe = createSampleFailedEntities();

    const dashboardNames = fe.getFailedNames('dashboard');
    expect(dashboardNames).toEqual(['Web Overview', 'Mobile Stats']);

    const mzNames = fe.getFailedNames('management_zone');
    expect(mzNames).toEqual(['Production']);

    expect(fe.getFailedNames('nonexistent')).toEqual([]);
  });

  it('should filter transformed data', () => {
    const fe = createSampleFailedEntities();

    const transformedData = {
      dashboard: [
        { name: 'Web Overview', tiles: [] },
        { name: 'Backend Perf', tiles: [] },
        { name: 'Mobile Stats', tiles: [] },
      ],
    };

    const result = fe.filterTransformedData(transformedData, 'dashboard', 'name');
    expect(result.length).toBe(2);
    const names = result.map((r) => r['name']);
    expect(names).toContain('Web Overview');
    expect(names).toContain('Mobile Stats');
    expect(names).not.toContain('Backend Perf');
  });

  it('should report empty', () => {
    const fe = new FailedEntities();
    expect(fe.isEmpty()).toBe(true);

    fe.add('dashboard', 'Test', 'error');
    expect(fe.isEmpty()).toBe(false);
  });
});
