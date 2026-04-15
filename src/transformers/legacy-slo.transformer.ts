/**
 * Legacy SLO Transformer (Gen2 classic SLO v1 shape).
 *
 * For parity with Dynatrace tenants still on the SLO v1 API. The
 * Gen3 SLOTransformer emits the v2 `builtin:monitoring.slo` shape by
 * default; this class emits the pre-Gen3 `/api/v2/slo` v1 payload with
 * `metricRate` / `numeratorValue` / `denominatorValue` fields instead
 * of a metricExpression.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { NRSloInput } from './slo.transformer.js';

export interface LegacyDTSloV1 {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly target: number;
  readonly warning: number;
  readonly timeframe: string;
  readonly relatedMetricIds: string[];
  readonly metricRate: string;
  readonly numeratorValue: string;
  readonly denominatorValue: string;
  readonly evaluationType: 'AGGREGATE';
}

const LEGACY_WARNING =
  'Emitting Gen2 classic SLO v1 (legacy). Default output is the Gen3 `builtin:monitoring.slo` v2 schema — use SLOTransformer unless legacy parity is required.';

export class LegacySLOTransformer {
  transform(nrSlo: NRSloInput): TransformResult<LegacyDTSloV1> {
    try {
      const name = nrSlo.name ?? 'Unnamed SLO';
      const objective = (nrSlo.objectives ?? [])[0];
      if (!objective) {
        return failure([`SLO '${name}' has no objectives defined`]);
      }
      const target = objective.target ?? 99.0;
      const rolling = objective.timeWindow?.rolling ?? {};
      const count = rolling.count ?? 7;
      const unit = (rolling.unit ?? 'DAY').toLowerCase();

      const warnings: string[] = [LEGACY_WARNING];
      const good = nrSlo.events?.goodEvents?.where ?? '';
      const valid = nrSlo.events?.validEvents?.where ?? '';

      if (!good || !valid) {
        warnings.push(
          `SLO '${name}' is missing one or both event queries; v1 payload emitted with placeholder ratio.`,
        );
      }

      const slo: LegacyDTSloV1 = {
        name: `[Migrated Legacy] ${name}`,
        description: nrSlo.description ?? 'Migrated from New Relic (v1 legacy)',
        enabled: true,
        target,
        warning: Math.max(0, target - 1),
        timeframe: `-${count}${unit.startsWith('w') ? 'w' : unit.startsWith('m') ? 'M' : 'd'}`,
        relatedMetricIds: [],
        metricRate: `// TODO: derive from NRQL '${good || valid}'`,
        numeratorValue: good || 'count',
        denominatorValue: valid || 'count',
        evaluationType: 'AGGREGATE',
      };

      return success(slo, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(inputs: NRSloInput[]): TransformResult<LegacyDTSloV1>[] {
    return inputs.map((i) => this.transform(i));
  }
}
