/**
 * Legacy Apdex Transformer (Gen2-only fallback).
 *
 * NR's `apdex(threshold)` function decomposes to a LOW-confidence
 * `countIf()` approximation on the Gen3 DQL path. Classic DT exposes
 * `builtin:apdex.service-apdex-calculation` — a per-service tolerated/
 * frustrated threshold override — that matches NR's semantics exactly.
 * For customers on classic DT, emitting this schema lifts Apdex from
 * LOW to HIGH confidence.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRApdexOverride {
  /** NR service / application name the threshold applies to. */
  readonly serviceName: string;
  /** Apdex T-value (tolerated threshold) in seconds. */
  readonly tolerated: number;
  /** Frustrated threshold in seconds. Defaults to `tolerated × 4` per NR convention. */
  readonly frustrated?: number;
  /** Classic DT service entity id, if consumer has already resolved it. */
  readonly dtServiceEntityId?: string;
}

export interface NRApdexInput {
  readonly overrides: NRApdexOverride[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LegacyApdexCalculationSetting {
  readonly schemaId: 'builtin:apdex.service-apdex-calculation';
  readonly displayName: string;
  readonly scope: string; // entity id ("SERVICE-..." / "environment")
  readonly toleratedThresholdMs: number;
  readonly frustratedThresholdMs: number;
}

export interface LegacyApdexTransformData {
  readonly settings: LegacyApdexCalculationSetting[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGACY_WARNING =
  'Emitting Gen2 classic builtin:apdex.service-apdex-calculation (legacy). Default compiler path approximates apdex(t) via countIf() buckets at LOW confidence — use this legacy transformer when the target tenant still uses classic Apdex settings.';

const MANUAL_STEPS: string[] = [
  'Classic Apdex settings apply at the service-entity scope; resolve NR service names to DT SERVICE-... entity ids before applying. A service-scope setting beats the environment default.',
  'DT classic Apdex operates in milliseconds; NR T-values are in seconds — the transformer converts automatically.',
  'If NR had a different frustrated multiplier than 4×tolerated, supply `frustrated` explicitly on the input.',
];

// ---------------------------------------------------------------------------
// LegacyApdexTransformer
// ---------------------------------------------------------------------------

export class LegacyApdexTransformer {
  transform(input: NRApdexInput): TransformResult<LegacyApdexTransformData> {
    try {
      if (!Array.isArray(input.overrides) || input.overrides.length === 0) {
        return failure(['At least one Apdex override is required']);
      }
      const warnings: string[] = [LEGACY_WARNING];
      const settings: LegacyApdexCalculationSetting[] = [];

      for (const o of input.overrides) {
        if (!o.serviceName?.trim()) {
          warnings.push(
            `Apdex override missing serviceName; skipped (t=${o.tolerated}).`,
          );
          continue;
        }
        if (!(o.tolerated > 0)) {
          warnings.push(
            `Apdex override '${o.serviceName}' has non-positive tolerated threshold '${o.tolerated}'; skipped.`,
          );
          continue;
        }
        const tolMs = Math.round(o.tolerated * 1000);
        const frustMs = o.frustrated
          ? Math.round(o.frustrated * 1000)
          : tolMs * 4;
        const scope = o.dtServiceEntityId ?? `entity-placeholder-for-${o.serviceName}`;

        if (!o.dtServiceEntityId) {
          warnings.push(
            `Apdex override '${o.serviceName}' has no dtServiceEntityId — emitted scope '${scope}'. Resolve the SERVICE-... id before applying.`,
          );
        }

        settings.push({
          schemaId: 'builtin:apdex.service-apdex-calculation',
          displayName: `[Migrated Legacy Apdex] ${o.serviceName}`,
          scope,
          toleratedThresholdMs: tolMs,
          frustratedThresholdMs: frustMs,
        });
      }

      if (settings.length === 0) {
        return failure(['No valid Apdex overrides produced any settings']);
      }

      return success({ settings, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRApdexInput[],
  ): TransformResult<LegacyApdexTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
