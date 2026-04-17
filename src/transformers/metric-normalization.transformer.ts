/**
 * Metric Normalization Transformer — Converts NR metric normalization
 * rules (rename / scale / unit conversion / derive) to Dynatrace
 * OpenPipeline metric-processing stage entries.
 *
 * NR normalization rules typically look like:
 *   - rename "old.metric.name" to "new.metric.name"
 *   - scale "bytes" → "megabytes" via * 1/1024^2
 *   - derive "ratio" = numerator / denominator
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRNormalizationAction =
  | 'RENAME'
  | 'SCALE'
  | 'CONVERT_UNIT'
  | 'DERIVE';

export interface NRMetricNormalizationRule {
  readonly name?: string;
  readonly action: NRNormalizationAction;
  readonly sourceMetric: string;
  readonly targetMetric?: string;
  readonly scaleFactor?: number;
  readonly fromUnit?: string;
  readonly toUnit?: string;
  readonly deriveExpression?: string;
  readonly enabled?: boolean;
}

export interface NRMetricNormalizationInput {
  readonly rules: NRMetricNormalizationRule[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type DTMetricProcessorOp = 'rename' | 'scale' | 'convertUnit' | 'derive';

export interface DTMetricProcessor {
  readonly schemaId: 'builtin:openpipeline.metrics.transform';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly op: DTMetricProcessorOp;
  readonly sourceMetric: string;
  readonly targetMetric: string;
  readonly expression?: string;
  readonly scaleFactor?: number;
  readonly unitConversion?: { readonly from: string; readonly to: string };
}

export interface MetricNormalizationTransformData {
  readonly processors: DTMetricProcessor[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Unit conversion helpers (bytes / time / rate)
// ---------------------------------------------------------------------------

const UNIT_SCALE: Record<string, Record<string, number>> = {
  bytes: { kilobytes: 1 / 1024, megabytes: 1 / 1024 ** 2, gigabytes: 1 / 1024 ** 3 },
  seconds: { milliseconds: 1000, microseconds: 1_000_000 },
  milliseconds: { seconds: 1 / 1000, microseconds: 1000 },
  microseconds: { milliseconds: 1 / 1000, seconds: 1 / 1_000_000 },
};

function unitScaleFactor(from: string, to: string): number | undefined {
  if (from === to) return 1;
  return UNIT_SCALE[from]?.[to];
}

const MANUAL_STEPS: string[] = [
  'DT OpenPipeline metric transforms apply at ingest; preview the output via `fetch timeseries ... | filter metric.key starts with "<target>"` before enabling.',
  'DERIVE rules emit an expression string — DPL arithmetic is a subset of NRQL; compare emitted expressions against Grail before enabling.',
  'If a normalization rule renames a metric that other NR alerts/dashboards depend on, coordinate the rename with those consumers (the alert transformer can pick up the new name from `DEFAULT_METRIC_MAP` once you extend it).',
];

// ---------------------------------------------------------------------------
// MetricNormalizationTransformer
// ---------------------------------------------------------------------------

export class MetricNormalizationTransformer {
  transform(
    input: NRMetricNormalizationInput,
  ): TransformResult<MetricNormalizationTransformData> {
    try {
      if (!Array.isArray(input.rules) || input.rules.length === 0) {
        return failure(['At least one normalization rule is required']);
      }
      const warnings: string[] = [];
      const processors: DTMetricProcessor[] = [];

      for (const r of input.rules) {
        const enabled = r.enabled ?? true;
        const sourceMetric = r.sourceMetric;
        if (!sourceMetric) {
          warnings.push(`Rule '${r.name ?? '<unnamed>'}' has no sourceMetric; skipped.`);
          continue;
        }
        const displayName = r.name ?? `[Migrated] ${r.action.toLowerCase()}_${sourceMetric}`;

        switch (r.action) {
          case 'RENAME':
            if (!r.targetMetric) {
              warnings.push(
                `RENAME rule '${r.name ?? sourceMetric}' missing targetMetric; skipped.`,
              );
              continue;
            }
            processors.push({
              schemaId: 'builtin:openpipeline.metrics.transform',
              displayName,
              enabled,
              op: 'rename',
              sourceMetric,
              targetMetric: r.targetMetric,
            });
            break;
          case 'SCALE':
            if (r.scaleFactor === undefined) {
              warnings.push(
                `SCALE rule '${r.name ?? sourceMetric}' missing scaleFactor; skipped.`,
              );
              continue;
            }
            processors.push({
              schemaId: 'builtin:openpipeline.metrics.transform',
              displayName,
              enabled,
              op: 'scale',
              sourceMetric,
              targetMetric: r.targetMetric ?? sourceMetric,
              scaleFactor: r.scaleFactor,
              expression: `${sourceMetric} * ${r.scaleFactor}`,
            });
            break;
          case 'CONVERT_UNIT': {
            if (!r.fromUnit || !r.toUnit) {
              warnings.push(
                `CONVERT_UNIT rule '${r.name ?? sourceMetric}' missing fromUnit/toUnit; skipped.`,
              );
              continue;
            }
            const factor = unitScaleFactor(r.fromUnit, r.toUnit);
            if (factor === undefined) {
              warnings.push(
                `CONVERT_UNIT rule '${r.name ?? sourceMetric}': no default scale factor for ${r.fromUnit}→${r.toUnit}; emitting a passthrough with a TODO expression.`,
              );
              processors.push({
                schemaId: 'builtin:openpipeline.metrics.transform',
                displayName,
                enabled: false,
                op: 'convertUnit',
                sourceMetric,
                targetMetric: r.targetMetric ?? sourceMetric,
                unitConversion: { from: r.fromUnit, to: r.toUnit },
                expression: `/* TODO: ${sourceMetric} scaled from ${r.fromUnit} to ${r.toUnit} */`,
              });
              break;
            }
            processors.push({
              schemaId: 'builtin:openpipeline.metrics.transform',
              displayName,
              enabled,
              op: 'convertUnit',
              sourceMetric,
              targetMetric: r.targetMetric ?? sourceMetric,
              unitConversion: { from: r.fromUnit, to: r.toUnit },
              scaleFactor: factor,
              expression: `${sourceMetric} * ${factor}`,
            });
            break;
          }
          case 'DERIVE':
            if (!r.deriveExpression) {
              warnings.push(
                `DERIVE rule '${r.name ?? sourceMetric}' missing deriveExpression; skipped.`,
              );
              continue;
            }
            processors.push({
              schemaId: 'builtin:openpipeline.metrics.transform',
              displayName,
              enabled,
              op: 'derive',
              sourceMetric,
              targetMetric: r.targetMetric ?? `${sourceMetric}.derived`,
              expression: r.deriveExpression,
            });
            break;
          default:
            warnings.push(
              `Unknown normalization action '${r.action as string}' on '${sourceMetric}'.`,
            );
        }
      }

      return success(
        { processors, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRMetricNormalizationInput[],
  ): TransformResult<MetricNormalizationTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
