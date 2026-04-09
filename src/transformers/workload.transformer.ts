/**
 * Workload Transformer - Converts New Relic Workloads to Dynatrace Management Zones.
 *
 * New Relic Workloads:
 * - Group entities for collective monitoring
 * - Can use entity GUIDs or search queries
 * - Support health status aggregation
 *
 * Dynatrace Management Zones:
 * - Group entities using rules
 * - Support dimension filters, entity selectors
 * - Used for access control and dashboards
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRWorkloadInput {
  readonly name?: string;
  readonly collection?: NRWorkloadEntity[];
  readonly entitySearchQueries?: Array<{ query?: string }>;
}

export interface NRWorkloadEntity {
  readonly type?: string;
  readonly name?: string;
}

export interface DTManagementZone {
  name: string;
  description: string;
  rules: DTManagementZoneRule[];
}

export interface DTManagementZoneRule {
  type: string;
  enabled: boolean;
  entitySelector: string;
}

// ---------------------------------------------------------------------------
// WorkloadTransformer
// ---------------------------------------------------------------------------

export class WorkloadTransformer {
  /** Entity type mapping from New Relic to Dynatrace */
  private static readonly ENTITY_TYPE_MAP: Record<string, string | undefined> = {
    APPLICATION: 'SERVICE',
    APM_APPLICATION: 'SERVICE',
    BROWSER_APPLICATION: 'APPLICATION',
    MOBILE_APPLICATION: 'MOBILE_APPLICATION',
    HOST: 'HOST',
    INFRASTRUCTURE_HOST: 'HOST',
    SYNTHETIC_MONITOR: 'SYNTHETIC_TEST',
    WORKLOAD: undefined,
    DASHBOARD: undefined,
  };

  transform(nrWorkload: NRWorkloadInput): TransformResult<DTManagementZone> {
    const warnings: string[] = [];

    try {
      const workloadName = nrWorkload.name ?? 'Unnamed Workload';

      const collection = nrWorkload.collection ?? [];
      const entitySearchQueries = nrWorkload.entitySearchQueries ?? [];

      const rules: DTManagementZoneRule[] = [];

      if (collection.length > 0) {
        rules.push(...this.convertCollectionToRules(collection, warnings));
      }

      if (entitySearchQueries.length > 0) {
        rules.push(...this.convertQueriesToRules(entitySearchQueries, warnings));
      }

      if (rules.length === 0) {
        warnings.push(
          `Workload '${workloadName}' could not be converted to specific rules. ` +
            'A tag-based rule has been created. Apply the tag to relevant entities.',
        );
        rules.push(this.createTagRule(workloadName));
      }

      const dtManagementZone: DTManagementZone = {
        name: `[Migrated] ${workloadName}`,
        description: `Migrated from New Relic Workload: ${workloadName}`,
        rules,
      };

      return success(dtManagementZone, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(workloads: NRWorkloadInput[]): TransformResult<DTManagementZone>[] {
    return workloads.map((w) => this.transform(w));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private convertCollectionToRules(
    collection: readonly NRWorkloadEntity[],
    warnings: string[],
  ): DTManagementZoneRule[] {
    const rules: DTManagementZoneRule[] = [];
    const entitiesByType: Map<string, string[]> = new Map();

    for (const entity of collection) {
      const entityType = entity.type ?? 'UNKNOWN';
      const entityName = entity.name ?? '';

      const dtType = WorkloadTransformer.ENTITY_TYPE_MAP[entityType];
      if (dtType) {
        if (!entitiesByType.has(dtType)) {
          entitiesByType.set(dtType, []);
        }
        entitiesByType.get(dtType)!.push(entityName);
      } else {
        warnings.push(
          `Entity type '${entityType}' for '${entityName}' ` +
            'does not have a direct Dynatrace equivalent',
        );
      }
    }

    for (const [dtType, entityNames] of entitiesByType) {
      if (entityNames.length > 10) {
        warnings.push(
          `Workload contains ${entityNames.length} ${dtType} entities. ` +
            'Consider using tags for better management. Creating name-based rules.',
        );
      }

      for (const name of entityNames) {
        rules.push(this.createNameRule(dtType, name));
      }
    }

    return rules;
  }

  private convertQueriesToRules(
    queries: ReadonlyArray<{ query?: string }>,
    warnings: string[],
  ): DTManagementZoneRule[] {
    const rules: DTManagementZoneRule[] = [];

    for (const queryObj of queries) {
      const query = queryObj.query ?? '';
      const parsed = this.parseEntityQuery(query);

      if (parsed.entityType) {
        const dtType = WorkloadTransformer.ENTITY_TYPE_MAP[parsed.entityType];
        if (dtType) {
          let entitySelector = `type("${dtType}")`;

          if (parsed.nameFilter) {
            entitySelector += `,entityName.contains("${parsed.nameFilter}")`;
          }

          for (const [tagKey, tagValue] of parsed.tags) {
            entitySelector += `,tag("${tagKey}:${tagValue}")`;
          }

          rules.push({ type: 'ME', enabled: true, entitySelector });
        } else {
          warnings.push(
            `Query entity type '${parsed.entityType}' could not be mapped to Dynatrace`,
          );
        }
      } else {
        warnings.push(
          `Could not parse query: ${query.slice(0, 100)}... ` +
            'Manual rule creation may be required.',
        );
      }
    }

    return rules;
  }

  private parseEntityQuery(
    query: string,
  ): { entityType: string | undefined; nameFilter: string | undefined; tags: [string, string][] } {
    const result: {
      entityType: string | undefined;
      nameFilter: string | undefined;
      tags: [string, string][];
    } = {
      entityType: undefined,
      nameFilter: undefined,
      tags: [],
    };

    const queryLower = query.toLowerCase();

    if (queryLower.includes('type')) {
      const typePatterns: [string, string][] = [
        ['application', 'APPLICATION'],
        ['host', 'HOST'],
        ['service', 'APM_APPLICATION'],
        ['browser', 'BROWSER_APPLICATION'],
        ['mobile', 'MOBILE_APPLICATION'],
        ['synthetic', 'SYNTHETIC_MONITOR'],
      ];

      for (const [pattern, entityType] of typePatterns) {
        if (queryLower.includes(pattern)) {
          result.entityType = entityType;
          break;
        }
      }
    }

    if (queryLower.includes('name')) {
      const nameMatch = /name\s+like\s+'([^']+)'/i.exec(query);
      if (nameMatch && nameMatch[1]) {
        result.nameFilter = nameMatch[1].replace(/%/g, '');
      }
    }

    if (queryLower.includes('tags.')) {
      const tagRegex = /tags\.(\w+)\s*=\s*'([^']+)'/gi;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(query)) !== null) {
        if (match[1] && match[2]) {
          result.tags.push([match[1], match[2]]);
        }
      }
    }

    return result;
  }

  private createNameRule(entityType: string, name: string): DTManagementZoneRule {
    return {
      type: 'ME',
      enabled: true,
      entitySelector: `type("${entityType}"),entityName.equals("${name}")`,
    };
  }

  private createTagRule(workloadName: string): DTManagementZoneRule {
    let tagValue = workloadName.toLowerCase().replace(/ /g, '-');
    tagValue = tagValue.replace(/[^a-z0-9-]/g, '');

    return {
      type: 'ME',
      enabled: true,
      entitySelector: `tag("migrated-workload:${tagValue}")`,
    };
  }
}
