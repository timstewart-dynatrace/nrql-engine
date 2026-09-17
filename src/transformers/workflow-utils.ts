/**
 * Shared helpers for Gen3 Automation workflow emission.
 *
 * The Gen3 Automation API (`/platform/automation/v1/workflows`) expects
 * `tasks` as a **dict keyed by task id**, not a list. Sending a list
 * produces `{"tasks": ["Input should be a valid dictionary"]}`.
 *
 * Mirrors Python `transformers/_workflow_utils.py` in
 * NewRelic-to-Dynatrace-Migration-Utilities.
 */

/** A Gen3 workflow task definition (value side of the `tasks` dict). */
export interface DTWorkflowTaskDefinition {
  readonly name: string;
  readonly action: string;
  readonly active: boolean;
  readonly description: string;
  readonly input: Record<string, unknown>;
  readonly position?: { readonly x: number; readonly y: number };
  readonly filter?: string;
}

/** Davis problem categories accepted by the `davis-problem` trigger. */
export const PROBLEM_CATEGORIES = [
  'availability',
  'error',
  'slowdown',
  'resource',
  'custom',
  'monitoringUnavailable',
] as const;

export type DTProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/**
 * Automation workflow trigger for Davis problems — the shape every
 * event-triggered workflow on a live Gen3 tenant uses
 * (`trigger.eventTrigger.triggerConfiguration`). There is no
 * `detectorIds` / `davis_event` field (live validation D4).
 */
export interface DTDavisProblemTrigger {
  readonly eventTrigger: {
    readonly isActive: boolean;
    readonly triggerConfiguration: {
      readonly type: 'davis-problem';
      readonly value: {
        readonly analysisReady: boolean;
        readonly categories: Readonly<Record<DTProblemCategory, boolean>>;
        readonly customFilter: string;
        readonly entityTags: Readonly<Record<string, string>>;
        readonly entityTagsMatch: 'all';
        readonly onProblemClose: boolean;
      };
    };
  };
}

/**
 * Gen3 Automation workflow fired by Davis problems raised from migrated
 * detectors. Linkage is by event name (`migratedEventFilter`); `tasks` is a
 * dict keyed by task id.
 */
export interface DTDavisProblemWorkflow<
  T extends { readonly name?: string } = DTWorkflowTaskDefinition,
> {
  readonly title: string;
  readonly description: string;
  readonly isPrivate: boolean;
  readonly trigger: DTDavisProblemTrigger;
  readonly tasks: Record<string, T>;
}

/** @deprecated Renamed to `DTDavisProblemWorkflow` (the trigger is now `davis-problem`). */
export type DTDavisEventWorkflow = DTDavisProblemWorkflow;

// ---------------------------------------------------------------------------
// Detector <-> workflow linkage (davis-problem trigger)
// ---------------------------------------------------------------------------
//
// Verified live (live-validation 2026-09, D3/D4):
// * Problem records do not carry detector `eventTemplate.properties`, but a
//   problem's `event.name` equals its contributing detector event's name.
//   Linkage is therefore by event-name prefix.
// * Workflow customFilter accepts `matchesValue()` wildcards; `startsWith()` is
//   not enabled for OpenPipeline matchers.

export const MIGRATED_EVENT_PREFIX = '[Migrated]';

/** NR severity-ladder severities that correspond to Davis problem categories. */
const SEVERITY_TO_CATEGORY: Readonly<Record<string, DTProblemCategory>> = {
  AVAILABILITY: 'availability',
  ERROR: 'error',
  SLOWDOWN: 'slowdown',
  PERFORMANCE: 'slowdown',
  RESOURCE: 'resource',
  RESOURCE_CONTENTION: 'resource',
  CUSTOM: 'custom',
  CUSTOM_ALERT: 'custom',
};

function linkGroup(group: string): string {
  // `*` is a matchesValue wildcard and cannot be escaped, so keep it out of
  // linkage names.
  return group.replace(/\*/g, '-');
}

/** Davis event (and resulting problem) name for a migrated detector. */
export function migratedEventName(group: string, item: string): string {
  return `${MIGRATED_EVENT_PREFIX} ${linkGroup(group)} | ${item}`;
}

/** customFilter matching every problem raised by detectors in `group`. */
export function migratedEventFilter(group: string): string {
  const prefix = `${MIGRATED_EVENT_PREFIX} ${linkGroup(group)} | `
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `matchesValue(event.name, "${prefix}*")`;
}

/** Automation workflow trigger for Davis problems (mirrors Python `davis_problem_trigger`). */
export function davisProblemTrigger(
  customFilter = '',
  opts: {
    readonly severity?: string;
    readonly entityTags?: Readonly<Record<string, string>>;
    readonly active?: boolean;
    readonly warnings?: string[];
  } = {},
): DTDavisProblemTrigger {
  let categories = Object.fromEntries(PROBLEM_CATEGORIES.map((c) => [c, true])) as Record<
    DTProblemCategory,
    boolean
  >;
  if (opts.severity) {
    const category = SEVERITY_TO_CATEGORY[opts.severity.toUpperCase()];
    if (category) {
      categories = Object.fromEntries(
        PROBLEM_CATEGORIES.map((c) => [c, c === category]),
      ) as Record<DTProblemCategory, boolean>;
    } else {
      opts.warnings?.push(
        `NR severity '${opts.severity}' has no Davis problem category; workflow ` +
          'triggers on all categories.',
      );
    }
  }
  return {
    eventTrigger: {
      isActive: opts.active ?? true,
      triggerConfiguration: {
        type: 'davis-problem',
        value: {
          analysisReady: false,
          categories,
          customFilter,
          entityTags: { ...(opts.entityTags ?? {}) },
          entityTagsMatch: 'all',
          onProblemClose: false,
        },
      },
    },
  };
}

function slugTaskId(name: string, fallback: string): string {
  const slug = (name ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug || fallback;
}

/**
 * Convert an ordered list of task definitions to the Gen3 `tasks` dict.
 * Keys derive from each task's `name`; collisions get a numeric suffix
 * (`send_email`, `send_email_2`, ...). Insertion order is preserved.
 */
export function tasksListToDict<T extends { readonly name?: string }>(
  tasks: readonly T[] | Record<string, T>,
): Record<string, T> {
  if (!Array.isArray(tasks)) return tasks as Record<string, T>; // idempotent
  const out: Record<string, T> = {};
  tasks.forEach((task, idx) => {
    const baseId = slugTaskId(task.name ?? '', `task_${idx}`);
    let taskId = baseId;
    let bump = 2;
    while (Object.prototype.hasOwnProperty.call(out, taskId)) {
      taskId = `${baseId}_${bump}`;
      bump += 1;
    }
    out[taskId] = task;
  });
  return out;
}
