/**
 * Prometheus Transformer — Converts NR Prometheus agent / remote-write
 * configuration to Dynatrace Prometheus remote-write settings.
 *
 * Gen3 output:
 *   - DT remote-write endpoint override (`/api/v2/metrics/ingest/prometheus`)
 *     with Api-Token auth header
 *   - Optional `builtin:prometheus.scrape` targets list for scrape-style
 *     ingestion via ActiveGate
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRPrometheusIntegrationInput {
  readonly name?: string;
  /** NR remote_write URL (customer-side). */
  readonly remoteWriteUrl?: string;
  /** Static scrape targets, e.g. ["node-exporter:9100", "kube-state:8080"]. */
  readonly scrapeTargets?: string[];
  /** metric_relabel_configs / write_relabel_configs — preserved as-is. */
  readonly relabelRules?: string[];
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTPrometheusRemoteWrite {
  readonly endpoint: string;
  readonly headers: Record<string, string>;
  readonly relabelRules: string[];
}

export interface DTPrometheusScrapeConfig {
  readonly schemaId: 'builtin:prometheus.scrape';
  readonly displayName: string;
  readonly targets: string[];
  readonly scrapeIntervalSeconds: number;
}

export interface PrometheusTransformData {
  readonly remoteWrite: DTPrometheusRemoteWrite;
  readonly scrapeConfig: DTPrometheusScrapeConfig | undefined;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Re-provision a DT API token with `metrics.ingest` scope and paste it into the remote-write `Authorization: Api-Token …` header.',
  'Replace `<env-id>` in the remote-write URL with your Dynatrace environment id.',
  'If scrape-style ingestion is needed, deploy an ActiveGate with the Prometheus extension enabled and point it at the target list.',
];

// ---------------------------------------------------------------------------
// PrometheusTransformer
// ---------------------------------------------------------------------------

export class PrometheusTransformer {
  transform(input: NRPrometheusIntegrationInput): TransformResult<PrometheusTransformData> {
    try {
      const warnings: string[] = [];
      const name = input.name ?? 'nr-prometheus-migrated';

      if (!input.remoteWriteUrl && !input.scrapeTargets?.length) {
        warnings.push(
          'Neither remote_write URL nor scrape targets provided; emitted a bare remote-write stub only.',
        );
      }

      const remoteWrite: DTPrometheusRemoteWrite = {
        endpoint: 'https://<env-id>.live.dynatrace.com/api/v2/metrics/ingest/prometheus',
        headers: { Authorization: 'Api-Token <dt-ingest-token>' },
        relabelRules: [...(input.relabelRules ?? [])],
      };

      const scrapeConfig: DTPrometheusScrapeConfig | undefined =
        input.scrapeTargets?.length
          ? {
              schemaId: 'builtin:prometheus.scrape',
              displayName: `[Migrated] ${name}`,
              targets: [...input.scrapeTargets],
              scrapeIntervalSeconds: 30,
            }
          : undefined;

      return success(
        { remoteWrite, scrapeConfig, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRPrometheusIntegrationInput[],
  ): TransformResult<PrometheusTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
