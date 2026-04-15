/**
 * Prometheus Transformer — Converts NR Prometheus agent / remote-write
 * configuration to Dynatrace Prometheus remote-write settings + OpenPipeline
 * metric-processing rules translated from Prometheus relabel_configs.
 *
 * Gen3 output:
 *   - DT remote-write endpoint override (`/api/v2/metrics/ingest/prometheus`)
 *     with Api-Token auth header
 *   - Optional `builtin:prometheus.scrape` targets list for scrape-style
 *     ingestion via ActiveGate
 *   - OpenPipeline metric-processing rules translated from the NR
 *     `metric_relabel_configs` / `write_relabel_configs` array:
 *       action=drop   → `builtin:openpipeline.metrics.drop`    matcher
 *       action=keep   → inverse-match drop (keep-list)
 *       action=replace → `builtin:openpipeline.metrics.transform` fieldsAdd
 *       action=labeldrop → fieldsRemove
 *       action=labelkeep → fieldsRemove inverse
 *       action=labelmap  → fieldsRename via regex capture
 *       action=hashmod   → flagged unsupported (no DPL equivalent)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PrometheusRelabelAction =
  | 'replace'
  | 'keep'
  | 'drop'
  | 'hashmod'
  | 'labelmap'
  | 'labeldrop'
  | 'labelkeep';

/** One Prometheus relabel_configs entry, in its native YAML-shape object form. */
export interface PrometheusRelabelConfig {
  readonly source_labels?: string[];
  readonly separator?: string;
  readonly regex?: string;
  readonly replacement?: string;
  readonly target_label?: string;
  readonly modulus?: number;
  readonly action?: PrometheusRelabelAction;
}

export interface NRPrometheusIntegrationInput {
  readonly name?: string;
  /** NR remote_write URL (customer-side). */
  readonly remoteWriteUrl?: string;
  /** Static scrape targets, e.g. ["node-exporter:9100", "kube-state:8080"]. */
  readonly scrapeTargets?: string[];
  /**
   * Structured relabel configs. Accepts either the YAML-native object form
   * (preferred) or raw string form (preserved unchanged in the remote-write
   * output for reference; no DPL translation performed on strings).
   */
  readonly relabelConfigs?: PrometheusRelabelConfig[];
  /** Raw relabel snippets preserved for reference. */
  readonly relabelRules?: string[];
  /** Which relabel stage applied: `metric` (after scrape) or `write` (before remote-write). */
  readonly relabelStage?: 'metric' | 'write';
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

export type DTOpenPipelineMetricRule =
  | {
      readonly schemaId: 'builtin:openpipeline.metrics.drop';
      readonly displayName: string;
      readonly matcher: string;
    }
  | {
      readonly schemaId: 'builtin:openpipeline.metrics.transform';
      readonly displayName: string;
      readonly matcher: string;
      readonly fieldsAdd?: Array<{ field: string; value: string }>;
      readonly fieldsRemove?: string[];
      readonly fieldsRename?: Array<{ from: string; to: string }>;
    };

export interface PrometheusTransformData {
  readonly remoteWrite: DTPrometheusRemoteWrite;
  readonly scrapeConfig: DTPrometheusScrapeConfig | undefined;
  readonly openPipelineRules: DTOpenPipelineMetricRule[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Re-provision a DT API token with `metrics.ingest` scope and paste it into the remote-write `Authorization: Api-Token …` header.',
  'Replace `<env-id>` in the remote-write URL with your Dynatrace environment id.',
  'If scrape-style ingestion is needed, deploy an ActiveGate with the Prometheus extension enabled and point it at the target list.',
  'Review the generated OpenPipeline metric rules — Prometheus regex flavor (RE2) is close to but not identical to DPL regex. Test each rule against a sample metric payload.',
];

function joinSourceLabels(labels: string[] | undefined, separator: string | undefined): string {
  const sep = separator ?? ';';
  const src = labels ?? ['__name__'];
  if (src.length === 1) {
    return src[0]!;
  }
  // DPL concat of labels with the configured separator
  return src.map((l) => `toString(${l})`).join(` + "${sep}" + `);
}

function translateRelabel(
  cfg: PrometheusRelabelConfig,
  index: number,
): { rule?: DTOpenPipelineMetricRule; warning?: string } {
  const action: PrometheusRelabelAction = cfg.action ?? 'replace';
  const name = `relabel_${index}_${action}`;
  const srcExpr = joinSourceLabels(cfg.source_labels, cfg.separator);
  const regex = cfg.regex ?? '(.*)';

  switch (action) {
    case 'drop':
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.drop',
          displayName: name,
          matcher: `matchesValue(${srcExpr}, "${regex}")`,
        },
      };
    case 'keep':
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.drop',
          displayName: `${name} (inverse: drop non-matches)`,
          matcher: `not matchesValue(${srcExpr}, "${regex}")`,
        },
      };
    case 'replace':
      if (!cfg.target_label) {
        return {
          warning: `relabel #${index} action=replace missing target_label; skipped.`,
        };
      }
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.transform',
          displayName: name,
          matcher: `matchesValue(${srcExpr}, "${regex}")`,
          fieldsAdd: [
            {
              field: cfg.target_label,
              value: cfg.replacement ?? '$1',
            },
          ],
        },
      };
    case 'labeldrop':
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.transform',
          displayName: name,
          matcher: 'true',
          fieldsRemove: [regex], // pattern, evaluated per-field at runtime
        },
      };
    case 'labelkeep':
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.transform',
          displayName: `${name} (keep only matching labels)`,
          matcher: 'true',
          fieldsRemove: [`^(?!${regex}$).*$`],
        },
      };
    case 'labelmap':
      return {
        rule: {
          schemaId: 'builtin:openpipeline.metrics.transform',
          displayName: name,
          matcher: 'true',
          fieldsRename: [
            {
              from: regex,
              to: cfg.replacement ?? '$1',
            },
          ],
        },
      };
    case 'hashmod':
      return {
        warning: `relabel #${index} action=hashmod has no DPL equivalent (Prometheus hashes source_labels mod ${cfg.modulus ?? '?'}); handle manually if load-balancing scrapes is required.`,
      };
    default:
      return {
        warning: `relabel #${index} action='${action as string}' not recognized; skipped.`,
      };
  }
}

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

      const openPipelineRules: DTOpenPipelineMetricRule[] = [];
      const configs = input.relabelConfigs ?? [];
      configs.forEach((cfg, i) => {
        const { rule, warning } = translateRelabel(cfg, i);
        if (rule) openPipelineRules.push(rule);
        if (warning) warnings.push(warning);
      });

      return success(
        { remoteWrite, scrapeConfig, openPipelineRules, manualSteps: MANUAL_STEPS },
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
