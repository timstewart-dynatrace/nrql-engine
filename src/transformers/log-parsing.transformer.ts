/**
 * Log Parsing Transformer - Converts New Relic log parsing rules
 * to Dynatrace log processing rules.
 *
 * New Relic log parsing:
 * - Regex-based field extraction
 * - Grok patterns
 * - Attribute enrichment
 *
 * Dynatrace equivalents:
 * - Log processing rules with DPL (Dynatrace Pattern Language)
 * - Log attribute extraction
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRLogParsingRuleInput {
  readonly name?: string;
  readonly type?: string;
  readonly enabled?: boolean;
  readonly pattern?: string;
  readonly attributes?: string[];
}

export interface DTLogProcessingRule {
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  query: string;
  pattern: string;
  source: string;
}

// ---------------------------------------------------------------------------
// LogParsingTransformer
// ---------------------------------------------------------------------------

export class LogParsingTransformer {
  transform(nrRule: NRLogParsingRuleInput): TransformResult<DTLogProcessingRule[]> {
    const warnings: string[] = [];

    try {
      const ruleName = nrRule.name ?? 'Unnamed Rule';
      const ruleType = nrRule.type ?? 'regex';
      const enabled = nrRule.enabled ?? true;

      let processingRule: DTLogProcessingRule;

      if (ruleType === 'regex') {
        processingRule = this.transformRegexRule(nrRule, warnings);
      } else if (ruleType === 'grok') {
        processingRule = this.transformGrokRule(nrRule, warnings);
      } else {
        warnings.push(
          `Unknown log parsing type '${ruleType}' for rule '${ruleName}'.`,
        );
        processingRule = this.createPlaceholder(nrRule);
      }

      if (!enabled) {
        processingRule.enabled = false;
      }

      return success([processingRule], warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(rules: NRLogParsingRuleInput[]): TransformResult<DTLogProcessingRule[]>[] {
    return rules.map((r) => this.transform(r));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private transformRegexRule(
    rule: NRLogParsingRuleInput,
    _warnings: string[],
  ): DTLogProcessingRule {
    const name = rule.name ?? 'Regex Rule';
    const pattern = rule.pattern ?? '';
    const attributes = rule.attributes ?? [];

    const dplPattern = this.regexToDpl(pattern, attributes);

    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR log parsing rule: ${name}`,
      type: 'ATTRIBUTE_EXTRACTION',
      enabled: rule.enabled ?? true,
      query: 'matchesValue(content, "*")',
      pattern: dplPattern,
      source: 'content',
    };
  }

  private transformGrokRule(
    rule: NRLogParsingRuleInput,
    warnings: string[],
  ): DTLogProcessingRule {
    const name = rule.name ?? 'Grok Rule';

    warnings.push(
      `Grok pattern in rule '${name}' requires manual conversion to DPL. ` +
        'Dynatrace uses DPL (Dynatrace Pattern Language) instead of Grok.',
    );

    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR grok rule: ${name}. Requires manual DPL conversion.`,
      type: 'ATTRIBUTE_EXTRACTION',
      enabled: false,
      query: 'matchesValue(content, "*")',
      pattern: '// TODO: Convert grok pattern to DPL',
      source: 'content',
    };
  }

  private regexToDpl(regexPattern: string, attributes: string[]): string {
    if (!regexPattern) {
      return '// TODO: Add DPL pattern';
    }

    let dpl = regexPattern;
    for (const attr of attributes) {
      dpl = dpl.replace(`(${attr})`, `'${attr}':STRING`);
    }

    return dpl;
  }

  private createPlaceholder(rule: NRLogParsingRuleInput): DTLogProcessingRule {
    const name = rule.name ?? 'Unknown Rule';
    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR log parsing rule (unknown type): ${name}`,
      type: 'ATTRIBUTE_EXTRACTION',
      enabled: false,
      query: 'matchesValue(content, "*")',
      pattern: '// TODO: Manual conversion required',
      source: 'content',
    };
  }
}
