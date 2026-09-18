/**
 * Baseline Alert Transformer — Translates NR NRQL conditions with
 * `type=BASELINE` or `type=OUTLIER` to Dynatrace Davis anomaly
 * detectors (`builtin:davis.anomaly-detectors`, §6 canonical shape).
 *
 * Mapping:
 *   - Analyzer: `AutoAdaptiveAnomalyDetectionAnalyzer`
 *   - NR baseline direction (LOWER_ONLY / UPPER_ONLY / UPPER_AND_LOWER)
 *     → `alertCondition` input (BELOW / ABOVE / OUTSIDE_BOUNDS)
 *   - NR sensitivity (HIGH / MEDIUM / LOW) → `numberOfSignalFluctuations`
 *     (2.0 / 3.0 / 4.0 σ)
 *   - NRQL → timeseries DQL via `nrqlToAnalyzerQuery`
 *   - Facet → `by:` split in the query (`addSplitDimension`; there is no
 *     `dimensions` analyzer input — D21). OUTLIER without a facet defaults to
 *     `dt.smartscape.service`.
 *   - Training window has no analyzer input (warning only — D20).
 *
 * Mirrors Python `transformers/baseline_alert_transformer.py` (output shape).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import {
  DAVIS_ANALYZERS,
  DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
  DETECTOR_SOURCE,
  addSplitDimension,
  dealertingSamples,
  nrqlToAnalyzerQuery,
  type DTAnomalyDetector,
  type DTKeyValue,
} from './detector-utils.js';
import { migratedEventName } from './workflow-utils.js';

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
  /** Split dimension (NR FACET). Added to the query `by:` (D21); OUTLIER defaults to `dt.smartscape.service`. */
  readonly facet?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

/** Davis `alertCondition` values used by the adaptive analyzer. */
export type DTAnomalyDirection = 'BELOW' | 'ABOVE' | 'OUTSIDE_BOUNDS';
export type DTAnomalySensitivity = 'HIGH' | 'MEDIUM' | 'LOW';

/** @deprecated Alias of `DTAnomalyDetector` (the old flat shape was not a Settings schema shape). */
export type DTDavisAnomalyDetector = DTAnomalyDetector;

export interface BaselineAlertTransformData {
  /** The detector envelope (equals `anomalyDetectors[0]`). */
  readonly detector: DTAnomalyDetector;
  readonly anomalyDetectors: DTAnomalyDetector[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIRECTION_MAP: Record<NRBaselineDirection, DTAnomalyDirection> = {
  LOWER_ONLY: 'BELOW',
  UPPER_ONLY: 'ABOVE',
  UPPER_AND_LOWER: 'OUTSIDE_BOUNDS',
};

const SENSITIVITY_TO_FLUCTUATIONS: Record<NRBaselineSensitivity, string> = {
  HIGH: '2.0',
  MEDIUM: '3.0',
  LOW: '4.0',
};

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
      const direction = input.direction ?? 'UPPER_AND_LOWER';
      const sensitivity = input.sensitivity ?? 'MEDIUM';

      const nrqlQuery = input.nrql?.query ?? '';
      if (!nrqlQuery) {
        warnings.push(
          `${input.kind} condition '${conditionName}' has no NRQL source; the detector references an inert placeholder query and is disabled.`,
        );
      }
      if (input.trainingWindowSeconds) {
        warnings.push(
          `NR training window ${input.trainingWindowSeconds}s has no Davis analyzer input; the adaptive baseline uses its own training window.`,
        );
      }
      let facet = input.facet ?? '';
      if (input.kind === 'OUTLIER' && !facet) {
        warnings.push(
          `Outlier condition '${conditionName}' has no facet — DT outlier detection requires a \`by:\` dimension. Default set to 'dt.smartscape.service'.`,
        );
        facet = 'dt.smartscape.service';
      }

      // analyzer.input[query] is server-validated DQL and must be a timeseries.
      const dqlQuery = addSplitDimension(nrqlToAnalyzerQuery(nrqlQuery, warnings), facet);

      const properties: DTKeyValue[] = [
        { key: 'event.type', value: 'CUSTOM_ALERT' },
        { key: 'event.name', value: migratedEventName(conditionName, 'baseline') },
        { key: 'migrated.from', value: 'newrelic' },
        { key: 'source.kind', value: input.kind.toLowerCase() },
        { key: 'original.nrql', value: nrqlQuery || '(none provided)' },
      ];
      if (input.policyName) properties.push({ key: 'source.policy', value: input.policyName });

      const detector: DTAnomalyDetector = {
        schemaId: DAVIS_ANOMALY_DETECTOR_SCHEMA_ID,
        scope: 'environment',
        value: {
          enabled: input.enabled ?? !!nrqlQuery,
          title: `[Migrated baseline] ${conditionName}`,
          description: `Migrated from NR ${input.kind.toLowerCase()} condition. Direction: ${direction}, sensitivity: ${sensitivity}.`,
          source: DETECTOR_SOURCE,
          executionSettings: {}, // actor (service user) injected at import/export — D16
          analyzer: {
            name: DAVIS_ANALYZERS.AUTO_ADAPTIVE,
            input: [
              { key: 'query', value: dqlQuery },
              { key: 'numberOfSignalFluctuations', value: SENSITIVITY_TO_FLUCTUATIONS[sensitivity] },
              { key: 'alertCondition', value: DIRECTION_MAP[direction] },
              { key: 'alertOnMissingData', value: 'false' },
              { key: 'violatingSamples', value: '3' },
              { key: 'slidingWindow', value: '5' },
              { key: 'dealertingSamples', value: dealertingSamples(5) },
            ],
          },
          eventTemplate: { properties },
        },
      };

      return success({ detector, anomalyDetectors: [detector] }, warnings);
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
