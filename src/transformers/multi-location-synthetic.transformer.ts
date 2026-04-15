/**
 * Multi-Location Synthetic Condition Transformer — NR's multi-location
 * alert condition fires when at least N of M locations report a
 * failure simultaneously. DT's standard Metric Event is single-scope,
 * so the translation emits:
 *   - A DQL aggregation over `fetch dt.synthetic.http.request` that
 *     counts failed locations per run
 *   - A Metric Event bound to that DQL with `violatingSamples = N`
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRMultiLocationSyntheticInput {
  readonly name?: string;
  readonly monitorName: string;
  readonly totalLocations: number;
  readonly failingLocationThreshold: number;
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTMultiLocationMetricEvent {
  readonly schemaId: 'builtin:anomaly-detection.metric-events';
  readonly summary: string;
  readonly enabled: boolean;
  readonly queryDefinition: {
    readonly type: 'DQL';
    readonly query: string;
  };
  readonly monitoringStrategy: {
    readonly type: 'STATIC_THRESHOLD';
    readonly alertCondition: 'ABOVE';
    readonly threshold: number;
    readonly samples: number;
    readonly violatingSamples: number;
  };
  readonly eventTemplate: {
    readonly title: string;
    readonly description: string;
  };
}

export interface MultiLocationSyntheticTransformData {
  readonly metricEvent: DTMultiLocationMetricEvent;
  readonly manualSteps: string[];
}

const MANUAL_STEPS: string[] = [
  'The emitted DQL counts failing locations per minute; tune the evaluation interval via the Metric Event aggregationWindow if your monitor runs less frequently.',
  'If the NR rule also suppressed alerts below a minimum-run-count, mirror that via a secondary DQL filter on `totalRuns >= N` before the threshold check.',
];

// ---------------------------------------------------------------------------
// MultiLocationSyntheticTransformer
// ---------------------------------------------------------------------------

export class MultiLocationSyntheticTransformer {
  transform(
    input: NRMultiLocationSyntheticInput,
  ): TransformResult<MultiLocationSyntheticTransformData> {
    try {
      if (!input.monitorName?.trim()) {
        return failure(['monitorName is required']);
      }
      if (input.failingLocationThreshold > input.totalLocations) {
        return failure([
          `failingLocationThreshold (${input.failingLocationThreshold}) cannot exceed totalLocations (${input.totalLocations})`,
        ]);
      }
      const warnings: string[] = [];

      const name = input.name ?? `Multi-location: ${input.monitorName}`;
      const query =
        `fetch dt.synthetic.http.request, from:-5m\n` +
        `| filter monitor.name == "${input.monitorName}"\n` +
        `| filter success == false\n` +
        `| summarize failingLocations = countDistinctExact(location.id), by: { bin(timestamp, 1m) }`;

      const metricEvent: DTMultiLocationMetricEvent = {
        schemaId: 'builtin:anomaly-detection.metric-events',
        summary: `[Migrated MultiLocation] ${name}`,
        enabled: input.enabled ?? true,
        queryDefinition: { type: 'DQL', query },
        monitoringStrategy: {
          type: 'STATIC_THRESHOLD',
          alertCondition: 'ABOVE',
          threshold: input.failingLocationThreshold - 1,
          samples: 3,
          violatingSamples: 1,
        },
        eventTemplate: {
          title: `[MultiLocation] ${input.monitorName}`,
          description: `At least ${input.failingLocationThreshold} of ${input.totalLocations} locations report failure for monitor "${input.monitorName}".`,
        },
      };

      return success(
        { metricEvent, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRMultiLocationSyntheticInput[],
  ): TransformResult<MultiLocationSyntheticTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
