/**
 * Diff/preview — compare transformed entities against live DT environment.
 */

import pino from 'pino';

const logger = pino({ name: 'migration-diff' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single diff result for one entity. */
export interface DiffEntry {
  readonly entityType: string;
  readonly name: string;
  readonly action: 'CREATE' | 'UPDATE' | 'CONFLICT';
  readonly reason: string;
  readonly dtId?: string;
}

/**
 * Registry interface for diff generation.
 * Matches the subset of DTEnvironmentRegistry used by generateDiff.
 */
interface DiffRegistry {
  dashboardExists(name: string): Promise<string | undefined>;
  findManagementZone(name: string): Promise<{ id: string } | undefined>;
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
    action: 'CREATE' | 'UPDATE' | 'CONFLICT',
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

    return report;
  }

  /** Return counts by action type. */
  summary(): { creates: number; updates: number; conflicts: number } {
    let creates = 0;
    let updates = 0;
    let conflicts = 0;
    for (const e of this.entries) {
      if (e.action === 'CREATE') creates++;
      else if (e.action === 'UPDATE') updates++;
      else if (e.action === 'CONFLICT') conflicts++;
    }
    return { creates, updates, conflicts };
  }

  /** Return all entries with CREATE action. */
  getCreates(): DiffEntry[] {
    return this.entries.filter((e) => e.action === 'CREATE');
  }

  /** Return all entries with UPDATE action. */
  getUpdates(): DiffEntry[] {
    return this.entries.filter((e) => e.action === 'UPDATE');
  }
}
