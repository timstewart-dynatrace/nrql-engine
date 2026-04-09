/**
 * Entity mapping rules between New Relic and Dynatrace.
 *
 * Defines comprehensive mappings including field mappings, value transformations,
 * and default values used by all transformers.
 */

// ---------------------------------------------------------------------------
// Transformation types
// ---------------------------------------------------------------------------

export type TransformationType = 'direct' | 'mapped' | 'computed' | 'template' | 'custom';

export interface FieldMapping {
  readonly sourceField: string;
  readonly targetField: string;
  readonly transformation: TransformationType;
  readonly valueMap?: Record<string, unknown>;
  readonly defaultValue?: unknown;
  readonly required: boolean;
}

export interface EntityMapping {
  readonly sourceType: string;
  readonly targetType: string;
  readonly fieldMappings: FieldMapping[];
}

// ---------------------------------------------------------------------------
// Value mappings
// ---------------------------------------------------------------------------

/** New Relic visualization type to Dynatrace tile type */
export const VISUALIZATION_TYPE_MAP: Record<string, string> = {
  'viz.line': 'DATA_EXPLORER',
  'viz.area': 'DATA_EXPLORER',
  'viz.bar': 'DATA_EXPLORER',
  'viz.billboard': 'SINGLE_VALUE',
  'viz.pie': 'DATA_EXPLORER',
  'viz.table': 'DATA_EXPLORER',
  'viz.markdown': 'MARKDOWN',
  'viz.json': 'DATA_EXPLORER',
  'viz.bullet': 'DATA_EXPLORER',
  'viz.funnel': 'DATA_EXPLORER',
  'viz.heatmap': 'DATA_EXPLORER',
  'viz.histogram': 'DATA_EXPLORER',
  'viz.stacked-bar': 'DATA_EXPLORER',
  'viz.scatter': 'DATA_EXPLORER',
};

/** New Relic chart type to Dynatrace chart config */
export const CHART_TYPE_MAP: Record<string, string> = {
  LINE: 'LINE',
  AREA: 'AREA',
  STACKED_AREA: 'AREA',
  BAR: 'BAR',
  STACKED_BAR: 'COLUMN',
  PIE: 'PIE',
};

/** New Relic alert priority to Dynatrace severity */
export const ALERT_PRIORITY_MAP: Record<string, string> = {
  critical: 'ERROR',
  warning: 'WARN',
  info: 'WARN',
};

/** New Relic operator to Dynatrace comparison */
export const OPERATOR_MAP: Record<string, string> = {
  ABOVE: 'ABOVE',
  BELOW: 'BELOW',
  EQUALS: 'EQUALS',
  ABOVE_OR_EQUALS: 'ABOVE_OR_EQUAL',
  BELOW_OR_EQUALS: 'BELOW_OR_EQUAL',
};

/** New Relic threshold occurrences to Dynatrace violation settings */
export const THRESHOLD_OCCURRENCES_MAP: Record<string, string> = {
  ALL: 'ALL',
  AT_LEAST_ONCE: 'AT_LEAST_ONCE',
};

/** New Relic synthetic monitor type to Dynatrace monitor type */
export const SYNTHETIC_MONITOR_TYPE_MAP: Record<string, string> = {
  SIMPLE: 'HTTP',
  BROWSER: 'BROWSER',
  SCRIPT_BROWSER: 'BROWSER',
  SCRIPT_API: 'HTTP',
  CERT_CHECK: 'HTTP',
  BROKEN_LINKS: 'HTTP',
};

/** New Relic monitor period to Dynatrace frequency (minutes) */
export const MONITOR_PERIOD_MAP: Record<string, number> = {
  EVERY_MINUTE: 1,
  EVERY_5_MINUTES: 5,
  EVERY_10_MINUTES: 10,
  EVERY_15_MINUTES: 15,
  EVERY_30_MINUTES: 30,
  EVERY_HOUR: 60,
  EVERY_6_HOURS: 360,
  EVERY_12_HOURS: 720,
  EVERY_DAY: 1440,
};

