/**
 * Drop Rule Transformer - Converts New Relic drop rules to Dynatrace ingest rules.
 *
 * New Relic drop rules:
 * - Drop data at ingest to reduce costs
 * - Based on NRQL WHERE conditions
 * - Can target specific event types
 *
 * Dynatrace equivalents:
 * - Log/metric ingest rules
 * - Data filtering at ingest pipeline
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRDropRuleInput {
  readonly name?: string;
  readonly nrqlCondition?: string;
  readonly action?: string;
  readonly enabled?: boolean;
  readonly attributes?: string[];
}

export interface DTIngestRule {
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  condition: string;
  attributes?: string[];
}

// ---------------------------------------------------------------------------
// DropRuleTransformer
// ---------------------------------------------------------------------------

export class DropRuleTransformer {
  transform(nrRule: NRDropRuleInput): TransformResult<DTIngestRule[]> {
    const warnings: string[] = [];

    try {
      const ruleName = nrRule.name ?? 'Unnamed Drop Rule';
      const nrqlCondition = nrRule.nrqlCondition ?? '';
      const action = nrRule.action ?? 'drop_data';
      const enabled = nrRule.enabled ?? true;

      const ingestRule: DTIngestRule = {
        name: `[Migrated] ${ruleName}`,
        description: `Migrated from NR drop rule: ${ruleName}`,
        type: 'DROP',
        enabled,
        condition: this.convertCondition(nrqlCondition, warnings),
      };

      if (action === 'drop_attributes') {
        const attributes = nrRule.attributes ?? [];
        ingestRule.type = 'MASK';
        ingestRule.attributes = attributes;
        warnings.push(
          `Drop rule '${ruleName}' uses attribute dropping. ` +
            'Mapped to MASK rule; verify attribute names in Dynatrace.',
        );
      }

      return success([ingestRule], warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(rules: NRDropRuleInput[]): TransformResult<DTIngestRule[]>[] {
    return rules.map((r) => this.transform(r));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private convertCondition(nrqlCondition: string, warnings: string[]): string {
    if (!nrqlCondition) {
      return 'matchesValue(content, "*")';
    }

    let condition = nrqlCondition;
    condition = condition.replace(/ = /g, ' == ');
    condition = condition.replace(/ AND /g, ' and ');
    condition = condition.replace(/ OR /g, ' or ');

    warnings.push(
      `NRQL condition '${nrqlCondition}' was auto-converted. ` +
        'Verify the resulting filter expression.',
    );

    return condition;
  }
}
