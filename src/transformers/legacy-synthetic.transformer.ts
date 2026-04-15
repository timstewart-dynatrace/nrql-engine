/**
 * Legacy Synthetic Transformer (Gen2 classic synthetic monitor shape).
 *
 * For parity with tenants still using the pre-Gen3 synthetic monitor
 * API (`/api/v1/synthetic/monitors`) instead of the
 * `builtin:synthetic_test` settings schema.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { NRSyntheticMonitorInput } from './synthetic.transformer.js';

export interface LegacyDTSyntheticMonitor {
  readonly name: string;
  readonly frequencyMin: number;
  readonly type: 'HTTP' | 'BROWSER' | 'HTTP_MULTI_STEP';
  readonly enabled: boolean;
  readonly locations: string[];
  readonly script: Record<string, unknown>;
  readonly tags: string[];
}

const LEGACY_WARNING =
  'Emitting Gen2 classic synthetic monitor (legacy). Default output uses the Gen3 `builtin:synthetic_test` settings schema — use SyntheticTransformer unless legacy parity is required.';

const PERIOD_TO_MIN: Record<string, number> = {
  EVERY_MINUTE: 1,
  EVERY_5_MINUTES: 5,
  EVERY_10_MINUTES: 10,
  EVERY_15_MINUTES: 15,
  EVERY_30_MINUTES: 30,
  EVERY_HOUR: 60,
  EVERY_6_HOURS: 360,
  EVERY_12_HOURS: 720,
  EVERY_DAY: 1440,
};

export class LegacySyntheticTransformer {
  transform(
    input: NRSyntheticMonitorInput,
  ): TransformResult<LegacyDTSyntheticMonitor> {
    try {
      const name = input.name ?? 'Unnamed Synthetic Monitor';
      const monitorType = input.monitorType ?? 'SIMPLE';
      const type = monitorType === 'SCRIPT_API' ? 'HTTP_MULTI_STEP' : monitorType === 'SIMPLE' ? 'HTTP' : 'BROWSER';
      const period = input.period ?? 'EVERY_5_MINUTES';
      const frequencyMin = PERIOD_TO_MIN[period] ?? 5;

      const warnings: string[] = [LEGACY_WARNING];
      const monitor: LegacyDTSyntheticMonitor = {
        name: `[Migrated Legacy] ${name}`,
        frequencyMin,
        type,
        enabled: (input.status ?? 'ENABLED') === 'ENABLED',
        locations: ['GEOLOCATION-US-EAST-1'],
        script:
          type === 'HTTP'
            ? {
                requests: [
                  {
                    method: 'GET',
                    url: input.monitoredUrl ?? '',
                    validation: {
                      rules: [{ type: 'httpStatusesList', value: '>=200, <400' }],
                    },
                  },
                ],
              }
            : { events: [] },
        tags: ['nr-migrated', 'legacy'],
      };

      if (type === 'BROWSER' || type === 'HTTP_MULTI_STEP') {
        warnings.push(
          'Browser / multi-step scripts are emitted as an empty events array; the Gen3 SyntheticTransformer has a richer clickpath converter that should be preferred when possible.',
        );
      }

      return success(monitor, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRSyntheticMonitorInput[],
  ): TransformResult<LegacyDTSyntheticMonitor>[] {
    return inputs.map((i) => this.transform(i));
  }
}
