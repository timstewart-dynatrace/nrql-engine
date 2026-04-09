/**
 * Migration module — state management, retry, and diff/preview.
 *
 * Provides persistent state classes for resumable, rollback-capable migrations:
 * - RollbackManifest: tracks created entities for undo
 * - EntityIdMap: maps NR GUIDs to DT entity IDs
 * - MigrationCheckpoint: per-component progress for resume
 * - IncrementalState: content hashing for skip-unchanged
 * - FailedEntities: partial retry support
 * - DiffReport: preview creates vs updates before import
 */

export {
  RollbackManifest,
  EntityIdMap,
  MigrationCheckpoint,
  IncrementalState,
} from './state.js';

export { FailedEntities } from './retry.js';

export { DiffReport } from './diff.js';
export type { DiffEntry } from './diff.js';
