/**
 * Log Obfuscation Transformer — Converts New Relic PII / PAN masking
 * rules to Dynatrace Gen3 OpenPipeline masking processors.
 *
 * Gen3 output: a single masking-stage entry for the
 * `builtin:openpipeline.logs.pipelines` schema, with DPL `replacePattern`
 * rules covering the standard NR obfuscation categories (email, SSN,
 * credit card, phone, IP) plus custom regex rules the customer defined.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRObfuscationCategory =
  | 'EMAIL'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'PHONE'
  | 'IP_ADDRESS'
  | 'CUSTOM';

export interface NRObfuscationRule {
  readonly name?: string;
  readonly category: NRObfuscationCategory;
  readonly enabled?: boolean;
  /** NR regex literal (PCRE). For CUSTOM category this is required. */
  readonly regex?: string;
  /** Replacement string (defaults to `***`). */
  readonly replacement?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTOpenPipelineMaskingRule {
  readonly name: string;
  readonly enabled: boolean;
  readonly pattern: string;
  readonly replacement: string;
}

export interface DTOpenPipelineMaskingStage {
  readonly schemaId: 'builtin:openpipeline.logs.pipelines';
  readonly stage: 'masking';
  readonly rules: DTOpenPipelineMaskingRule[];
}

export interface LogObfuscationTransformData {
  readonly maskingStage: DTOpenPipelineMaskingStage;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

const BUILTIN_PATTERNS: Record<
  Exclude<NRObfuscationCategory, 'CUSTOM'>,
  string
> = {
  EMAIL: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
  SSN: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
  CREDIT_CARD: '\\b(?:\\d[ -]*?){13,16}\\b',
  PHONE: '\\b(?:\\+\\d{1,3}[ -]?)?(?:\\(\\d{3}\\)|\\d{3})[ -]?\\d{3}[ -]?\\d{4}\\b',
  IP_ADDRESS: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
};

const MANUAL_STEPS: string[] = [
  'Test each masking rule against a sample log payload in Grail (fetch logs | ...) before promoting the OpenPipeline change to production.',
  'If NR used token-level obfuscation (vs record-level), redesign the rule — OpenPipeline masking operates at the record/field level.',
  'NR regex syntax is PCRE; OpenPipeline DPL is a superset but some advanced PCRE features (lookbehind, backreferences) may not be supported. Flagged rules need manual review.',
];

// ---------------------------------------------------------------------------
// LogObfuscationTransformer
// ---------------------------------------------------------------------------

export class LogObfuscationTransformer {
  transform(inputs: NRObfuscationRule[]): TransformResult<LogObfuscationTransformData> {
    try {
      if (!Array.isArray(inputs) || inputs.length === 0) {
        return failure(['At least one obfuscation rule is required']);
      }

      const warnings: string[] = [];
      const rules: DTOpenPipelineMaskingRule[] = [];

      for (const rule of inputs) {
        const enabled = rule.enabled ?? true;
        const replacement = rule.replacement ?? '***';

        let pattern: string | undefined;
        if (rule.category === 'CUSTOM') {
          if (!rule.regex) {
            warnings.push(
              `Custom rule '${rule.name ?? '<unnamed>'}' has no regex — skipped.`,
            );
            continue;
          }
          pattern = rule.regex;
          if (/\(\?<=|\\k</.test(rule.regex)) {
            warnings.push(
              `Custom rule '${rule.name ?? '<unnamed>'}' uses PCRE features (lookbehind / backref) that may not be supported by OpenPipeline DPL — review before enabling.`,
            );
          }
        } else {
          pattern = BUILTIN_PATTERNS[rule.category];
        }

        if (!pattern) {
          warnings.push(
            `Could not derive pattern for rule '${rule.name ?? rule.category}'; skipped.`,
          );
          continue;
        }

        rules.push({
          name: rule.name ?? `mask_${rule.category.toLowerCase()}`,
          enabled,
          pattern,
          replacement,
        });
      }

      const maskingStage: DTOpenPipelineMaskingStage = {
        schemaId: 'builtin:openpipeline.logs.pipelines',
        stage: 'masking',
        rules,
      };

      return success({ maskingStage, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }
}
