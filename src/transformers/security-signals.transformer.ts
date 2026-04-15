/**
 * Security Signals Transformer — Converts NR Security Signals / IAST
 * config to Dynatrace Security Investigator bizevent ingest rules.
 *
 * NR Security Signals attach attribute-level threat indicators to
 * events; DT ingests them as bizevents with `event.category == "SECURITY"`
 * and a structured `security.*` attribute set.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRSecuritySignalSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface NRSecuritySignalRule {
  readonly name: string;
  readonly signalType: string;
  readonly severity?: NRSecuritySignalSeverity;
  readonly nrqlFilter?: string;
  readonly enabled?: boolean;
}

export interface NRSecuritySignalsInput {
  readonly rules: NRSecuritySignalRule[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTSecurityBizeventRule {
  readonly schemaId: 'builtin:openpipeline.bizevents.pipelines';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly matcher: string;
  readonly fieldsAdd: Array<{ field: string; value: string }>;
}

export interface SecuritySignalsTransformData {
  readonly rules: DTSecurityBizeventRule[];
  readonly manualSteps: string[];
}

const MANUAL_STEPS: string[] = [
  'DT Security Investigator consumes bizevents with event.category="SECURITY"; the emitted rules tag each signal accordingly.',
  'If NR Security Signals fed into an external SOAR, point the DT Workflow engine at the same SOAR endpoint using NotificationTransformer output.',
  'Review NRQL filters embedded in each rule — they must be compiled via nrql-engine and verified against Grail before enabling.',
];

// ---------------------------------------------------------------------------
// SecuritySignalsTransformer
// ---------------------------------------------------------------------------

export class SecuritySignalsTransformer {
  transform(
    input: NRSecuritySignalsInput,
  ): TransformResult<SecuritySignalsTransformData> {
    try {
      if (!Array.isArray(input.rules) || input.rules.length === 0) {
        return failure(['At least one security signal rule is required']);
      }
      const warnings: string[] = [];

      const rules: DTSecurityBizeventRule[] = input.rules.map((r) => {
        if (r.nrqlFilter) {
          warnings.push(
            `Security signal '${r.name}' has an NRQL filter; compile it via nrql-engine and replace the matcher TODO before enabling.`,
          );
        }
        const filterDpl = r.nrqlFilter
          ? `/* NRQL TODO: ${r.nrqlFilter} */ true`
          : 'true';
        return {
          schemaId: 'builtin:openpipeline.bizevents.pipelines',
          displayName: `[Migrated Security] ${r.name}`,
          enabled: r.enabled ?? true,
          matcher: `matchesValue(event.type, "${r.signalType}") and (${filterDpl})`,
          fieldsAdd: [
            { field: 'event.category', value: 'SECURITY' },
            { field: 'security.signal.name', value: r.name },
            { field: 'security.signal.type', value: r.signalType },
            { field: 'security.severity', value: r.severity ?? 'INFO' },
          ],
        };
      });

      return success({ rules, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRSecuritySignalsInput[],
  ): TransformResult<SecuritySignalsTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
