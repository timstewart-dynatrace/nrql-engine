/**
 * Workload Transformer — Converts New Relic Workloads to Dynatrace
 * Gen3 filter segments (default, best-effort) or classic Management
 * Zones (legacy opt-in).
 *
 * Gen3 Segment (builtin:segment):
 *   - name, description, isPublic
 *   - includes.items[{ dataObject: "_all_entities", filter }] — filter is a
 *     tree of Group/Statement nodes keyed on Smartscape node fields
 *     `type` / `id` / `name` (the form live Gen3 segments use; D14). Each
 *     entity group is `type AND (id OR id …)` / `type AND (name OR name …)`.
 *
 * Workloads do not map 1:1 to Segments (Workloads are entity sets;
 * Segments filter records in Grail pipelines). The default output
 * captures the filter-expressible portion (type / name / tag filters)
 * and raises `TranslationNotes`-style warnings enumerating the manual
 * steps the customer must complete:
 *   - Design a bucket-scoped IAM policy for access control
 *   - Decide which buckets the segment should apply to
 *   - Map Workload health aggregation to a Workflow or dashboard
 *
 * Legacy (Gen2) preserves the Management Zone shape.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input (shared)
// ---------------------------------------------------------------------------

export interface NRWorkloadInput {
  readonly name?: string;
  readonly collection?: NRWorkloadEntity[];
  readonly entitySearchQueries?: Array<{ query?: string }>;
}

export interface NRWorkloadEntity {
  readonly type?: string;
  readonly name?: string;
  /**
   * Entity id. Dynatrace-style ids (e.g. `HOST-0123ABCD`) become `id`
   * statements; NR GUIDs are not Dynatrace ids and fall back to `name`.
   */
  readonly guid?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output — filter segment
// ---------------------------------------------------------------------------

export type DTSegmentFilterNode =
  | {
      readonly type: 'Group';
      readonly logicalOperator: 'AND' | 'OR';
      readonly children: DTSegmentFilterNode[];
    }
  | {
      readonly type: 'Statement';
      readonly key: { readonly value: string };
      readonly operator: { readonly value: '=' | '!=' | 'contains' | 'startsWith' };
      readonly value: { readonly value: string };
    };

export interface DTSegmentInclude {
  readonly dataObject: string;
  readonly filter: DTSegmentFilterNode;
}

