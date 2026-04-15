/**
 * StatsD Transformer — Converts NR StatsD ingestion config to Dynatrace
 * StatsD settings (via ActiveGate extension).
 *
 * Gen3 output:
 *   - `builtin:statsd.ingest` settings with host/port bindings and the
 *     DT `<env-id>` endpoint for relaying metrics
 *   - Metric tag / dimension remapping carried over from NR config
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRStatsdInput {
  readonly name?: string;
  readonly listenPort?: number;
  readonly protocol?: 'udp' | 'tcp';
  readonly flushIntervalSeconds?: number;
  /** NR StatsD dimension/tag mapping (tag_name → attribute_name). */
  readonly tagMappings?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTStatsdIngest {
  readonly schemaId: 'builtin:statsd.ingest';
  readonly displayName: string;
  readonly listenPort: number;
  readonly protocol: 'udp' | 'tcp';
  readonly flushIntervalSeconds: number;
  readonly dimensionMappings: Record<string, string>;
  readonly forwardEndpoint: string;
}

export interface StatsdTransformData {
  readonly ingest: DTStatsdIngest;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Deploy an ActiveGate with the StatsD extension enabled. NR StatsD agents cannot relay to DT directly.',
  'Re-provision a DT API token with `metrics.ingest` scope.',
  'Replace `<env-id>` in the forward endpoint with your Dynatrace environment id.',
  'Point StatsD client libraries at the ActiveGate host on the configured listenPort.',
];

// ---------------------------------------------------------------------------
// StatsDTransformer
// ---------------------------------------------------------------------------

export class StatsDTransformer {
  transform(input: NRStatsdInput): TransformResult<StatsdTransformData> {
    try {
      const name = input.name ?? 'nr-statsd-migrated';
      const listenPort = input.listenPort ?? 8125;
      const protocol = input.protocol ?? 'udp';

      const ingest: DTStatsdIngest = {
        schemaId: 'builtin:statsd.ingest',
        displayName: `[Migrated] ${name}`,
        listenPort,
        protocol,
        flushIntervalSeconds: input.flushIntervalSeconds ?? 10,
        dimensionMappings: { ...(input.tagMappings ?? {}) },
        forwardEndpoint: 'https://<env-id>.live.dynatrace.com/api/v2/metrics/ingest',
      };

      return success({ ingest, manualSteps: MANUAL_STEPS }, MANUAL_STEPS);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(inputs: NRStatsdInput[]): TransformResult<StatsdTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
