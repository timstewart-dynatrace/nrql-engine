/**
 * Maintenance Window Transformer — Converts New Relic maintenance
 * windows (scheduled + recurring) and mute rules to Dynatrace Gen3
 * maintenance windows (schema `builtin:alerting.maintenance-window`).
 *
 * Gen3 shape mirrors the `dynatrace_maintenance` Terraform resource:
 * generalProperties + schedule (ONCE | WEEKLY | DAILY | MONTHLY).
 *
 * Mute rules (NRQL-based) are translated to a maintenance window with
 * an embedded filter segment and a warning flagging that Dynatrace has
 * no direct "mute on matching NRQL" concept — suppression relies on
 * problem-filter rules inside the Workflow, not on a maintenance window.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRMaintenanceKind = 'SCHEDULED' | 'MUTE_RULE';
export type NRMaintenanceRecurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type NRDayOfWeek =
  | 'SUNDAY'
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY';

export interface NRMaintenanceWindowInput {
  readonly name?: string;
  readonly kind: NRMaintenanceKind;
  readonly enabled?: boolean;
  readonly recurrence?: NRMaintenanceRecurrence;
  readonly startDate?: string; // ISO date
  readonly endDate?: string;
  readonly startTime?: string; // HH:MM (24h)
  readonly endTime?: string;
  readonly timezone?: string;
  readonly daysOfWeek?: NRDayOfWeek[];
  /** Only set for MUTE_RULE kind. */
  readonly muteNrql?: string;
  readonly suppressionMode?: 'DETECT_PROBLEMS_DONT_ALERT' | 'DONT_DETECT_PROBLEMS';
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export type DTSuppressionMode = 'DETECT_PROBLEMS_DONT_ALERT' | 'DONT_DETECT_PROBLEMS';

export interface DTMaintenanceWindow {
  readonly schemaId: 'builtin:alerting.maintenance-window';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly generalProperties: {
    readonly name: string;
    readonly type: 'PLANNED' | 'UNPLANNED';
    readonly suppression: DTSuppressionMode;
  };
  readonly schedule: {
    readonly scheduleType: NRMaintenanceRecurrence;
    readonly timeZone: string;
    readonly timeWindow: { readonly startTime: string; readonly endTime: string };
    readonly recurrenceRange: { readonly startDate: string; readonly endDate?: string };
    readonly daysOfWeek?: NRDayOfWeek[];
  };
  readonly filterSegmentDql?: string;
}

export interface MaintenanceWindowTransformData {
  readonly window: DTMaintenanceWindow;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'If this was an NR mute rule, Dynatrace has no direct equivalent. The emitted maintenance window suppresses globally for the matched time window; scope it with a filter segment or move the suppression into a Workflow problem-filter rule if finer control is needed.',
  'Verify the timezone — NR maintenance windows often default to the account timezone; DT expects IANA timezone strings (e.g. America/New_York).',
];

function defaultWindow(): string {
  const now = new Date().toISOString().slice(0, 10);
  return now;
}

// ---------------------------------------------------------------------------
// MaintenanceWindowTransformer
// ---------------------------------------------------------------------------

export class MaintenanceWindowTransformer {
  transform(
    input: NRMaintenanceWindowInput,
  ): TransformResult<MaintenanceWindowTransformData> {
    try {
      if (!input.kind) {
        return failure(['kind (SCHEDULED | MUTE_RULE) is required']);
      }
      const warnings: string[] = [];
      const name = input.name ?? `[Migrated ${input.kind}]`;
      const recurrence = input.recurrence ?? 'ONCE';
      const suppression = input.suppressionMode ?? 'DETECT_PROBLEMS_DONT_ALERT';

      if (input.kind === 'MUTE_RULE' && !input.muteNrql) {
        warnings.push('MUTE_RULE without NRQL — emitted a global maintenance window.');
      }

      const filterSegmentDql = input.muteNrql
        ? `// NRQL source: ${input.muteNrql}\n// TODO: compile via nrql-engine and place in a filter segment`
        : undefined;

      const startDate = input.startDate ?? defaultWindow();
      const startTime = input.startTime ?? '02:00';
      const endTime = input.endTime ?? '04:00';
      const timeZone = input.timezone ?? 'UTC';

      const schedule: DTMaintenanceWindow['schedule'] = {
        scheduleType: recurrence,
        timeZone,
        timeWindow: { startTime, endTime },
        recurrenceRange: {
          startDate,
          ...(input.endDate ? { endDate: input.endDate } : {}),
        },
        ...(recurrence === 'WEEKLY' && input.daysOfWeek
          ? { daysOfWeek: input.daysOfWeek }
          : {}),
      };

      const window: DTMaintenanceWindow = {
        schemaId: 'builtin:alerting.maintenance-window',
        displayName: name,
        enabled: input.enabled ?? true,
        generalProperties: {
          name,
          type: 'PLANNED',
          suppression,
        },
        schedule,
        ...(filterSegmentDql ? { filterSegmentDql } : {}),
      };

      return success({ window, manualSteps: MANUAL_STEPS }, [...warnings, ...MANUAL_STEPS]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRMaintenanceWindowInput[],
  ): TransformResult<MaintenanceWindowTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
