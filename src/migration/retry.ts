/**
 * Partial retry — save and reload failed entities for re-import.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

const logger = pino({ name: 'migration-retry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FailedEntry {
  readonly entityType: string;
  readonly name: string;
  readonly error: string;
}

// ---------------------------------------------------------------------------
// FailedEntities
// ---------------------------------------------------------------------------

/** Tracks entities that failed during import for later retry. */
export class FailedEntities {
  private entries: FailedEntry[];

  constructor() {
    this.entries = [];
  }

  /** Record a failed entity. */
  add(entityType: string, name: string, error: string): void {
    this.entries.push({ entityType, name, error });
    logger.warn({ entityType, name, error }, 'entity_failed');
  }

  /** Write failed entities to a JSON file. */
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.entries, null, 2), 'utf-8');
    logger.info({ path, count: this.entries.length }, 'failed_entities_saved');
  }

  /** Load failed entities from a previously saved JSON file. */
  static load(path: string): FailedEntities {
    const instance = new FailedEntities();
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as FailedEntry[];
    instance.entries = data;
    logger.info({ path, count: data.length }, 'failed_entities_loaded');
    return instance;
  }

  /** Return names of failed entities filtered by type. */
  getFailedNames(entityType: string): string[] {
    return this.entries
      .filter((entry) => entry.entityType === entityType)
      .map((entry) => entry.name);
  }

  /**
   * Return only items from transformedData that match failed names.
   *
   * @param transformedData - Dict containing a list of entities under entityTypeKey.
   * @param entityTypeKey - Key in transformedData whose value is a list of entities.
   * @param nameKey - Key within each entity dict that holds the entity name.
   * @returns List of entity dicts whose name matches a failed entry for that type.
   */
  filterTransformedData(
    transformedData: Record<string, unknown>,
    entityTypeKey: string,
    nameKey: string,
  ): Record<string, unknown>[] {
    const failedNames = new Set(this.getFailedNames(entityTypeKey));
    const items = transformedData[entityTypeKey];
    if (!Array.isArray(items)) return [];
    return items.filter((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      const rec = item as Record<string, unknown>;
      const name = rec[nameKey];
      return typeof name === 'string' && failedNames.has(name);
    }) as Record<string, unknown>[];
  }

  /** Return true if no failures have been recorded. */
  isEmpty(): boolean {
    return this.entries.length === 0;
  }
}
