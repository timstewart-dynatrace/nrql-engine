/**
 * Key Transaction Transformer — Converts NR Key Transactions to a
 * Dynatrace synthesized package: entity tag + SLO + Workflow.
 *
 * NR "Key Transactions" wrap a named SLA around a specific transaction
 * (e.g. checkout.submit). DT has no direct "Key Transaction" object;
 * the usual playbook is:
 *   1. Mark the affected entity (service / request) with a critical tag
 *      so it surfaces at the top of the Services app.
 *   2. Emit an SLO (`builtin:monitoring.slo`) bound to that entity's
 *      response-time / apdex signal using the NR threshold + window.
 *   3. Emit a companion Workflow (davis_problem trigger) that fires when
 *      the SLO's burn-rate crosses threshold, tagged with
 *      `nr-migrated=<slug>` so NotificationTransformer output can slot
 *      into it later.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type { DTWorkflow } from './alert.transformer.js';

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

export interface DTCriticalServiceTag {
  readonly schemaId: 'builtin:ownership.teams';
  readonly tag: { readonly key: 'critical-service'; readonly value: string };
  readonly entitySelector: string;
}

export interface DTKeyTxSlo {
  readonly schemaId: 'builtin:monitoring.slo';
  readonly name: string;
  readonly description: string;
  readonly metricExpression: string;
  readonly target: number;
  readonly warning: number;
  readonly evaluationWindow: string;
  readonly filter: string;
}

export interface KeyTransactionTransformData {
  readonly criticalServiceTag: DTCriticalServiceTag;
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
  'Review the emitted SLO target — it is derived from NR Apdex T-value or response-time threshold; some key transactions may need a custom DQL expression beyond `builtin:service.response.time`.',
  'Wire NotificationTransformer output into the emitted Workflow.tasks array so SLO burn-rate problems route to on-call.',
  'If the key transaction covered a specific endpoint (not whole service), narrow the SLO filter via an additional entityName(…) clause.',
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

      // SLO target: if apdex T is given, target 95% of requests under T.
      // Otherwise derive a latency SLO from the NR responseTimeThresholdMs.
      let target = 95;
      const warning = 99;
      let metricExpression = 'builtin:service.response.time';
      if (input.responseTimeThresholdMs) {
        target = 95; // same default; consumer can tune
        warnings.push(
          `Response-time threshold ${input.responseTimeThresholdMs}ms is encoded in the SLO filter (latency bucket); tune target/warning once you have historical data.`,
        );
      }
      if (input.apdexTarget) {
        metricExpression = 'builtin:service.response.time';
      }

      const sloFilter = `type(SERVICE),entityName(${JSON.stringify(appName)})`;

      const criticalServiceTag: DTCriticalServiceTag = {
        schemaId: 'builtin:ownership.teams',
        tag: { key: 'critical-service', value: tag },
        entitySelector: sloFilter,
      };

      const slo: DTKeyTxSlo = {
        schemaId: 'builtin:monitoring.slo',
        name: `[Migrated KeyTx] ${name}`,
        description: `Migrated from NR Key Transaction '${name}' on application '${appName}'.`,
        metricExpression,
        target,
        warning,
        evaluationWindow: '-7d',
        filter: sloFilter,
      };

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
                entityTags: { 'nr-migrated': tag, 'critical-service': tag },
                entityTagsMatch: 'all',
              },
            },
          },
        },
        tasks: [],
      };

      return success(
        { criticalServiceTag, slo, workflow, manualSteps: MANUAL_STEPS },
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
