/**
 * Baseline Alert Transformer — Translates NR NRQL conditions with
 * `type=BASELINE` or `type=OUTLIER` to Dynatrace Davis anomaly
 * detectors (`builtin:davis.anomaly-detectors`).
 *
 * Mapping:
 *   - NR baseline direction (LOWER_ONLY / UPPER_ONLY / UPPER_AND_LOWER)
 *     → Davis anomaly direction (BELOW / ABOVE / BOTH)
 *   - NR sensitivity (HIGH / MEDIUM / LOW) → Davis sensitivity tier
 *   - Training window (NR `aggregationWindow`) → Davis training period
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRBaselineDirection = 'LOWER_ONLY' | 'UPPER_ONLY' | 'UPPER_AND_LOWER';
export type NRBaselineSensitivity = 'HIGH' | 'MEDIUM' | 'LOW';
export type NRBaselineKind = 'BASELINE' | 'OUTLIER';

export interface NRBaselineConditionInput {
  readonly name?: string;
  readonly kind: NRBaselineKind;
  readonly nrql?: { query?: string };
  readonly direction?: NRBaselineDirection;
  readonly sensitivity?: NRBaselineSensitivity;
  /** Seconds — NR's training/aggregation window. */
  readonly trainingWindowSeconds?: number;
  readonly policyName?: string;
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export type DTAnomalyDirection = 'BELOW' | 'ABOVE' | 'BOTH';
export type DTAnomalySensitivity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DTDavisAnomalyDetector {
  readonly schemaId: 'builtin:davis.anomaly-detectors';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly detectorKind: 'BASELINE' | 'OUTLIER';
  readonly dql: string;
  readonly direction: DTAnomalyDirection;
  readonly sensitivity: DTAnomalySensitivity;
  readonly trainingPeriod: string;
  readonly entityTags: Record<string, string>;
}

export interface BaselineAlertTransformData {
  readonly detector: DTDavisAnomalyDetector;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIRECTION_MAP: Record<NRBaselineDirection, DTAnomalyDirection> = {
  LOWER_ONLY: 'BELOW',
  UPPER_ONLY: 'ABOVE',
  UPPER_AND_LOWER: 'BOTH',
};

function trainingPeriodFor(seconds: number | undefined): string {
  // Davis anomaly detectors expect an ISO-8601-like duration. Default to 7 days.
  if (!seconds || seconds <= 0) return 'P7D';
  const days = Math.max(1, Math.floor(seconds / 86400));
  return `P${days}D`;
}

function migrationTag(policyName: string | undefined, conditionName: string): string {
  const base = `${policyName ?? 'policy'}-${conditionName}`;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'migrated-anomaly'
  );
}

// ---------------------------------------------------------------------------
// BaselineAlertTransformer
// ---------------------------------------------------------------------------

export class BaselineAlertTransformer {
  transform(
    input: NRBaselineConditionInput,
  ): TransformResult<BaselineAlertTransformData> {
    try {
      if (!input.kind) {
        return failure(['kind (BASELINE | OUTLIER) is required']);
      }
      const warnings: string[] = [];
      const conditionName = input.name ?? `Unnamed ${input.kind} Condition`;
      const tag = migrationTag(input.policyName, conditionName);

      const nrqlQuery = input.nrql?.query ?? '';
      if (!nrqlQuery) {
        warnings.push(
          `${input.kind} condition '${conditionName}' has no NRQL source; emitting a DQL placeholder. Run the NRQL through the compiler and replace before enabling.`,
        );
      }

      // Consumers should feed this DQL through the NRQL compiler. We keep
      // the original NRQL as a comment so that relationship is visible.
      const dql = nrqlQuery
        ? `// NRQL source: ${nrqlQuery}\n// TODO: compile via nrql-engine before use\ntimeseries avg(<metric>)`
        : 'timeseries avg(<metric>)';

      const detector: DTDavisAnomalyDetector = {
        schemaId: 'builtin:davis.anomaly-detectors',
        displayName: `[Migrated ${input.kind}] ${conditionName}`,
        enabled: input.enabled ?? !!nrqlQuery,
        detectorKind: input.kind,
        dql,
        direction: DIRECTION_MAP[input.direction ?? 'UPPER_AND_LOWER'],
        sensitivity: input.sensitivity ?? 'MEDIUM',
        trainingPeriod: trainingPeriodFor(input.trainingWindowSeconds),
        entityTags: { 'nr-migrated': tag },
      };

      return success({ detector }, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRBaselineConditionInput[],
  ): TransformResult<BaselineAlertTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
