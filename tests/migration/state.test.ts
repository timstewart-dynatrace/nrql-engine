/**
 * Tests for migration.state -- RollbackManifest, EntityIdMap, MigrationCheckpoint, IncrementalState.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RollbackManifest,
  EntityIdMap,
  MigrationCheckpoint,
  IncrementalState,
} from '../../src/migration/index.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'migration-test-'));
}

// ---------------------------------------------------------------------------
// RollbackManifest
// ---------------------------------------------------------------------------

describe('RollbackManifest', () => {
  it('should add entry', () => {
    const manifest = new RollbackManifest();
    manifest.add('dashboard', 'dt-123', 'My Dashboard');
    const entries = manifest.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].entityType).toBe('dashboard');
    expect(entries[0].dynatraceId).toBe('dt-123');
    expect(entries[0].name).toBe('My Dashboard');
  });

  it('should save and load', () => {
    const tmpDir = createTmpDir();
    try {
      const manifest = new RollbackManifest();
      manifest.add('dashboard', 'dt-001', 'Dash A');
      manifest.add('alert', 'dt-002', 'Alert B');
      const path = join(tmpDir, 'rollback.json');
      manifest.save(path);

      const loaded = RollbackManifest.load(path);
      const entries = loaded.getEntries();
      expect(entries.length).toBe(2);
      expect(entries[0].dynatraceId).toBe('dt-001');
      expect(entries[1].entityType).toBe('alert');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should track timestamp', () => {
    const manifest = new RollbackManifest();
    manifest.add('slo', 'dt-999', 'SLO Test');
    const entry = manifest.getEntries()[0];
    expect(entry.timestamp).toBeDefined();
    expect(typeof entry.timestamp).toBe('string');
    expect(entry.timestamp.length).toBeGreaterThan(0);
  });

  it('should start empty', () => {
    const manifest = new RollbackManifest();
    expect(manifest.getEntries()).toEqual([]);
  });

  it('should throw on load nonexistent file', () => {
    const tmpDir = createTmpDir();
    try {
      const badPath = join(tmpDir, 'does_not_exist.json');
      expect(() => RollbackManifest.load(badPath)).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should add multiple entries', () => {
    const manifest = new RollbackManifest();
    manifest.add('dashboard', 'dt-1', 'D1');
    manifest.add('alert', 'dt-2', 'A1');
    manifest.add('slo', 'dt-3', 'S1');
    const entries = manifest.getEntries();
    expect(entries.length).toBe(3);
    const types = entries.map((e) => e.entityType);
    expect(types).toEqual(['dashboard', 'alert', 'slo']);
  });
});

// ---------------------------------------------------------------------------
// EntityIdMap
// ---------------------------------------------------------------------------

describe('EntityIdMap', () => {
  it('should register and resolve', () => {
    const idMap = new EntityIdMap();
    idMap.register('nr-guid-1', 'dt-id-1', 'dashboard');
    expect(idMap.resolve('nr-guid-1')).toBe('dt-id-1');
  });

  it('should return undefined for unknown', () => {
    const idMap = new EntityIdMap();
    expect(idMap.resolve('nonexistent-guid')).toBeUndefined();
  });

  it('should save and load', () => {
    const tmpDir = createTmpDir();
    try {
      const idMap = new EntityIdMap();
      idMap.register('nr-1', 'dt-1', 'dashboard');
      idMap.register('nr-2', 'dt-2', 'alert');
      const path = join(tmpDir, 'id_map.json');
      idMap.save(path);

      const loaded = EntityIdMap.load(path);
      expect(loaded.resolve('nr-1')).toBe('dt-1');
      expect(loaded.resolve('nr-2')).toBe('dt-2');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should overwrite existing', () => {
    const idMap = new EntityIdMap();
    idMap.register('nr-1', 'dt-old', 'dashboard');
    idMap.register('nr-1', 'dt-new', 'dashboard');
    expect(idMap.resolve('nr-1')).toBe('dt-new');
  });

  it('should start empty', () => {
    const idMap = new EntityIdMap();
    expect(idMap.resolve('anything')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MigrationCheckpoint
// ---------------------------------------------------------------------------

describe('MigrationCheckpoint', () => {
  it('should mark complete', () => {
    const cp = new MigrationCheckpoint();
    cp.markComplete('dashboards', 4);
    expect(cp.getResumeIndex('dashboards')).toBe(5);
  });

  it('should return resume index', () => {
    const cp = new MigrationCheckpoint();
    cp.markComplete('alerts', 2);
    expect(cp.getResumeIndex('alerts')).toBe(3);
  });

  it('should report complete when all done', () => {
    const cp = new MigrationCheckpoint();
    cp.markComplete('dashboards', 9);
    expect(cp.isComplete('dashboards', 10)).toBe(true);
    expect(cp.isComplete('dashboards', 11)).toBe(false);
  });

  it('should save and load', () => {
    const tmpDir = createTmpDir();
    try {
      const cp = new MigrationCheckpoint();
      cp.markComplete('dashboards', 5);
      cp.markComplete('alerts', 3);
      const path = join(tmpDir, 'checkpoint.json');
      cp.save(path);

      const loaded = MigrationCheckpoint.load(path);
      expect(loaded.getResumeIndex('dashboards')).toBe(6);
      expect(loaded.getResumeIndex('alerts')).toBe(4);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should return zero for unknown component', () => {
    const cp = new MigrationCheckpoint();
    expect(cp.getResumeIndex('unknown_component')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// IncrementalState
// ---------------------------------------------------------------------------

describe('IncrementalState', () => {
  it('should detect changed entity', () => {
    const state = new IncrementalState();
    const dataV1 = { name: 'Dashboard A', widgets: [1, 2] };
    const dataV2 = { name: 'Dashboard A', widgets: [1, 2, 3] };
    state.update('nr-1', dataV1);
    expect(state.hasChanged('nr-1', dataV2)).toBe(true);
  });

  it('should detect unchanged entity', () => {
    const state = new IncrementalState();
    const data = { name: 'Dashboard A', widgets: [1, 2] };
    state.update('nr-1', data);
    expect(state.hasChanged('nr-1', data)).toBe(false);
  });

  it('should update hash', () => {
    const state = new IncrementalState();
    const dataV1 = { name: 'v1' };
    const dataV2 = { name: 'v2' };
    state.update('nr-1', dataV1);
    expect(state.hasChanged('nr-1', dataV2)).toBe(true);
    state.update('nr-1', dataV2);
    expect(state.hasChanged('nr-1', dataV2)).toBe(false);
  });

  it('should save and load', () => {
    const tmpDir = createTmpDir();
    try {
      const state = new IncrementalState();
      const data = { key: 'value' };
      state.update('nr-1', data);
      const path = join(tmpDir, 'incremental.json');
      state.save(path);

      const loaded = IncrementalState.load(path);
      expect(loaded.hasChanged('nr-1', data)).toBe(false);
      expect(loaded.hasChanged('nr-1', { key: 'different' })).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should handle new entity', () => {
    const state = new IncrementalState();
    const data = { name: 'brand new' };
    expect(state.hasChanged('nr-new', data)).toBe(true);
  });
});
