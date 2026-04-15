/**
 * Diff/preview — compare transformed entities against live DT environment.
 */

import pino from 'pino';

import { looksMigrated } from '../utils/provenance.js';

const logger = pino({ name: 'migration-diff' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single diff result for one entity. */
export interface DiffEntry {
  readonly entityType: string;
  readonly name: string;
  readonly action: 'CREATE' | 'UPDATE' | 'CONFLICT' | 'ORPHAN';
  readonly reason: string;
  readonly dtId?: string;
}

/**
 * Registry interface for diff generation.
 * Matches the subset of DTEnvironmentRegistry used by generateDiff.
 *
 * The optional `listDashboards` / `listManagementZones` callbacks enable
 * ORPHAN detection — DT entities present in the tenant but absent from
 * the transformed set. When supplied, `generateDiff()` walks the DT
 * snapshot and calls `looksMigrated()` to surface rogue migrated
 * entities from prior runs.
 */
interface DiffRegistry {
  dashboardExists(name: string): Promise<string | undefined>;
  findManagementZone(name: string): Promise<{ id: string } | undefined>;
  /** Optional: enumerate all dashboards for ORPHAN detection (P15-03). */
  listDashboards?(): Promise<Array<{ id: string; name: string; payload?: Record<string, unknown> }>>;
  /** Optional: enumerate all management zones for ORPHAN detection (P15-03). */
  listManagementZones?(): Promise<Array<{ id: string; name: string; payload?: Record<string, unknown> }>>;
}

// ---------------------------------------------------------------------------
// DiffReport
// ---------------------------------------------------------------------------

/** Compares transformed entities against a live Dynatrace environment. */
export class DiffReport {
  readonly entries: DiffEntry[];

  constructor() {
    this.entries = [];
  }

  /** Add a diff entry. */
  add(
    entityType: string,
    name: string,
    action: 'CREATE' | 'UPDATE' | 'CONFLICT' | 'ORPHAN',
    reason: string,
    dtId?: string,
  ): void {
    const entry: DiffEntry = { entityType, name, action, reason, dtId };
    this.entries.push(entry);
    logger.info({ entityType, name, action, reason }, 'diff_entry');
  }

  /**
   * Generate a diff report by comparing transformed data against a registry.
   *
   * For dashboards and management_zones, checks for existing entities via the
   * registry. For other entity types (alerting_profiles, metric_events, slos,
   * monitors), defaults to CREATE since no registry lookup is available yet.
   *
   * @param transformedData - Dict with entity type keys mapping to lists of entities.
   * @param registry - Object with dashboardExists(name) and findManagementZone(name).
   * @returns A populated DiffReport.
   */
  static async generateDiff(
    transformedData: Record<string, unknown>,
    registry: DiffRegistry,
  ): Promise<DiffReport> {
    const report = new DiffReport();

    // Dashboards -- check registry
    const dashboards = transformedData['dashboards'];
    if (Array.isArray(dashboards)) {
      for (const dashboard of dashboards) {
        if (typeof dashboard !== 'object' || dashboard === null) continue;
        const name = String((dashboard as Record<string, unknown>)['name'] ?? '');
        const dtId = await registry.dashboardExists(name);
        if (dtId === undefined) {
          report.add('dashboard', name, 'CREATE', 'Not found in DT');
        } else {
          report.add('dashboard', name, 'UPDATE', 'Name match found', dtId);
        }
      }
    }

    // Management zones -- check registry
    const managementZones = transformedData['management_zones'];
    if (Array.isArray(managementZones)) {
      for (const mz of managementZones) {
        if (typeof mz !== 'object' || mz === null) continue;
        const name = String((mz as Record<string, unknown>)['name'] ?? '');
        const found = await registry.findManagementZone(name);
        if (found === undefined) {
          report.add('management_zone', name, 'CREATE', 'Not found in DT');
        } else {
          report.add('management_zone', name, 'UPDATE', 'Name match found', found.id);
        }
      }
    }

    // Entity types without registry lookup -- always CREATE
    for (const entityType of ['alerting_profiles', 'metric_events', 'slos', 'monitors']) {
      const entities = transformedData[entityType];
      if (Array.isArray(entities)) {
        for (const entity of entities) {
          if (typeof entity !== 'object' || entity === null) continue;
          const name = String((entity as Record<string, unknown>)['name'] ?? '');
          report.add(entityType, name, 'CREATE', 'No registry lookup available');
        }
      }
    }

    // ─── ORPHAN detection (P15-03) ────────────────────────────────────
    // For each entity kind where the registry can enumerate DT-side
    // inventory, look for entities that aren't in the transformed set
    // but look migrated (prior-run residue or operator copies).
    if (registry.listDashboards) {
      const transformedNames = new Set(
        (Array.isArray(transformedData['dashboards'])
          ? (transformedData['dashboards'] as Array<Record<string, unknown>>)
          : []
        ).map((d) => String(d['name'] ?? '')),
      );
      for (const dt of await registry.listDashboards()) {
        if (transformedNames.has(dt.name)) continue;
        if (!dt.payload || looksMigrated(dt.payload)) {
          report.add(
            'dashboard',
            dt.name,
            'ORPHAN',
            'Present in DT, not in transformed set (looks migrated)',
            dt.id,
          );
        }
      }
    }
    if (registry.listManagementZones) {
      const transformedNames = new Set(
        (Array.isArray(transformedData['management_zones'])
          ? (transformedData['management_zones'] as Array<Record<string, unknown>>)
          : []
        ).map((d) => String(d['name'] ?? '')),
      );
      for (const dt of await registry.listManagementZones()) {
        if (transformedNames.has(dt.name)) continue;
        if (!dt.payload || looksMigrated(dt.payload)) {
          report.add(
            'management_zone',
            dt.name,
            'ORPHAN',
            'Present in DT, not in transformed set (looks migrated)',
            dt.id,
          );
        }
      }
    }

    return report;
  }

  /** Return counts by action type. */
  summary(): {
    creates: number;
    updates: number;
    conflicts: number;
    orphans: number;
  } {
    let creates = 0;
    let updates = 0;
    let conflicts = 0;
    let orphans = 0;
    for (const e of this.entries) {
      if (e.action === 'CREATE') creates++;
      else if (e.action === 'UPDATE') updates++;
      else if (e.action === 'CONFLICT') conflicts++;
      else if (e.action === 'ORPHAN') orphans++;
    }
    return { creates, updates, conflicts, orphans };
  }

  /** Return all entries with CREATE action. */
  getCreates(): DiffEntry[] {
    return this.entries.filter((e) => e.action === 'CREATE');
  }

  /** Return all entries with UPDATE action. */
  getUpdates(): DiffEntry[] {
    return this.entries.filter((e) => e.action === 'UPDATE');
  }

  /** Return all entries with ORPHAN action (P15-03). */
  getOrphans(): DiffEntry[] {
    return this.entries.filter((e) => e.action === 'ORPHAN');
  }
}
