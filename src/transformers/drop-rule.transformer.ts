/**
 * Drop Rule Transformer — Converts New Relic drop rules (v1 NRQL-scoped
 * and v2 attribute-scoped) to Dynatrace OpenPipeline processors.
 *
 * v1 (NRQL `WHERE`-based): emits a DROP / MASK ingest rule whose
 * condition is a translated DPL matcher.
 *
 * v2 (attribute-scoped): NR's newer drop-filter API supports per-
 * attribute rules (drop individual attributes on matching records,
 * or keep only an allow-list of attributes). These emit OpenPipeline
 * `fieldsRemove` / `fieldsKeep` processors bound to the configured
 * pipeline (logs / spans / bizevents).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// v1 Input (unchanged)
// ---------------------------------------------------------------------------

export interface NRDropRuleInput {
  readonly name?: string;
  readonly nrqlCondition?: string;
  readonly action?: string;
  readonly enabled?: boolean;
  readonly attributes?: string[];
}

// ---------------------------------------------------------------------------
// v2 Input (attribute-scoped)
// ---------------------------------------------------------------------------

export type NRDropPipeline = 'logs' | 'spans' | 'bizevents' | 'metrics';

export type NRDropV2Action =
  | 'DROP_DATA' // drop whole record
  | 'DROP_ATTRIBUTES' // drop named attributes on matching records
  | 'KEEP_ATTRIBUTES'; // allow-list: drop all except named attributes

export interface NRDropRuleV2Input {
  readonly name?: string;
  readonly pipeline: NRDropPipeline;
  readonly action: NRDropV2Action;
  readonly enabled?: boolean;
  /** DPL or simple `field == "value"` matcher applied to each record. */
  readonly matcher?: string;
  readonly attributes?: string[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTIngestRule {
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  condition: string;
  attributes?: string[];
}

export type DTOpenPipelineDropProcessor =
  | {
      readonly schemaId: 'builtin:openpipeline.processor.drop';
      readonly displayName: string;
      readonly pipeline: NRDropPipeline;
      readonly enabled: boolean;
      readonly matcher: string;
    }
  | {
      readonly schemaId: 'builtin:openpipeline.processor.fieldsRemove';
      readonly displayName: string;
      readonly pipeline: NRDropPipeline;
      readonly enabled: boolean;
      readonly matcher: string;
      readonly fields: string[];
    }
  | {
      readonly schemaId: 'builtin:openpipeline.processor.fieldsKeep';
      readonly displayName: string;
      readonly pipeline: NRDropPipeline;
      readonly enabled: boolean;
      readonly matcher: string;
      readonly keepFields: string[];
    };

// ---------------------------------------------------------------------------
// DropRuleTransformer
// ---------------------------------------------------------------------------

export class DropRuleTransformer {
  // ─── v1 (original API — preserved) ──────────────────────────────────────

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

  // ─── v2 (attribute-scoped) ──────────────────────────────────────────────

  transformV2(
    nrRule: NRDropRuleV2Input,
  ): TransformResult<DTOpenPipelineDropProcessor> {
    try {
      const name = nrRule.name ?? 'Unnamed v2 Drop Rule';
      const enabled = nrRule.enabled ?? true;
      const matcher = nrRule.matcher?.trim() || 'true';
      const warnings: string[] = [];

      switch (nrRule.action) {
        case 'DROP_DATA':
          return success(
            {
              schemaId: 'builtin:openpipeline.processor.drop',
              displayName: `[Migrated] ${name}`,
              pipeline: nrRule.pipeline,
              enabled,
              matcher,
            },
            warnings,
          );
        case 'DROP_ATTRIBUTES': {
          const attrs = nrRule.attributes ?? [];
          if (attrs.length === 0) {
            return failure([
              `DROP_ATTRIBUTES rule '${name}' has no attributes list; cannot emit processor.`,
            ]);
          }
          return success(
            {
              schemaId: 'builtin:openpipeline.processor.fieldsRemove',
              displayName: `[Migrated] ${name}`,
              pipeline: nrRule.pipeline,
              enabled,
              matcher,
              fields: [...attrs],
            },
            warnings,
          );
        }
        case 'KEEP_ATTRIBUTES': {
          const attrs = nrRule.attributes ?? [];
          if (attrs.length === 0) {
            return failure([
              `KEEP_ATTRIBUTES rule '${name}' has no attributes list; cannot emit processor.`,
            ]);
          }
          warnings.push(
            `KEEP_ATTRIBUTES is an allow-list — every attribute not listed will be dropped on matching records. Double-check the list before enabling.`,
          );
          return success(
            {
              schemaId: 'builtin:openpipeline.processor.fieldsKeep',
              displayName: `[Migrated] ${name}`,
              pipeline: nrRule.pipeline,
              enabled,
              matcher,
              keepFields: [...attrs],
            },
            warnings,
          );
        }
        default:
          return failure([`Unknown v2 action '${nrRule.action as string}'`]);
      }
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAllV2(
    rules: NRDropRuleV2Input[],
  ): TransformResult<DTOpenPipelineDropProcessor>[] {
    return rules.map((r) => this.transformV2(r));
  }

  // ─── Private helpers ────────────────────────────────────────────────────

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
