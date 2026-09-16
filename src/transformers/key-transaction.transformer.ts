/**
 * Key Transaction Transformer — Converts NR Key Transactions to a
 * Dynatrace synthesized package: Platform SLO + Workflow.
 *
 * NR "Key Transactions" wrap a named SLA around a specific transaction
 * (e.g. checkout.submit). DT has no direct "Key Transaction" object;
 * the usual playbook is:
 *   1. Emit a Platform SLO (`/platform/slo/v1/slos`) with a DQL latency
 *      SLI on the application's service using the NR threshold.
 *   2. Tag the service with ownership / criticality (manual step — Gen3
 *      ownership is a `owner` / `dt.owner` key-value tag on the entity,
 *      not a `builtin:ownership.teams` object).
 *   3. Emit a companion Workflow (davis_problem trigger) that fires when
 *      the SLO's burn-rate crosses threshold, tagged with
 *      `nr-migrated=<slug>` so NotificationTransformer output can slot
 *      into it later.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { DTWorkflow } from './alert.transformer.js';
import { buildPlatformSlo, latencyIndicator, type DTPlatformSlo } from './slo-utils.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRKeyTransactionInput {
  readonly name?: string;
  readonly applicationName?: string;
  readonly transactionName?: string;
  /** Apdex T-value in seconds. */
  readonly apdexTarget?: number;
  /** SLA response-time threshold in ms. */
  readonly responseTimeThresholdMs?: number;
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Gen3 Platform SLO request body (was classic builtin:monitoring.slo). */
export type DTKeyTxSlo = DTPlatformSlo;

export interface KeyTransactionTransformData {
  readonly slo: DTKeyTxSlo;
  readonly workflow: DTWorkflow;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'key-tx';
}

const MANUAL_STEPS: string[] = [
  'Review the emitted SLO target — it is derived from NR Apdex T-value or response-time threshold; some key transactions may need a custom DQL indicator (e.g. spans filtered to the endpoint).',
  'Wire NotificationTransformer output into the emitted Workflow.tasks array so SLO burn-rate problems route to on-call.',
  'If the key transaction covered a specific endpoint (not whole service), narrow the SLO indicator (e.g. fetch spans | filter endpoint.name == "…").',
  "Mark the service as owned/critical with Gen3 ownership tags (key `owner` or `dt.owner`, value = team identifier) and a criticality tag, via Kubernetes labels, host properties, DT_CUSTOM_PROP, or the Custom tags API. The Workflow filters on the `nr-migrated=<slug>` tag, which must also be applied.",
];

// ---------------------------------------------------------------------------
// KeyTransactionTransformer
// ---------------------------------------------------------------------------

export class KeyTransactionTransformer {
  transform(
    input: NRKeyTransactionInput,
  ): TransformResult<KeyTransactionTransformData> {
    try {
      const name = input.name?.trim();
      if (!name) return failure(['Key Transaction name is required']);
      const tag = slug(name);
      const appName = input.applicationName ?? name;

      const warnings: string[] = [];

      // SLO: share of time within the NR response-time threshold. Prefer the
      // explicit SLA threshold, then the Apdex T-value, then 500ms (Apdex 0.5).
      const target = 95;
      const thresholdMs =
        input.responseTimeThresholdMs ??
        (input.apdexTarget !== undefined ? Math.round(input.apdexTarget * 1000) : 500);
      if (input.responseTimeThresholdMs) {
        warnings.push(
          `Response-time threshold ${input.responseTimeThresholdMs}ms is encoded in the SLO indicator (latency bucket); tune target/warning once you have historical data.`,
        );
      }

      const slo: DTKeyTxSlo = buildPlatformSlo({
        name: `[Migrated KeyTx] ${name}`,
        description: `Migrated from NR Key Transaction '${name}' on application '${appName}'.`,
        target,
        indicator: latencyIndicator(thresholdMs, { serviceName: appName }),
        timeframeFrom: 'now-7d',
        tags: ['MigratedFromNR:true', `key_transaction:${tag}`],
      });

      const workflow: DTWorkflow = {
        title: `[Migrated KeyTx] ${name}`,
        description: `Fires when the SLO for key transaction '${name}' burns budget.`,
        isPrivate: false,
        trigger: {
          event: {
            active: input.enabled ?? true,
            config: {
              davisProblem: {
                categories: {
                  availability: true,
                  error: true,
                  slowdown: true,
                  resource: false,
                  custom: false,
                  monitoringUnavailable: false,
                },
                entityTags: { 'nr-migrated': tag },
                entityTagsMatch: 'all',
              },
            },
          },
        },
        tasks: [],
      };

      return success(
        { slo, workflow, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRKeyTransactionInput[],
  ): TransformResult<KeyTransactionTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