/** New Relic notification channel type to Dynatrace integration type */
export const NOTIFICATION_TYPE_MAP: Record<string, string> = {
  EMAIL: 'email',
  SLACK: 'slack',
  PAGERDUTY: 'pagerduty',
  WEBHOOK: 'webhook',
  JIRA: 'jira',
  SERVICENOW: 'servicenow',
  OPSGENIE: 'opsgenie',
  VICTOROPS: 'victorops',
};

/** New Relic aggregation method to Dynatrace aggregation */
export const AGGREGATION_MAP: Record<string, string> = {
  EVENT_FLOW: 'AVG',
  EVENT_TIMER: 'AVG',
  CADENCE: 'AVG',
};

/** New Relic fill option to Dynatrace deal-with-gaps */
export const FILL_OPTION_MAP: Record<string, string> = {
  NONE: 'DROP_DATA',
  STATIC: 'USE_VALUE',
  LAST_VALUE: 'USE_LAST_VALUE',
};

/** SLO time window unit mapping */
export const SLO_TIME_UNIT_MAP: Record<string, string> = {
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
};

/** Infrastructure metric mapping */
export const INFRA_METRIC_MAP: {
  host_not_reporting: string;
  process_not_running: string;
  infra_metric: Record<string, string>;
} = {
  host_not_reporting: 'builtin:host.availability',
  process_not_running: 'builtin:tech.generic.process.count',
  infra_metric: {
    cpuPercent: 'builtin:host.cpu.usage',
    memoryUsedPercent: 'builtin:host.mem.usage',
    diskUsedPercent: 'builtin:host.disk.usedPct',
    loadAverageOneMinute: 'builtin:host.cpu.load',
    networkReceiveRate: 'builtin:host.net.bytesRx',
    networkTransmitRate: 'builtin:host.net.bytesTx',
  },
};

/** Infrastructure operator mapping */
export const INFRA_OPERATOR_MAP: Record<string, string> = {
  above: 'ABOVE',
  below: 'BELOW',
  equal: 'EQUALS',
};

// ---------------------------------------------------------------------------
// EntityMapper class
// ---------------------------------------------------------------------------

/**
 * Parse a dot-notation path key, extracting the name and optional array index.
 * "items[0]" -> { name: "items", index: 0 }
 * "name"     -> { name: "name", index: undefined }
 */
function parsePathKey(key: string): { name: string; index: number | undefined } | undefined {
  if (!key) return undefined;
  if (!key.includes('[')) return { name: key, index: undefined };

  const bracketIdx = key.indexOf('[');
  const name = key.slice(0, bracketIdx);
  const closeBracket = key.indexOf(']', bracketIdx);
  if (closeBracket === -1) return undefined;
  const index = parseInt(key.slice(bracketIdx + 1, closeBracket), 10);
  if (isNaN(index)) return undefined;
  return { name, index };
}

export class EntityMapper {
  private readonly mappings: Map<string, EntityMapping> = new Map();

  constructor() {
    this.registerDefaultMappings();
  }

  registerMapping(mapping: EntityMapping): void {
    this.mappings.set(mapping.sourceType, mapping);
  }

  getMapping(sourceType: string): EntityMapping | undefined {
    return this.mappings.get(sourceType);
  }

  mapValue<T>(value: unknown, valueMap: Record<string, T>, defaultValue?: T): T | unknown {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    const key = String(value);
    if (key in valueMap) {
      return valueMap[key];
    }
    return defaultValue !== undefined ? defaultValue : value;
  }

  getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) return undefined;

      const parsed = parsePathKey(key);
      if (!parsed) return undefined;

      if (parsed.index !== undefined) {
        const rec = current as Record<string, unknown>;
        if (typeof rec === 'object' && parsed.name in rec) {
          const arr = rec[parsed.name];
          if (Array.isArray(arr) && arr.length > parsed.index) {
            current = arr[parsed.index];
          } else {
            return undefined;
          }
        } else {
          return undefined;
        }
      } else {
        const rec = current as Record<string, unknown>;
        if (typeof rec === 'object' && parsed.name in rec) {
          current = rec[parsed.name];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }

  setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const parsed = parsePathKey(keys[i] ?? '');
      if (!parsed) return;

      if (parsed.index !== undefined) {
        if (!(parsed.name in current)) {
          current[parsed.name] = [];
        }
        const arr = current[parsed.name] as unknown[];
        while (arr.length <= parsed.index) {
          arr.push({});
        }
        current = arr[parsed.index] as Record<string, unknown>;
      } else {
        if (!(parsed.name in current)) {
          current[parsed.name] = {};
        }
        current = current[parsed.name] as Record<string, unknown>;
      }
    }

    const lastKey = keys[keys.length - 1] ?? '';
    const parsed = parsePathKey(lastKey);
    if (!parsed) return;

    if (parsed.index !== undefined) {
      if (!(parsed.name in current)) {
        current[parsed.name] = [];
      }
      const arr = current[parsed.name] as unknown[];
      while (arr.length <= parsed.index) {
        arr.push(null);
      }
      arr[parsed.index] = value;
    } else {
      current[parsed.name] = value;
    }
  }

  private registerDefaultMappings(): void {
    this.registerMapping({
      sourceType: 'dashboard',
      targetType: 'dashboard',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'dashboardMetadata.name',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'description',
          targetField: 'dashboardMetadata.description',
          transformation: 'direct',
          defaultValue: '',
          required: false,
        },
        {
          sourceField: 'permissions',
          targetField: 'dashboardMetadata.shared',
          transformation: 'mapped',
          valueMap: {
            PUBLIC_READ_ONLY: true,
            PUBLIC_READ_WRITE: true,
            PRIVATE: false,
          },
          defaultValue: false,
          required: false,
        },
      ],
    });

    this.registerMapping({
      sourceType: 'alert_policy',
      targetType: 'alerting_profile',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'name',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'incidentPreference',
          targetField: 'severityRules',
          transformation: 'custom',
          required: false,
        },
      ],
    });

    this.registerMapping({
      sourceType: 'alert_condition',
      targetType: 'metric_event',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'summary',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'description',
          targetField: 'description',
          transformation: 'direct',
          defaultValue: '',
          required: false,
        },
        {
          sourceField: 'enabled',
          targetField: 'enabled',
          transformation: 'direct',
          defaultValue: true,
          required: false,
        },
      ],
    });

    this.registerMapping({
      sourceType: 'synthetic_monitor',
      targetType: 'synthetic_monitor',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'name',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'monitoredUrl',
          targetField: 'script.requests[0].url',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'monitorType',
          targetField: 'type',
          transformation: 'mapped',
          valueMap: SYNTHETIC_MONITOR_TYPE_MAP,
          defaultValue: 'HTTP',
          required: false,
        },
        {
          sourceField: 'period',
          targetField: 'frequencyMin',
          transformation: 'mapped',
          valueMap: MONITOR_PERIOD_MAP,
          defaultValue: 15,
          required: false,
        },
      ],
    });

    this.registerMapping({
      sourceType: 'slo',
      targetType: 'slo',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'name',
          transformation: 'direct',
          required: true,
        },
        {
          sourceField: 'description',
          targetField: 'description',
          transformation: 'direct',
          defaultValue: '',
          required: false,
        },
        {
          sourceField: 'objectives[0].target',
          targetField: 'target',
          transformation: 'direct',
          required: true,
        },
      ],
    });

    this.registerMapping({
      sourceType: 'workload',
      targetType: 'management_zone',
      fieldMappings: [
        {
          sourceField: 'name',
          targetField: 'name',
          transformation: 'direct',
          required: true,
        },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// Comprehensive export
// ---------------------------------------------------------------------------

export const ENTITY_MAPPINGS = {
  visualization_types: VISUALIZATION_TYPE_MAP,
  chart_types: CHART_TYPE_MAP,
  alert_priorities: ALERT_PRIORITY_MAP,
  operators: OPERATOR_MAP,
  threshold_occurrences: THRESHOLD_OCCURRENCES_MAP,
  synthetic_monitor_types: SYNTHETIC_MONITOR_TYPE_MAP,
  monitor_periods: MONITOR_PERIOD_MAP,
  notification_types: NOTIFICATION_TYPE_MAP,
  aggregations: AGGREGATION_MAP,
  fill_options: FILL_OPTION_MAP,
  slo_time_units: SLO_TIME_UNIT_MAP,
} as const;
