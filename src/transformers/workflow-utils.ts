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

/**
 * Gen3 workflow that fires on Davis events raised by the migrated
 * `builtin:davis.anomaly-detectors` objects (matched by detector id).
 * Shape mirrors the Python `AlertTransformer` / `NonNRQLAlertTransformer`
 * output, including the snake_case `davis_event` trigger config key.
 */
export interface DTDavisEventWorkflow {
  readonly title: string;
  readonly description: string;
  readonly private: boolean;
  readonly isPrivate?: boolean;
  readonly trigger: {
    readonly event: {
      readonly active: boolean;
      readonly config: {
        readonly davis_event: {
          readonly eventType: 'CUSTOM_ALERT';
          readonly detectorIds: string[];
          readonly anyEventMatches: boolean;
          readonly eventProperties?: Record<string, string>;
        };
      };
    };
  };
  readonly tasks: Record<string, DTWorkflowTaskDefinition>;
  readonly migratedFrom?: {
    readonly type: 'newrelic.severity_ladder';
    readonly severity: string;
    readonly delayMinutes: number;
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
