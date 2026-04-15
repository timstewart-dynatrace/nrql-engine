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
// PCRE → DPL translation
// ---------------------------------------------------------------------------

/**
 * Convert a PCRE pattern into a DPL-compatible pattern string. DPL's
 * regex dialect is a subset of RE2 (same as Go). We translate the
 * common constructs and flag anything we drop. Unsupported features
 * are enumerated in `unsupportedPcreFeatures` so the warning message
 * tells the operator exactly what to re-express manually.
 */
export interface PcreToDplResult {
  readonly dpl: string;
  readonly warnings: string[];
  readonly unsupportedFeatures: string[];
}

const UNSUPPORTED_PCRE_DETECTORS: Array<{ regex: RegExp; feature: string }> = [
  { regex: /\(\?<=/, feature: 'lookbehind (?<=…)' },
  { regex: /\(\?<!/, feature: 'negative lookbehind (?<!…)' },
  { regex: /\(\?=/, feature: 'lookahead (?=…)' },
  { regex: /\(\?!/, feature: 'negative lookahead (?!…)' },
  { regex: /\\k</, feature: 'named backreference \\k<…>' },
  { regex: /\\(\d{1,2})/, feature: 'numeric backreference \\N' },
  { regex: /\(\?\#/, feature: 'inline comment (?#…)' },
  { regex: /\(\?\|/, feature: 'branch reset (?|…)' },
  { regex: /\(\?R\)|\(\?0\)/, feature: 'recursion (?R) / (?0)' },
  { regex: /\\[pP]\{/, feature: 'Unicode property escape \\p{…}' },
  { regex: /\(\*[A-Z]+/, feature: 'backtracking control verbs (*VERB)' },
  { regex: /\\[GKQ]/, feature: 'PCRE escapes \\G / \\K / \\Q' },
];

export function pcreToDpl(pcre: string): PcreToDplResult {
  const warnings: string[] = [];
  const unsupportedFeatures: string[] = [];

  for (const { regex, feature } of UNSUPPORTED_PCRE_DETECTORS) {
    if (regex.test(pcre)) {
      unsupportedFeatures.push(feature);
    }
  }

  let dpl = pcre;

  // Strip inline flag groups like `(?i)` and translate to warning; DPL
  // uses a separate flag at the function call site, not inline.
  const inlineFlagMatch = /^\(\?([imxsu-]+)\)/.exec(dpl);
  if (inlineFlagMatch) {
    warnings.push(
      `Inline flag '(?${inlineFlagMatch[1]})' stripped — supply the equivalent as a matchesRegex(..., "i") argument or set pipeline-level case-sensitivity.`,
    );
    dpl = dpl.replace(/^\(\?[imxsu-]+\)/, '');
  }

  // Named groups: PCRE `(?P<name>…)` and `(?<name>…)` → RE2 uses `(?P<name>…)`.
  dpl = dpl.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, '(?P<$1>');

  // Atomic groups `(?>…)` — RE2 does not support; strip to a non-capturing
  // group and warn (semantics differ but input usually still matches).
  if (/\(\?>/.test(dpl)) {
    unsupportedFeatures.push('atomic group (?>…)');
    dpl = dpl.replace(/\(\?>/g, '(?:');
  }

  // Possessive quantifiers a*+ a++ a?+ — strip the trailing + and warn.
  if (/[*+?]\+/.test(dpl)) {
    unsupportedFeatures.push('possessive quantifiers (*+, ++, ?+)');
    dpl = dpl.replace(/([*+?])\+/g, '$1');
  }

  if (unsupportedFeatures.length > 0) {
    warnings.push(
      `PCRE features that do not translate cleanly to DPL/RE2: ${unsupportedFeatures.join('; ')}. Review the emitted pattern before enabling.`,
    );
  }

  return { dpl, warnings, unsupportedFeatures };
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
          const translated = pcreToDpl(rule.regex);
          pattern = translated.dpl;
          for (const w of translated.warnings) {
            warnings.push(`Custom rule '${rule.name ?? '<unnamed>'}': ${w}`);
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
