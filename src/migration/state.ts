/**
 * Migration state management — rollback, ID mapping, checkpointing, incremental.
 *
 * Provides persistent state classes that serialize to/from JSON files
 * for resumable, rollback-capable migrations.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

const logger = pino({ name: 'migration-state' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RollbackEntry {
  readonly entityType: string;
  readonly dynatraceId: string;
  readonly name: string;
  readonly timestamp: string;
}

interface EntityIdEntry {
  readonly dtId: string;
  readonly entityType: string;
}

// ---------------------------------------------------------------------------
// RollbackManifest
// ---------------------------------------------------------------------------

/** Tracks created Dynatrace entities for rollback support. */
export class RollbackManifest {
  private entries: RollbackEntry[];

  constructor(entries: RollbackEntry[] = []) {
    this.entries = [...entries];
  }

  /** Append an entry with current UTC timestamp. */
  add(entityType: string, dynatraceId: string, name: string): void {
    const entry: RollbackEntry = {
      entityType,
      dynatraceId,
      name,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    logger.info({ entityType, dynatraceId, name }, 'rollback_entry_added');
  }

  /** Write manifest to JSON file. */
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ entries: this.entries }, null, 2), 'utf-8');
    logger.info({ path, count: this.entries.length }, 'rollback_manifest_saved');
  }

  /** Read manifest from JSON file. */
  static load(path: string): RollbackManifest {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as { entries?: unknown[] };
    const entries = Array.isArray(data.entries)
      ? (data.entries as RollbackEntry[])
      : [];
    const manifest = new RollbackManifest(entries);
    logger.info({ path, count: manifest.entries.length }, 'rollback_manifest_loaded');
    return manifest;
  }

  /** Return all rollback entries. */
  getEntries(): readonly RollbackEntry[] {
    return [...this.entries];
  }
}

// ---------------------------------------------------------------------------
// EntityIdMap
// ---------------------------------------------------------------------------

/** Maps New Relic entity GUIDs to Dynatrace entity IDs. */
export class EntityIdMap {
  private readonly map: Map<string, EntityIdEntry>;

  constructor(data?: Record<string, EntityIdEntry>) {
    this.map = new Map();
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        this.map.set(key, value);
      }
    }
  }

  /** Register a mapping from New Relic ID to Dynatrace ID. */
  register(nrId: string, dtId: string, entityType: string): void {
    this.map.set(nrId, { dtId, entityType });
    logger.info({ nrId, dtId, entityType }, 'entity_id_registered');
  }

  /** Return the Dynatrace ID for a given New Relic ID, or undefined. */
  resolve(nrId: string): string | undefined {
    const entry = this.map.get(nrId);
    return entry?.dtId;
  }

  /** Write ID map to JSON file. */
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const obj: Record<string, EntityIdEntry> = {};
    for (const [key, value] of this.map) {
      obj[key] = value;
    }
    writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
    logger.info({ path, count: this.map.size }, 'entity_id_map_saved');
  }

  /** Read ID map from JSON file. */
  static load(path: string): EntityIdMap {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, EntityIdEntry>;
    const idMap = new EntityIdMap(data);
    logger.info({ path, count: idMap.map.size }, 'entity_id_map_loaded');
    return idMap;
  }
}

// ---------------------------------------------------------------------------
// MigrationCheckpoint
// ---------------------------------------------------------------------------

/** Tracks per-component migration progress for resumable runs. */
export class MigrationCheckpoint {
  private readonly completed: Map<string, number>;

  constructor(data?: Record<string, number>) {
    this.completed = new Map();
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        this.completed.set(key, value);
      }
    }
  }

  /** Mark a component as having completed through the given index. */
  markComplete(component: string, index: number): void {
    this.completed.set(component, index);
    logger.debug({ component, index }, 'checkpoint_marked');
  }

  /** Check if all items for a component have been processed. */
  isComplete(component: string, total: number): boolean {
    return (this.completed.get(component) ?? -1) >= total - 1;
  }

  /** Return the next index to process (0 if not started). */
  getResumeIndex(component: string): number {
    const idx = this.completed.get(component);
    if (idx === undefined) return 0;
    return idx + 1;
  }

  /** Write checkpoint to JSON file. */
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const obj: Record<string, number> = {};
    for (const [key, value] of this.completed) {
      obj[key] = value;
    }
    writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
    logger.info({ path }, 'checkpoint_saved');
  }

  /** Read checkpoint from JSON file. */
  static load(path: string): MigrationCheckpoint {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, number>;
    const checkpoint = new MigrationCheckpoint(data);
    logger.info({ path }, 'checkpoint_loaded');
    return checkpoint;
  }
}

// ---------------------------------------------------------------------------
// IncrementalState
// ---------------------------------------------------------------------------

/** Tracks content hashes for incremental migration (skip unchanged entities). */
export class IncrementalState {
  private readonly hashes: Map<string, string>;

  constructor(data?: Record<string, string>) {
    this.hashes = new Map();
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        this.hashes.set(key, value);
      }
    }
  }

  /** Compute a stable hash of entity data using sorted JSON. */
  private static computeHash(data: Record<string, unknown>): string {
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return createHash('sha256').update(serialized, 'utf-8').digest('hex');
  }

  /** Check if entity data has changed since the last recorded hash. */
  hasChanged(nrGuid: string, entityData: Record<string, unknown>): boolean {
    const currentHash = IncrementalState.computeHash(entityData);
    const storedHash = this.hashes.get(nrGuid);
    return storedHash !== currentHash;
  }

  /** Store the current hash for an entity. */
  update(nrGuid: string, entityData: Record<string, unknown>): void {
    this.hashes.set(nrGuid, IncrementalState.computeHash(entityData));
  }

  /** Write hashes to JSON file. */
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const obj: Record<string, string> = {};
    for (const [key, value] of this.hashes) {
      obj[key] = value;
    }
    writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
    logger.info({ path, count: this.hashes.size }, 'incremental_state_saved');
  }

  /** Read hashes from JSON file. */
  static load(path: string): IncrementalState {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, string>;
    const state = new IncrementalState(data);
    logger.info({ path, count: state.hashes.size }, 'incremental_state_loaded');
    return state;
  }
}
