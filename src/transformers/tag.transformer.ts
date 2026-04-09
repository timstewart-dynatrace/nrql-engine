/**
 * Tag Transformer - Converts New Relic entity tags to Dynatrace auto-tag rules.
 *
 * New Relic tags:
 * - Key-value pairs attached to entities
 * - Used for filtering, grouping, alerting
 *
 * Dynatrace auto-tags:
 * - Automatically applied based on rules
 * - Support entity selectors and conditions
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
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
// TagTransformer
// ---------------------------------------------------------------------------

export class TagTransformer {
  /** Entity type mapping for tag rule scopes */
  private static readonly ENTITY_TYPE_MAP: Record<string, string> = {
    APPLICATION: 'SERVICE',
    APM_APPLICATION: 'SERVICE',
    HOST: 'HOST',
    BROWSER_APPLICATION: 'APPLICATION',
    MOBILE_APPLICATION: 'MOBILE_APPLICATION',
    SYNTHETIC_MONITOR: 'SYNTHETIC_TEST',
  };

  transform(nrEntity: NRTagEntityInput): TransformResult<DTAutoTagRule[]> {
    const warnings: string[] = [];

    try {
      const entityName = nrEntity.name ?? 'Unknown Entity';
      const entityType = nrEntity.type ?? 'APPLICATION';
      const tags = nrEntity.tags ?? [];

      const autoTagRules: DTAutoTagRule[] = [];

      for (const tag of tags) {
        const tagKey = tag.key ?? '';
        const tagValues = tag.values ?? [];

        if (!tagKey) {
          warnings.push(
            `Empty tag key found on entity '${entityName}', skipping.`,
          );
          continue;
        }

        for (const tagValue of tagValues) {
          const rule = this.createAutoTagRule(tagKey, tagValue, entityType, entityName);
          autoTagRules.push(rule);
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

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private createAutoTagRule(
    tagKey: string,
    tagValue: string,
    entityType: string,
    entityName: string,
  ): DTAutoTagRule {
    const dtType = TagTransformer.ENTITY_TYPE_MAP[entityType] ?? 'SERVICE';

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
