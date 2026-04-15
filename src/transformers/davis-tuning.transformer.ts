/**
 * Davis Tuning Transformer — Converts NR Proactive-Detection / Golden-
 * Signal suppression settings to Dynatrace Davis anomaly-detection
 * setting overrides.
 *
 * Covers:
 *   - Proactive-detection sensitivity (HIGH / MEDIUM / LOW)
 *   - Specific signal disablement (e.g. disable slowdown detection on
 *     low-traffic services)
 *   - Entity-scoped overrides (apply tuning only to entities matching
 *     tag selectors)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRDavisSignal =
  | 'response_time'
  | 'error_rate'
  | 'throughput'
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'network';

export type NRDavisSensitivity = 'HIGH' | 'MEDIUM' | 'LOW' | 'DISABLED';

export interface NRDavisTuningRule {
  readonly name?: string;
  readonly signal: NRDavisSignal;
  readonly sensitivity: NRDavisSensitivity;
  readonly entityTags?: Record<string, string>;
}

export interface NRDavisTuningInput {
  readonly rules: NRDavisTuningRule[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTDavisAnomalySetting {
  readonly schemaId: 'builtin:anomaly-detection.davis';
  readonly displayName: string;
  readonly signal: NRDavisSignal;
  readonly sensitivity: NRDavisSensitivity;
  readonly entityTagSelector: Record<string, string>;
}

export interface DavisTuningTransformData {
  readonly settings: DTDavisAnomalySetting[];
  readonly manualSteps: string[];
}

const MANUAL_STEPS: string[] = [
  "Davis anomaly settings are applied at the entity or environment scope. Confirm each rule's entityTagSelector matches the expected entity set before enabling.",
  'Setting sensitivity=DISABLED turns Davis detection off for the signal entirely on matched entities — use sparingly.',
  'If NR tuning was time-bounded (only suppress during maintenance windows), combine with MaintenanceWindowTransformer output rather than setting sensitivity=DISABLED permanently.',
];

// ---------------------------------------------------------------------------
// DavisTuningTransformer
// ---------------------------------------------------------------------------

export class DavisTuningTransformer {
  transform(input: NRDavisTuningInput): TransformResult<DavisTuningTransformData> {
    try {
      if (!Array.isArray(input.rules) || input.rules.length === 0) {
        return failure(['At least one tuning rule is required']);
      }
      const warnings: string[] = [];

      const settings: DTDavisAnomalySetting[] = input.rules.map((r, i) => {
        if (r.sensitivity === 'DISABLED' && (!r.entityTags || Object.keys(r.entityTags).length === 0)) {
          warnings.push(
            `Rule #${i} (${r.signal}) disables detection with no entityTags — this will suppress Davis for the entire tenant. Add an entity-tag scope to narrow it.`,
          );
        }
        return {
          schemaId: 'builtin:anomaly-detection.davis',
          displayName: r.name ?? `[Migrated Davis] ${r.signal} sensitivity=${r.sensitivity}`,
          signal: r.signal,
          sensitivity: r.sensitivity,
          entityTagSelector: { ...(r.entityTags ?? {}) },
        };
      });

      return success(
        { settings, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRDavisTuningInput[],
  ): TransformResult<DavisTuningTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
