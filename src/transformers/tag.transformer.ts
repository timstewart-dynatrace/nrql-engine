/**
 * Tag Transformer — Converts New Relic entity tags to Dynatrace Gen3
 * OpenPipeline enrichment rules (default) or classic Auto-Tag Rules (legacy).
 *
 * Gen3: OpenPipeline enrichment stage on the applicable pipeline
 * (logs / spans / bizevents / metrics) adds a key/value field when the
 * entity is matched. Rules are expressed as DPL `matchesValue` conditions
 * against the entity name.
 *
 * Legacy (Gen2): `builtin:tags.auto-tagging` auto-tag rules with
 * ENTITY_NAME conditions. Preserved for opt-in parity.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input interfaces (shared)
// ---------------------------------------------------------------------------

export interface NRTagEntityInput {
  readonly name?: string;
  readonly type?: string;
  readonly tags?: NRTag[];
}

export interface NRTag {
  readonly key?: string;
  readonly values?: string[];
}

// ---------------------------------------------------------------------------
// Gen3 output: OpenPipeline enrichment rule
// ---------------------------------------------------------------------------

/**
 * A Gen3 OpenPipeline enrichment rule that adds a tag field to matching
 * records. Bound to a pipeline (`logs`, `spans`, `bizevents`, `metrics`)
 * via `schemaId`. The `matcher` is a DPL expression; `fieldsAdd` describes
 * the enrichment to apply.
 */
export interface DTOpenPipelineEnrichmentRule {
  schemaId: 'builtin:openpipeline.logs.pipelines';
  displayName: string;
  description: string;
  pipelines: Array<'logs' | 'spans' | 'bizevents' | 'metrics'>;
  matcher: string;
  fieldsAdd: Array<{ field: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Legacy (Gen2) output: classic Auto-Tag Rule
// ---------------------------------------------------------------------------

export interface DTAutoTagRule {
  name: string;
  description: string;
  rules: Array<{
    type: string;
    enabled: boolean;
    valueFormat: string;
    conditions: Array<{
      key: { attribute: string };
      comparisonInfo: {
        type: string;
        operator: string;
        value: string;
      };
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Shared entity-type mapping
// ---------------------------------------------------------------------------

const ENTITY_TYPE_MAP: Record<string, string> = {
  APPLICATION: 'SERVICE',
  APM_APPLICATION: 'SERVICE',
  HOST: 'HOST',
  BROWSER_APPLICATION: 'APPLICATION',
  MOBILE_APPLICATION: 'MOBILE_APPLICATION',
  SYNTHETIC_MONITOR: 'SYNTHETIC_TEST',
};

const ENTITY_TYPE_TO_PIPELINES: Record<string, Array<'logs' | 'spans' | 'bizevents' | 'metrics'>> = {
  APPLICATION: ['spans', 'logs'],
  APM_APPLICATION: ['spans', 'logs'],
  HOST: ['logs', 'metrics'],
  BROWSER_APPLICATION: ['bizevents'],
  MOBILE_APPLICATION: ['bizevents'],
  SYNTHETIC_MONITOR: ['bizevents'],
};

const ENTITY_TYPE_TO_MATCH_FIELD: Record<string, string> = {
  APPLICATION: 'service.name',
  APM_APPLICATION: 'service.name',
  HOST: 'host.name',
  BROWSER_APPLICATION: 'application.name',
  MOBILE_APPLICATION: 'application.name',
  SYNTHETIC_MONITOR: 'synthetic.name',
};

// ---------------------------------------------------------------------------
// TagTransformer (Gen3 default)
// ---------------------------------------------------------------------------

export class TagTransformer {
  transform(nrEntity: NRTagEntityInput): TransformResult<DTOpenPipelineEnrichmentRule[]> {
    const warnings: string[] = [];

    try {
      const entityName = nrEntity.name ?? 'Unknown Entity';
      const entityType = nrEntity.type ?? 'APPLICATION';
      const tags = nrEntity.tags ?? [];
      const pipelines = ENTITY_TYPE_TO_PIPELINES[entityType] ?? ['logs'];
      const matchField = ENTITY_TYPE_TO_MATCH_FIELD[entityType] ?? 'entity.name';

      const rules: DTOpenPipelineEnrichmentRule[] = [];

      for (const tag of tags) {
        const tagKey = tag.key ?? '';
        const tagValues = tag.values ?? [];

        if (!tagKey) {
          warnings.push(`Empty tag key found on entity '${entityName}', skipping.`);
          continue;
        }

        for (const tagValue of tagValues) {
          rules.push({
            schemaId: 'builtin:openpipeline.logs.pipelines',
            displayName: `[Migrated] ${tagKey}=${tagValue}`,
            description: `Migrated from NR tag: ${tagKey}=${tagValue} on ${entityName}`,
            pipelines,
            matcher: `matchesValue(${matchField}, "${entityName}")`,
            fieldsAdd: [{ field: tagKey, value: tagValue }],
          });
        }
      }

      return success(rules, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    entities: NRTagEntityInput[],
  ): TransformResult<DTOpenPipelineEnrichmentRule[]>[] {
    return entities.map((e) => this.transform(e));
  }
}

// ---------------------------------------------------------------------------
// LegacyTagTransformer (Gen2 opt-in)
// ---------------------------------------------------------------------------

export class LegacyTagTransformer {
  transform(nrEntity: NRTagEntityInput): TransformResult<DTAutoTagRule[]> {
    const warnings: string[] = [
      'Emitting Gen2 Auto-Tag Rule (legacy). Default output is Gen3 OpenPipeline enrichment — use TagTransformer unless legacy parity is required.',
    ];

    try {
      const entityName = nrEntity.name ?? 'Unknown Entity';
      const entityType = nrEntity.type ?? 'APPLICATION';
      const tags = nrEntity.tags ?? [];

      const autoTagRules: DTAutoTagRule[] = [];

      for (const tag of tags) {
        const tagKey = tag.key ?? '';
        const tagValues = tag.values ?? [];

        if (!tagKey) {
          warnings.push(`Empty tag key found on entity '${entityName}', skipping.`);
          continue;
        }

        for (const tagValue of tagValues) {
          autoTagRules.push(this.createAutoTagRule(tagKey, tagValue, entityType, entityName));
        }
      }

      return success(autoTagRules, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(entities: NRTagEntityInput[]): TransformResult<DTAutoTagRule[]>[] {
    return entities.map((e) => this.transform(e));
  }

  private createAutoTagRule(
    tagKey: string,
    tagValue: string,
    entityType: string,
    entityName: string,
  ): DTAutoTagRule {
    const dtType = ENTITY_TYPE_MAP[entityType] ?? 'SERVICE';

    return {
      name: `[Migrated] ${tagKey}`,
      description: `Migrated from NR tag: ${tagKey}=${tagValue}`,
      rules: [
        {
          type: dtType,
          enabled: true,
          valueFormat: tagValue,
          conditions: [
            {
              key: { attribute: 'ENTITY_NAME' },
              comparisonInfo: {
                type: 'STRING',
                operator: 'CONTAINS',
                value: entityName,
              },
            },
          ],
        },
      ],
    };
  }
}