export interface DTSegment {
  readonly schemaId: 'builtin:segment';
  readonly name: string;
  readonly description: string;
  readonly isPublic: boolean;
  readonly includes: { readonly items: DTSegmentInclude[] };
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Legacy (Gen2) output — Management Zone
// ---------------------------------------------------------------------------

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
// Shared constants
// ---------------------------------------------------------------------------

const ENTITY_TYPE_MAP: Record<string, string | undefined> = {
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

/**
 * NR entity type -> Smartscape node type for Gen3 segment filters.
 * Synthetic monitors have no available Smartscape node type yet.
 */
const SEGMENT_ENTITY_TYPE_MAP: Record<string, string | undefined> = {
  APPLICATION: 'SERVICE',
  APM_APPLICATION: 'SERVICE',
  BROWSER_APPLICATION: 'FRONTEND',
  MOBILE_APPLICATION: 'FRONTEND',
  HOST: 'HOST',
  INFRASTRUCTURE_HOST: 'HOST',
  SYNTHETIC_MONITOR: undefined,
  WORKLOAD: undefined,
  DASHBOARD: undefined,
};

export const SEGMENT_DATA_OBJECT = '_all_entities';

/** Dynatrace entity ids (e.g. HOST-0123ABCD). NR GUIDs are base64 and never match. */
export const DT_ENTITY_ID_RE = /^[A-Z][A-Z0-9_]*-[0-9A-F]+$/;

function statement(
  key: string,
  op: '=' | '!=' | 'contains' | 'startsWith',
  value: string,
): DTSegmentFilterNode {
  return { type: 'Statement', key: { value: key }, operator: { value: op }, value: { value } };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

const MANUAL_STEPS = [
  'Design a bucket-scoped IAM policy that grants access based on this segment (Gen3 IAM v2 policies).',
  'Confirm which Grail buckets this segment should apply to (default = all; scope down if needed).',
  'If the Workload aggregated health, recreate it via a Davis problem Workflow or a dedicated dashboard — segments do not carry health state.',
];

// ---------------------------------------------------------------------------
// WorkloadTransformer (Gen3 default)
// ---------------------------------------------------------------------------

export class WorkloadTransformer {
  transform(nrWorkload: NRWorkloadInput): TransformResult<DTSegment> {
    const warnings: string[] = [];

    try {
      const workloadName = nrWorkload.name ?? 'Unnamed Workload';
      const collection = nrWorkload.collection ?? [];
      const searchQueries = nrWorkload.entitySearchQueries ?? [];

      const children: DTSegmentFilterNode[] = [
        ...this.collectionGroups(collection, warnings),
        ...this.queryGroups(searchQueries, warnings),
      ];

      if (children.length === 0) {
        const tagValue = slugify(workloadName);
        warnings.push(
          `Workload '${workloadName}' could not be converted to specific filters. A tag-based fallback was emitted; apply tag migrated-workload=${tagValue} to the relevant entities.`,
        );
        children.push(statement('tags.migrated-workload', '=', tagValue));
      }

      warnings.push(...MANUAL_STEPS);

      const segment: DTSegment = {
        schemaId: 'builtin:segment',
        name: `[Migrated] ${workloadName}`,
        description: `Migrated from New Relic Workload: ${workloadName}`,
        isPublic: false,
        includes: {
          items: [
            {
              dataObject: SEGMENT_DATA_OBJECT,
              filter: { type: 'Group', logicalOperator: 'OR', children },
            },
          ],
        },
        manualSteps: MANUAL_STEPS,
      };

      return success(segment, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(workloads: NRWorkloadInput[]): TransformResult<DTSegment>[] {
    return workloads.map((w) => this.transform(w));
  }

  /**
   * Prefer entity-id statements when the collection carries Dynatrace entity
   * ids; otherwise match the exact node name (NR GUIDs are not Dynatrace ids).
   */
  private collectionGroups(
    collection: readonly NRWorkloadEntity[],
    warnings: string[],
  ): DTSegmentFilterNode[] {
    const byTypeIds = new Map<string, string[]>();
    const byTypeNames = new Map<string, string[]>();
    for (const entity of collection) {
      const entityType = entity.type ?? 'UNKNOWN';
      const entityName = entity.name ?? '';
      const guid = entity.guid ?? '';
      const dtType = SEGMENT_ENTITY_TYPE_MAP[entityType];

      if (!dtType) {
        warnings.push(
          `Entity type '${entityType}' for '${entityName}' has no Gen3 segment mapping.`,
        );
        continue;
      }
      if (guid && DT_ENTITY_ID_RE.test(guid)) {
        byTypeIds.set(dtType, [...(byTypeIds.get(dtType) ?? []), guid]);
      } else if (entityName) {
        if (guid) {
          warnings.push(
            `Entity '${entityName}' has an NR GUID, not a Dynatrace entity ID; segment matches it by name.`,
          );
        }
        byTypeNames.set(dtType, [...(byTypeNames.get(dtType) ?? []), entityName]);
      } else {
        warnings.push(
          `Entity of type '${entityType}' has neither a Dynatrace ID nor a name; skipped.`,
        );
      }
    }

    const groups: DTSegmentFilterNode[] = [];
    const group = (dtType: string, key: 'id' | 'name', values: string[]): DTSegmentFilterNode => ({
      // D14: type AND (value OR value ...) — OR matched every node of the type.
      type: 'Group',
      logicalOperator: 'AND',
      children: [
        statement('type', '=', dtType),
        {
          type: 'Group',
          logicalOperator: 'OR',
          children: values.map((v) => statement(key, '=', v)),
        },
      ],
    });
    for (const [dtType, ids] of byTypeIds) groups.push(group(dtType, 'id', ids));
    for (const [dtType, names] of byTypeNames) groups.push(group(dtType, 'name', names));
    return groups;
  }

  private queryGroups(
    queries: ReadonlyArray<{ query?: string }>,
    warnings: string[],
  ): DTSegmentFilterNode[] {
    const groups: DTSegmentFilterNode[] = [];
    for (const queryObj of queries) {
      const query = queryObj.query ?? '';
      const parsed = parseEntityQuery(query);
      const dtType = parsed.entityType ? SEGMENT_ENTITY_TYPE_MAP[parsed.entityType] : undefined;
      if (!dtType) {
        warnings.push(
          `Could not map entity search query to a Gen3 segment filter: '${query.slice(0, 100)}'`,
        );
        continue;
      }
      const children: DTSegmentFilterNode[] = [statement('type', '=', dtType)];
      if (parsed.nameFilter) children.push(statement('name', 'contains', parsed.nameFilter));
      for (const [tagKey, tagValue] of parsed.tags) {
        children.push(statement(`tags.${tagKey}`, '=', tagValue));
      }
      groups.push({ type: 'Group', logicalOperator: 'AND', children });
    }
    return groups;
  }
}

// ---------------------------------------------------------------------------
// LegacyWorkloadTransformer (Gen2 opt-in)
// ---------------------------------------------------------------------------

export class LegacyWorkloadTransformer {
  transform(nrWorkload: NRWorkloadInput): TransformResult<DTManagementZone> {
    const warnings: string[] = [
      'Emitting Gen2 Management Zone (legacy). Default output is a Gen3 builtin:segment — use WorkloadTransformer unless legacy parity is required.',
    ];

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
          `Workload '${workloadName}' could not be converted to specific rules. A tag-based rule has been created. Apply the tag to relevant entities.`,
        );
        rules.push(this.createTagRule(workloadName));
      }

      return success(
        {
          name: `[Migrated] ${workloadName}`,
          description: `Migrated from New Relic Workload: ${workloadName}`,
          rules,
        },
        warnings,
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(workloads: NRWorkloadInput[]): TransformResult<DTManagementZone>[] {
    return workloads.map((w) => this.transform(w));
  }

  private convertCollectionToRules(
    collection: readonly NRWorkloadEntity[],
    warnings: string[],
  ): DTManagementZoneRule[] {
    const rules: DTManagementZoneRule[] = [];
    const entitiesByType: Map<string, string[]> = new Map();

    for (const entity of collection) {
      const entityType = entity.type ?? 'UNKNOWN';
      const entityName = entity.name ?? '';
      const dtType = ENTITY_TYPE_MAP[entityType];

      if (dtType) {
        if (!entitiesByType.has(dtType)) entitiesByType.set(dtType, []);
        entitiesByType.get(dtType)!.push(entityName);
      } else {
        warnings.push(
          `Entity type '${entityType}' for '${entityName}' does not have a direct Dynatrace equivalent`,
        );
      }
    }

    for (const [dtType, entityNames] of entitiesByType) {
      if (entityNames.length > 10) {
        warnings.push(
          `Workload contains ${entityNames.length} ${dtType} entities. Consider using tags for better management. Creating name-based rules.`,
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
      const parsed = parseEntityQuery(query);

      if (parsed.entityType) {
        const dtType = ENTITY_TYPE_MAP[parsed.entityType];
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
          `Could not parse query: ${query.slice(0, 100)}... Manual rule creation may be required.`,
        );
      }
    }
    return rules;
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

  // Exposed for tests that exercise helpers directly.
  parseEntityQuery(query: string): ReturnType<typeof parseEntityQuery> {
    return parseEntityQuery(query);
  }
}

// ---------------------------------------------------------------------------
// Query parser shared by both transformers
// ---------------------------------------------------------------------------

function parseEntityQuery(
  query: string,
): { entityType: string | undefined; nameFilter: string | undefined; tags: [string, string][] } {
  const result: {
    entityType: string | undefined;
    nameFilter: string | undefined;
    tags: [string, string][];
  } = { entityType: undefined, nameFilter: undefined, tags: [] };

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
