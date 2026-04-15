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
  /**
   * RFC 5545 recurrence rule string (e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR`).
   * When supplied it takes precedence over `recurrence` + `daysOfWeek`.
   */
  readonly rrule?: string;
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

const RRULE_DAY_MAP: Record<string, NRDayOfWeek> = {
  SU: 'SUNDAY',
  MO: 'MONDAY',
  TU: 'TUESDAY',
  WE: 'WEDNESDAY',
  TH: 'THURSDAY',
  FR: 'FRIDAY',
  SA: 'SATURDAY',
};

const RRULE_FREQ_MAP: Record<string, NRMaintenanceRecurrence> = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'MONTHLY', // closest DT equivalent; warn on encounter
};

/**
 * Parse an RFC 5545 RRULE string into the fields the DT schema needs.
 * Returns `undefined` when the rule is malformed. Unsupported parts
 * (BYMONTH, BYSETPOS, COUNT, INTERVAL≠1) emit warnings via `collectWarnings`.
 */
export function parseRrule(
  rrule: string,
  collectWarnings: (message: string) => void,
): { recurrence: NRMaintenanceRecurrence; daysOfWeek?: NRDayOfWeek[] } | undefined {
  if (!rrule || !/FREQ=/i.test(rrule)) return undefined;
  const parts: Record<string, string> = {};
  for (const chunk of rrule.split(';')) {
    const [rawK, rawV] = chunk.split('=');
    if (!rawK || !rawV) continue;
    parts[rawK.trim().toUpperCase()] = rawV.trim().toUpperCase();
  }

  const freq = parts['FREQ'];
  if (!freq || !RRULE_FREQ_MAP[freq]) {
    collectWarnings(`RRULE FREQ='${freq ?? '<missing>'}' is not supported; skipped.`);
    return undefined;
  }
  if (freq === 'YEARLY') {
    collectWarnings(
      'RRULE FREQ=YEARLY has no direct DT equivalent; downgraded to MONTHLY. Review the schedule manually.',
    );
  }

  const recurrence = RRULE_FREQ_MAP[freq];
  let daysOfWeek: NRDayOfWeek[] | undefined;
  if (parts['BYDAY']) {
    const days: NRDayOfWeek[] = [];
    for (const token of parts['BYDAY'].split(',')) {
      // Strip position prefix (e.g. "2MO" → "MO")
      const stripped = token.replace(/^[+-]?\d+/, '');
      const mapped = RRULE_DAY_MAP[stripped];
      if (mapped) days.push(mapped);
      else collectWarnings(`RRULE BYDAY token '${token}' not recognized; skipped.`);
    }
    if (days.length > 0) daysOfWeek = days;
  }

  if (parts['INTERVAL'] && parts['INTERVAL'] !== '1') {
    collectWarnings(
      `RRULE INTERVAL=${parts['INTERVAL']} is not honored by DT's scheduleType enum; emitted as single-step recurrence. Re-model as multiple windows if needed.`,
    );
  }
  for (const unsupported of ['BYMONTH', 'BYSETPOS', 'BYMONTHDAY', 'COUNT', 'UNTIL']) {
    if (parts[unsupported]) {
      collectWarnings(
        `RRULE ${unsupported}=${parts[unsupported]} has no DT equivalent; ignored.`,
      );
    }
  }

  return daysOfWeek ? { recurrence, daysOfWeek } : { recurrence };
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
      const rawName = input.name ?? input.kind;
      const name = rawName.startsWith('[Migrated') ? rawName : `[Migrated] ${rawName}`;
      const suppression = input.suppressionMode ?? 'DETECT_PROBLEMS_DONT_ALERT';

      let recurrence: NRMaintenanceRecurrence = input.recurrence ?? 'ONCE';
      let daysOfWeekFromRrule: NRDayOfWeek[] | undefined;
      if (input.rrule) {
        const parsed = parseRrule(input.rrule, (w) => warnings.push(w));
        if (parsed) {
          recurrence = parsed.recurrence;
          daysOfWeekFromRrule = parsed.daysOfWeek;
        }
      }

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
        ...(recurrence === 'WEEKLY' && (daysOfWeekFromRrule ?? input.daysOfWeek)
          ? { daysOfWeek: daysOfWeekFromRrule ?? input.daysOfWeek }
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
