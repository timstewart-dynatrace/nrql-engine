/**
 * NRQL-to-DQL Compiler — DQL Emitter.
 *
 * Walks the NRQL AST and emits valid DQL.
 */

import type {
  ASTNode,
  Condition,
  FacetItem,
  FunctionCall,
  InSubqueryCond,
  LikeCond,
  LiteralExpr,
  Query,
  SelectItem,
  TimeseriesClause,
} from './ast-nodes.js';

import { AGG_FUNCTIONS } from './parser.js';

// ---------------------------------------------------------------------------
// Helper: safe array index (avoids ! on every line with noUncheckedIndexedAccess)
// ---------------------------------------------------------------------------

/** Return arr[i] or throw if out of bounds. Used instead of `!` for clarity. */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined && i >= arr.length) {
    throw new RangeError(`Index ${i} out of bounds (length ${arr.length})`);
  }
  // Value could legitimately be undefined for T that includes undefined,
  // but for our AST node arrays that never happens.
  return v as T;
}

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * Convert NR COMPARE WITH time expression to DQL shift: duration.
 *
 * '1 week ago' -> '-7d'
 * '1 day ago'  -> '-1d'
 * '7 days ago' -> '-7d'
 * '24 hours ago' -> '-24h'
 * '1 month ago' -> '-30d'
 */
export function parseCompareShift(raw: string): string | undefined {
  const m = raw
    .trim()
    .match(/^(\d+)\s+(week|day|hour|minute|month|second)s?\s+ago$/i);
  if (!m?.[1] || !m[2]) return undefined;
  const val = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMap: Record<string, [string, number]> = {
    week: ['d', 7],
    day: ['d', 1],
    hour: ['h', 1],
    minute: ['m', 1],
    month: ['d', 30],
    second: ['s', 1],
  };
  const entry = unitMap[unit];
  const [suffix, mult] = entry ?? ['d', 1];
  return `-${val * mult}${suffix}`;
}

// ---------------------------------------------------------------------------
// Constant maps
// ---------------------------------------------------------------------------

/** NR event type -> query classification (determines which DQL shape to use). */
export const QUERY_CLASS_MAP: Readonly<Record<string, string>> = {
  transaction: 'spans',
  transactionerror: 'spans',
  span: 'spans',
  log: 'logs',
  logevent: 'logs',
  // Metric sources -> timeseries command
  metric: 'METRIC',
  systemsample: 'METRIC',
  processsample: 'METRIC',
  networksample: 'METRIC',
  storagesample: 'METRIC',
  containersample: 'METRIC',
  // K8s -> timeseries with K8s metric mapping
  k8snodesample: 'K8S_NODE_METRIC',
  k8scontainersample: 'K8S_WORKLOAD_METRIC',
  k8spodsample: 'K8S_POD_METRIC',
  k8sclustersample: 'K8S_CLUSTER_METRIC',
  k8sdeploymentsample: 'K8S_WORKLOAD_METRIC',
  // Browser/RUM
  pageview: 'bizevents',
  pageaction: 'bizevents',
  browserinteraction: 'bizevents',
  ajaxrequest: 'bizevents',
  javascripterror: 'bizevents',
  // Synthetic
  syntheticcheck: 'dt.synthetic.http.request',
  syntheticsrequest: 'dt.synthetic.http.request',
  // Events
  infrastructureevent: 'EVENTS',
  // Lambda / Custom
  awslambdainvocation: 'spans',
  nrcustomappevent: 'bizevents',
};

/** For backward compat -- the old name still used in emit_lookup. */
export const EVENT_TYPE_MAP = QUERY_CLASS_MAP;

/** NR function -> DQL function. */
export const FUNC_MAP: Readonly<Record<string, string>> = {
  count: 'count',
  sum: 'sum',
  average: 'avg',
  avg: 'avg',
  max: 'max',
  min: 'min',
  percentile: 'percentile',
  stddev: 'stddev',
  rate: 'count',
  variance: 'variance',
  uniquecount: 'countDistinctExact',
  uniques: 'collectDistinct',
  latest: 'takeLast',
  earliest: 'takeFirst',
  last: 'takeLast',
  first: 'takeFirst',
  median: 'percentile',
  // String
  substring: 'substring',
  indexof: 'indexOf',
  length: 'stringLength',
  concat: 'concat',
  lower: 'lower',
  upper: 'upper',
  capture: 'extract',
  aparse: 'parse',
  replace: 'replaceAll',
  trim: 'trim',
  startswith: 'startsWith',
  endswith: 'endsWith',
  // Math
  abs: 'abs',
  ceil: 'ceil',
  floor: 'floor',
  round: 'round',
  sqrt: 'sqrt',
  pow: 'pow',
  log: 'log',
  log10: 'log10',
  exp: 'exp',
  ln: 'log',
  cbrt: 'cbrt',
  sign: 'sign',
  // Time
  dateof: 'formatTimestamp',
  hourof: 'getHour',
  minuteof: 'getMinute',
  dayofweek: 'getDayOfWeek',
  weekof: 'getWeekOfYear',
  monthof: 'getMonth',
  yearof: 'getYear',
  // Type
  numeric: 'toDouble',
  string: 'toString',
  todouble: 'toDouble',
  tolong: 'toLong',
  tonumber: 'toNumber',
  toboolean: 'toBoolean',
  totimestamp: 'toTimestamp',
  // If
  if: 'if',
  // Boolean matching functions
  matchesphrase: 'contains',
  matchesvalue: 'contains',
  // Phase 2-3 additions
  buckets: 'bin',
  aggregationendtime: 'end',
};

/** NR filter() -> DQL funcIf mapping. */
export const FILTER_IF_MAP: Readonly<Record<string, string>> = {
  count: 'countIf',
  sum: 'sumIf',
  average: 'avgIf',
  avg: 'avgIf',
  max: 'maxIf',
  min: 'minIf',
};

/** NR field -> DT field (common attributes). */
export const FIELD_MAP: Readonly<Record<string, string>> = {
  appname: 'service.name',
  appName: 'service.name',
  transactionname: 'span.name',
  name: 'span.name',
  duration: 'duration',
  'duration.ms': 'duration',
  databaseduration: 'db.duration',
  externalduration: 'http.duration',
  host: 'host.name',
  hostname: 'host.name',
  fullhostname: 'host.name',
  httpresponsecode: 'http.response.status_code',
  httpResponseCode: 'http.response.status_code',
  'http.statuscode': 'http.response.status_code',
  'http.statusCode': 'http.response.status_code',
  'response.status': 'http.response.status_code',
  httpresponsestatuscode: 'http.response.status_code',
  'request.uri': 'http.request.path',
  'request.url': 'http.request.path',
  'request.method': 'http.request.method',
  'http.method': 'http.request.method',
  httpmethod: 'http.request.method',
  'http.url': 'http.request.path',
  httpurl: 'http.request.path',
  'error.message': 'error.message',
  entityguid: 'dt.entity.service',
  entityname: 'dt.entity.name',
  'entity.name': 'dt.entity.name',
  cpupercent: 'host.cpu.usage',
  memoryusedpercent: 'host.memory.usage',
  diskusedpercent: 'host.disk.usage',
  message: 'content',
  level: 'loglevel',
  'log.level': 'loglevel',
  // K8s
  'k8s.containername': 'k8s.container.name',
  'k8s.podname': 'k8s.pod.name',
  'k8s.clustername': 'k8s.cluster.name',
  'k8s.namespacename': 'k8s.namespace.name',
  'k8s.nodename': 'k8s.node.name',
  'k8s.deploymentname': 'k8s.deployment.name',
  clustername: 'k8s.cluster.name',
  podname: 'k8s.pod.name',
  namespace: 'k8s.namespace.name',
  namespacename: 'k8s.namespace.name',
  containername: 'k8s.container.name',
  nodename: 'k8s.node.name',
  // Browser/RUM
  pageurl: 'page.url',
  pageUrl: 'page.url',
  userAgentName: 'browser.name',
  useragentname: 'browser.name',
  userAgentOS: 'os.name',
  useragentos: 'os.name',
  city: 'geo.city',
  regionCode: 'geo.region',
  countryCode: 'geo.country',
  deviceType: 'device.type',
  devicetype: 'device.type',
  // Span/Trace IDs
  parentId: 'span.parent_id',
  parentid: 'span.parent_id',
  'parent.id': 'span.parent_id',
  id: 'span.id',
  traceId: 'trace_id',
  traceid: 'trace_id',
  guid: 'span.id',
  'nr.guid': 'span.id',
  // Duration variants
  'Duration.Seconds': 'duration',
  'duration.seconds': 'duration',
  'Duration.seconds': 'duration',
  'duration.Seconds': 'duration',
  'Duration.Ms': 'duration',
  'Duration.ms': 'duration',
  durationMs: 'duration',
  'Duration.Minutes': 'duration',
  // Transaction metadata
  transactiontype: 'span.kind',
  transactionType: 'span.kind',
  error: 'error',
  'error.class': 'error.type',
  errortype: 'error.type',
  errorType: 'error.type',
  errormessage: 'error.message',
  errorMessage: 'error.message',
  'response.statuscode': 'http.response.status_code',
  databasecallcount: 'db.call_count',
  databaseCallCount: 'db.call_count',
  externalcallcount: 'http.call_count',
  externalCallCount: 'http.call_count',
  deploymentname: 'k8s.deployment.name',
  deploymentName: 'k8s.deployment.name',
};

// ---------------------------------------------------------------------------
// Types for metric resolution callback
// ---------------------------------------------------------------------------

export type MetricResolver = (
  fieldKey: string,
  rawField: string,
  knownMetric?: string | null,
) => [string, string | undefined];

export interface MetricTransform {
  type: string;
  dql?: string;
  dql_single?: string;
  metric?: string;
  post_calc?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// DQLEmitter
// ---------------------------------------------------------------------------

export class DQLEmitter {
  /**
   * K8s context-specific metric overrides.
   * When FROM is K8sContainerSample/K8sNodeSample, these map to dt.kubernetes.* metrics.
   */
  static readonly K8S_METRIC_OVERRIDES: Readonly<Record<string, string>> = {
    memoryusedbytes: 'dt.kubernetes.container.memory_working_set',
    memoryused: 'dt.kubernetes.container.memory_working_set',
    cpuusedbytes: 'dt.kubernetes.container.cpu_usage',
    cpupercent: 'dt.kubernetes.container.cpu_usage',
    diskused: 'dt.kubernetes.persistentvolumeclaim.used',
    diskusedbytes: 'dt.kubernetes.persistentvolumeclaim.used',
    restartcount: 'dt.kubernetes.container.restarts',
    restartcountdelta: 'dt.kubernetes.container.restarts',
    cpuusedcores: 'dt.kubernetes.container.cpu_usage',
    memoryworkingsetbytes: 'dt.kubernetes.container.memory_working_set',
  };

  /**
   * K8s fields that are NOT valid timeseries metrics — they need entity queries instead.
   */
  static readonly K8S_ENTITY_FIELDS: Readonly<
    Record<string, { dql: string; note: string }>
  > = {
    isready: {
      dql:
        'fetch dt.entity.cloud_application' +
        ' | fields entity.name, readyReplicas = readyReplicas, desiredReplicas = desiredReplicas',
      note:
        '// isReady -> DT uses entity properties, not timeseries metrics. ' +
        'Compare readyReplicas vs desiredReplicas for readiness.',
    },
    status: {
      dql:
        'fetch dt.entity.cloud_application' +
        ' | fields entity.name, status = cloudApplicationStatus',
      note: '// status -> DT uses entity properties for workload status.',
    },
    isscheduled: {
      dql:
        'fetch dt.entity.cloud_application_instance' +
        ' | fields entity.name, phase = cloudApplicationInstancePhase',
      note: '// isScheduled -> DT uses entity phase property, not timeseries metrics.',
    },
  };

  static readonly DQL_RESERVED_WORDS: ReadonlySet<string> = new Set([
    'duration', 'timestamp', 'timeframe', 'string', 'long', 'double',
    'boolean', 'ip', 'record', 'array', 'true', 'false', 'null',
    'fetch', 'filter', 'summarize', 'fields', 'sort', 'limit',
    'lookup', 'join', 'append', 'parse', 'from', 'to', 'by',
    'asc', 'desc', 'not', 'and', 'or', 'in', 'is',
  ]);

  /**
   * Fields that are custom metric dimensions — do NOT remap in metric context.
   */
  static readonly METRIC_DIMENSION_PASSTHROUGH: ReadonlySet<string> = new Set([
    'id', 'target', 'topic', 'consumer_group', 'partition',
    'cluster_id', 'principal_id', 'type', 'name', 'mode',
  ]);

  readonly fieldMap: Record<string, string>;
  readonly metricMap: Record<string, string>;
  readonly metricTransforms: Record<string, MetricTransform>;
  readonly metricResolver: MetricResolver | undefined;

  warnings: string[] = [];
  private aggCounter = 0;
  private histogramBinExpr: string | undefined = undefined;
  private funnelSteps: Array<[string, string]> = [];
  private queryClass = 'spans';
  private currentK8sContext = false;

  constructor(
    fieldMap?: Record<string, string>,
    metricMap?: Record<string, string>,
    metricTransforms?: Record<string, MetricTransform>,
    metricResolver?: MetricResolver,
  ) {
    this.fieldMap = { ...FIELD_MAP, ...(fieldMap ?? {}) };
    this.metricMap = metricMap ?? {};
    this.metricTransforms = metricTransforms ?? {};
    this.metricResolver = metricResolver;
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  emit(query: Query): string {
    this.warnings = [];
    this.aggCounter = 0;
    this.histogramBinExpr = undefined;
    this.funnelSteps = [];
    this.queryClass = 'spans';

    // Handle SHOW EVENT TYPES
    if (query.fromClause === '__SHOW_EVENT_TYPES__') {
      this.warnings.push(
        'SHOW EVENT TYPES -> use DT Schema browser or: fetch dt.entity.type',
      );
      return (
        '// SHOW EVENT TYPES has no direct DQL equivalent\n' +
        '// In Dynatrace, use the Schema browser in Notebooks/Dashboards\n' +
        '// or query: fetch dt.entity.type | fields entity.type | dedup entity.type'
      );
    }

    const fromType = query.fromClause
      .toLowerCase()
      .replace(/_/g, '')
      .replace(/-/g, '');
    const queryClass = this.classifyQuery(fromType);
    this.queryClass = queryClass;

    let dql: string;

    if (queryClass === 'METRIC') {
      dql = this.emitMetricQuery(query, fromType);
    } else if (queryClass.startsWith('K8S_')) {
      dql = this.emitMetricQuery(query, fromType);
    } else if (queryClass === 'EVENTS') {
      dql = this.emitEventsQuery(query);
    } else {
      dql = this.emitFetchQuery(query, queryClass);
    }

    // Validate emitted DQL for nested aggregation errors
    dql = this.validateNoNestedAggregations(dql);

    // COMPARE WITH handling
    if (query.compareWithRaw) {
      const shiftDur = parseCompareShift(query.compareWithRaw);
      const hasTsCmd =
        dql.includes('| timeseries ') ||
        dql.split('\n').some((l) => l.trim().startsWith('timeseries '));
      const hasMakeTs = dql.includes('makeTimeseries');

      if (shiftDur && hasTsCmd && !hasMakeTs) {
        const lines = dql.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = at(lines, i);
          if (
            line.includes('| timeseries ') ||
            line.trim().startsWith('timeseries ')
          ) {
            lines[i] = line.trimEnd() + `, shift:${shiftDur}`;
            break;
          }
        }
        dql = lines.join('\n');
        this.warnings.push(
          `COMPARE WITH ${query.compareWithRaw} -> DQL shift:${shiftDur} ` +
            '(overlays current + shifted series)',
        );
      } else if (shiftDur) {
        dql = this.emitCompareWithAppend(dql, query, shiftDur);
      } else {
        this.warnings.push(
          `COMPARE WITH ${query.compareWithRaw}: could not parse time shift`,
        );
      }
    }

    // EXTRAPOLATE
    if (query.extrapolate) {
      dql +=
        '\n// EXTRAPOLATE -> DT does not sample span data; full fidelity by default';
      this.warnings.push(
        'EXTRAPOLATE removed: DT Grail stores full-fidelity data, no sampling',
      );
    }

    // JOIN clause
    if (query.joinClause) {
      dql = this.emitJoinClause(query, dql);
    }

    // FACET ... ORDER BY
    if (query.facetOrderBy) {
      const orderExpr = this.emitExpr(query.facetOrderBy);
      dql += `\n// FACET ORDER BY ${orderExpr} -> DQL sorts by first summarize column; reorder SELECT to match`;
      this.warnings.push(
        `FACET ORDER BY ${orderExpr}: DQL uses first aggregation for facet selection. ` +
          'Reorder SELECT columns to achieve equivalent.',
      );
    }

    // SLIDE BY -> DQL rolling() window function
    if (query.timeseries?.slideBy) {
      const sb = query.timeseries.slideBy;
      const windowInterval = query.timeseries.interval;

      const windowSecs = DQLEmitter.intervalToSeconds(windowInterval);
      const slideSecs = DQLEmitter.intervalToSeconds(sb);

      if (windowSecs && slideSecs && slideSecs > 0) {
        const rollingPoints = Math.max(2, Math.floor(windowSecs / slideSecs));

        const slideDql = DQLEmitter.formatInterval({
          interval: sb,
        } as TimeseriesClause);

        if (slideDql) {
          if (dql.includes('interval: ')) {
            dql = dql.replace(/interval: \S+/, `interval: ${slideDql}`);
          } else if (dql.includes('makeTimeseries')) {
            const lines = dql.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (at(lines, i).includes('makeTimeseries')) {
                lines[i] = at(lines, i).trimEnd() + `, interval: ${slideDql}`;
                break;
              }
            }
            dql = lines.join('\n');
          }

          const aggNames = DQLEmitter.extractAggNamesFromDql(dql);
          if (aggNames.length > 0) {
            const rollingLines: string[] = [];
            for (const [aggName, aggFunc] of aggNames) {
              const rollingFunc = DQLEmitter.aggToRollingFunc(aggFunc);
              const newName = aggName
                ? `sliding_${aggName}`
                : `sliding_${rollingFunc}`;
              rollingLines.push(
                `| fieldsAdd ${newName} = rolling(${rollingFunc}, ${rollingPoints})`,
              );
            }
            dql += '\n' + rollingLines.join('\n');
          }
        }

        this.warnings.push(
          `SLIDE BY ${sb} -> rolling() with ${rollingPoints}-point window ` +
            `(interval: ${slideDql ?? sb}). ` +
            'Original columns contain raw per-interval values; ' +
            'sliding_* columns contain the smoothed rolling window.',
        );
      } else if (
        windowSecs &&
        (sb.toUpperCase() === 'AUTO' || sb.toUpperCase() === 'MAX')
      ) {
        const aggNames = DQLEmitter.extractAggNamesFromDql(dql);
        if (aggNames.length > 0) {
          const rollingLines: string[] = [];
          for (const [aggName, aggFunc] of aggNames) {
            const rollingFunc = DQLEmitter.aggToRollingFunc(aggFunc);
            const newName = aggName
              ? `sliding_${aggName}`
              : `sliding_${rollingFunc}`;
            rollingLines.push(
              `| fieldsAdd ${newName} = rolling(${rollingFunc}, 3)`,
            );
          }
          dql += '\n' + rollingLines.join('\n');
        }
        this.warnings.push(
          `SLIDE BY ${sb} -> rolling() with 3-point window (auto). ` +
            'Adjust the rolling point count to tune smoothing.',
        );
      } else {
        dql += `\n// SLIDE BY ${sb} -> adjust makeTimeseries interval and apply rolling()`;
        this.warnings.push(
          `SLIDE BY ${sb}: couldn't auto-convert. ` +
            'Set interval to slide value and use rolling() window function.',
        );
      }
    }

    // PREDICT
    if (query.predict) {
      dql +=
        '\n// PREDICT -> use Dynatrace Davis AI predictions or forecasting API';
      this.warnings.push(
        'PREDICT: use Davis AI anomaly detection for forecasting in DT',
      );
    }

    // WITH TIMEZONE
    if (query.withTimezone) {
      dql += `\n// WITH TIMEZONE '${query.withTimezone}' -> DT stores UTC; apply TZ in dashboard settings`;
      this.warnings.push(
        `WITH TIMEZONE '${query.withTimezone}': DT uses UTC. ` +
          'Set timezone in dashboard/notebook display settings.',
      );
    }

    return dql;
  }

  // -----------------------------------------------------------------------
  // COMPARE WITH append
  // -----------------------------------------------------------------------

  private emitCompareWithAppend(
    dql: string,
    query: Query,
    shiftDur: string,
  ): string {
    const shiftMatch = shiftDur.match(/^-(\d+)([dhms])$/);
    if (!shiftMatch?.[1] || !shiftMatch[2]) {
      this.warnings.push(
        `COMPARE WITH ${query.compareWithRaw}: could not generate append subquery`,
      );
      return dql;
    }

    const shiftVal = shiftMatch[1];
    const shiftUnit = shiftMatch[2];

    const lines = dql.split('\n');
    const pipelineLines: string[] = [];
    const commentLines: string[] = [];
    for (const line of lines) {
      if (line.trim().startsWith('//') && pipelineLines.length === 0) {
        commentLines.push(line);
      } else {
        pipelineLines.push(line);
      }
    }

    if (pipelineLines.length === 0) return dql;

    const shiftedLines: string[] = [];
    for (const line of pipelineLines) {
      const stripped = line.trim();
      if (stripped.startsWith('fetch ')) {
        shiftedLines.push(
          `${stripped}, from:now()-${shiftVal}${shiftUnit}-1h, to:now()-${shiftVal}${shiftUnit}`,
        );
      } else {
        shiftedLines.push(stripped);
      }
    }

    const shiftedPipeline = shiftedLines.join('\n');
    const labelLine = `| fieldsAdd _comparison = "previous (${query.compareWithRaw})"`;
    const currentLabel = '| fieldsAdd _comparison = "current"';

    let result = [...commentLines, ...pipelineLines].join('\n');
    result += `\n${currentLabel}`;
    result += `\n| append [\n${shiftedPipeline}\n${labelLine}\n]`;

    this.warnings.push(
      `COMPARE WITH ${query.compareWithRaw} -> append subquery with ` +
        `shifted time range (${shiftDur}). Use _comparison field to distinguish periods.`,
    );

    return result;
  }

  // -----------------------------------------------------------------------
  // JOIN clause
  // -----------------------------------------------------------------------

  private emitJoinClause(query: Query, baseDql: string): string {
    const jc = query.joinClause!; // Caller checked joinClause is defined
    const sub = jc.subquery;

    const subFrom = sub.fromClause
      .toLowerCase()
      .replace(/_/g, '')
      .replace(/-/g, '');
    const subClass = this.classifyQuery(subFrom);
    let subFetch: string;
    if (subClass === 'METRIC' || subClass.startsWith('K8S_')) {
      subFetch = `timeseries /* ${sub.fromClause} */`;
    } else {
      subFetch = `fetch ${subClass}`;
    }

    let subFilter = '';
    if (sub.where) {
      subFilter = `\n| filter ${this.emitCondition(sub.where)}`;
    }

    const subFields: string[] = [];
    for (const item of sub.selectItems) {
      const exprStr = this.emitAggExpr(item.expression);
      if (item.alias) {
        subFields.push(`${this.sanitizeAlias(item.alias)}=${exprStr}`);
      } else {
        subFields.push(exprStr);
      }
    }

    const onLeft = jc.onLeft ? this.mapField(jc.onLeft) : 'id';
    const onRight = jc.onRight ? this.mapField(jc.onRight) : onLeft;

    const joinTypeStr =
      jc.joinType === 'LEFT' ? '// LEFT ' : '// ';
    const subFieldsStr = subFields.length > 0 ? subFields.join(', ') : '*';

    const lookupLine =
      `| lookup [${subFetch}${subFilter} | fields ${onRight}, ${subFieldsStr}], ` +
      `sourceField:${onLeft}, lookupField:${onRight}, prefix:"sub."`;

    this.warnings.push(
      `${jc.joinType} JOIN on ${jc.onLeft ?? 'id'}=${jc.onRight ?? 'id'}: converted to DQL lookup command`,
    );

    return `${joinTypeStr}JOIN converted to lookup\n${baseDql}\n${lookupLine}`;
  }

  // -----------------------------------------------------------------------
  // Query classification
  // -----------------------------------------------------------------------

  private classifyQuery(fromType: string): string {
    const mapped = QUERY_CLASS_MAP[fromType];
    if (mapped) return mapped;
    // Heuristics
    if (fromType.includes('metric') || fromType.includes('sample')) {
      return 'METRIC';
    }
    if (fromType.includes('log')) return 'logs';
    if (fromType.includes('event')) return 'EVENTS';
    if (fromType.includes('span') || fromType.includes('transaction')) {
      return 'spans';
    }
    return 'spans';
  }

  // -----------------------------------------------------------------------
  // Interval helpers (static)
  // -----------------------------------------------------------------------

  /**
   * Convert NRQL TIMESERIES interval to DQL interval: value.
   * Returns undefined for AUTO/MAX/empty.
   */
  static formatInterval(
    ts: TimeseriesClause | undefined,
  ): string | undefined {
    if (!ts?.interval) return undefined;
    const upper = ts.interval.toUpperCase();
    if (upper === 'AUTO' || upper === 'MAX') return undefined;
    const m = ts.interval
      .trim()
      .match(
        /^(\d+(?:\.\d+)?)\s*(second|seconds|sec|s|minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|w)$/i,
      );
    if (!m?.[1] || !m[2]) return undefined;
    let val = m[1];
    const unit = m[2].toLowerCase();
    const unitMap: Record<string, string> = {
      second: 's', seconds: 's', sec: 's', s: 's',
      minute: 'm', minutes: 'm', min: 'm', m: 'm',
      hour: 'h', hours: 'h', hr: 'h', h: 'h',
      day: 'd', days: 'd', d: 'd',
      week: 'w', weeks: 'w', w: 'w',
    };
    const dqlUnit = unitMap[unit] ?? 'm';
    if (val.includes('.') && val.endsWith('.0')) {
      val = val.slice(0, -2);
    }
    return `${val}${dqlUnit}`;
  }

  /** Convert NR interval string to seconds. Returns undefined if unparseable. */
  static intervalToSeconds(
    intervalStr: string | undefined,
  ): number | undefined {
    if (!intervalStr) return undefined;
    const upper = intervalStr.toUpperCase();
    if (upper === 'AUTO' || upper === 'MAX') return undefined;
    const m = intervalStr
      .trim()
      .match(
        /^(\d+(?:\.\d+)?)\s*(second|seconds|sec|s|minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|w)$/i,
      );
    if (!m?.[1] || !m[2]) return undefined;
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const unitSecs: Record<string, number> = {
      second: 1, seconds: 1, sec: 1, s: 1,
      minute: 60, minutes: 60, min: 60, m: 60,
      hour: 3600, hours: 3600, hr: 3600, h: 3600,
      day: 86400, days: 86400, d: 86400,
      week: 604800, weeks: 604800, w: 604800,
    };
    return Math.floor(val * (unitSecs[unit] ?? 60));
  }

  /**
   * Extract (name, function) pairs from makeTimeseries/timeseries line.
   */
  static extractAggNamesFromDql(dql: string): Array<[string, string]> {
    const results: Array<[string, string]> = [];
    for (const line of dql.split('\n')) {
      const stripped = line.trim().replace(/^\|\s*/, '');
      if (
        !stripped.startsWith('makeTimeseries') &&
        !stripped.startsWith('timeseries')
      ) {
        continue;
      }

      const cmdEnd = stripped.indexOf(' ') + 1;
      let aggPart = stripped.slice(cmdEnd);
      // Remove by:{...}, interval:, filter:, shift:
      aggPart = aggPart.replace(
        /,\s*(by:\s*\{[^}]*\}|interval:\s*\S+|filter:\s*.+|shift:\s*\S+)/g,
        '',
      );

      // Parse individual aggregations, splitting on commas not inside parens
      let depth = 0;
      let current = '';
      const parts: string[] = [];
      for (const ch of aggPart) {
        if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
        } else if (ch === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
          continue;
        }
        current += ch;
      }
      if (current.trim()) {
        parts.push(current.trim());
      }

      for (const part of parts) {
        // Named: name=func(args)
        let match = part.match(/^(\w+)\s*=\s*(\w+)\s*\(/);
        if (match?.[1] && match[2]) {
          results.push([match[1], match[2]]);
          continue;
        }
        // Unnamed: func(args)
        match = part.match(/^(\w+)\s*\(/);
        if (match?.[1]) {
          results.push([match[1], match[1]]);
        }
      }
      break; // Only process first matching line
    }
    return results;
  }

  /**
   * Map DQL aggregation function to rolling() function name.
   */
  static aggToRollingFunc(aggFunc: string): string {
    const mapping: Record<string, string> = {
      avg: 'avg',
      count: 'sum',
      countIf: 'sum',
      sum: 'sum',
      min: 'min',
      max: 'max',
      percentile: 'avg',
      countDistinctExact: 'avg',
      countDistinctApprox: 'avg',
      stddev: 'stddev',
      median: 'median',
      variance: 'avg',
    };
    return mapping[aggFunc] ?? 'avg';
  }

  // -----------------------------------------------------------------------
  // METRIC QUERIES (timeseries command)
  // -----------------------------------------------------------------------

  private emitMetricQuery(query: Query, fromType: string): string {
    const partsNotes: string[] = [];

    const queryClass = this.classifyQuery(fromType);
    this.currentK8sContext = queryClass.startsWith('K8S_');

    // K8s entity field interception
    if (this.currentK8sContext) {
      const aggPreview = this.extractMetricAggs(query.selectItems);
      if (aggPreview.length > 0) {
        const first = at(aggPreview, 0);
        const firstRawKey = first[2]
          .toLowerCase()
          .replace(/\./g, '')
          .replace(/_/g, '')
          .replace(/`/g, '');
        const entityInfo = DQLEmitter.K8S_ENTITY_FIELDS[firstRawKey];
        if (entityInfo) {
          let entityDql = entityInfo.dql;
          if (query.where) {
            const filterStr = this.emitCondition(query.where);
            entityDql += `\n| filter ${filterStr}`;
          }
          return entityInfo.note + '\n' + entityDql;
        }
      }
    }

    // Build filter string
    let filterStr = '';
    if (query.where) {
      const [remaining, metricConds] = this.splitMetricConditions(query.where);
      if (remaining) {
        const f = this.emitCondition(remaining);
        filterStr = `, filter:{${f}}`;
      }
      if (metricConds.length > 0) {
        partsNotes.push(
          `// NOTE: Metric-based filtering (${metricConds.join(', ')}) ` +
            'applied as post-aggregation threshold in DT',
        );
      }
    }

    // Build by string
    let byStr = '';
    if (query.facetItems && query.facetItems.length > 0) {
      const byItems = this.emitFacetItems(query.facetItems);
      byStr = `, by: {${byItems}}`;
    }

    // Analyze SELECT items for arithmetic-between-aggs patterns
    for (const item of query.selectItems) {
      if (this.isComputedMetricExpr(item.expression)) {
        const computedDql = this.emitComputedMetric(item, byStr, filterStr);
        if (partsNotes.length > 0) {
          return partsNotes.join('\n') + '\n' + computedDql;
        }
        return computedDql;
      }
    }

    // Patterns 1 & 2: simple aggregation or transform
    const aggItems = this.extractMetricAggs(query.selectItems);

    if (aggItems.length === 0) {
      return this.emitFetchQuery(query, 'spans');
    }

    // Check first metric for metricTransforms
    const firstItem = at(aggItems, 0);
    const firstFunc = firstItem[0];
    const firstRaw = firstItem[2];
    const fieldKey = firstRaw
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/_/g, '')
      .replace(/`/g, '');
    const transform = this.metricTransforms[fieldKey];

    if (transform) {
      const transformDql = this.emitMetricTransform(transform, byStr, filterStr);
      if (aggItems.length > 1) {
        const extras = aggItems.slice(1).map((entry) => entry[2]);
        partsNotes.push(
          `// NOTE: Additional metrics in original: ${extras.join(', ')}`,
        );
      }
      if (partsNotes.length > 0) {
        return partsNotes.join('\n') + '\n' + transformDql;
      }
      return transformDql;
    }

    // Pattern 1: simple metric(s)
    const dtMetric = this.resolveMetricField(fieldKey, firstRaw);
    const dtFunc = this.mapMetricAgg(firstFunc);

    const intervalStr = DQLEmitter.formatInterval(query.timeseries);
    const intervalPart = intervalStr ? `, interval: ${intervalStr}` : '';

    let dql: string;
    if (aggItems.length > 1) {
      const tsParts: string[] = [];
      for (const entry of aggItems) {
        const funcName = entry[0];
        const raw = entry[2];
        const fk = raw
          .toLowerCase()
          .replace(/\./g, '')
          .replace(/_/g, '')
          .replace(/`/g, '');
        const resolved = this.resolveMetricField(fk, raw);
        const mappedFunc = this.mapMetricAgg(funcName);
        const alias = this.sanitizeAlias(
          raw.includes('.') ? (raw.split('.').pop() ?? raw) : raw,
        );
        tsParts.push(`${alias} = ${mappedFunc}(${resolved})`);
      }
      dql = `timeseries {${tsParts.join(', ')}}${byStr}${filterStr}${intervalPart}`;
    } else {
      dql = `timeseries ${dtFunc}(${dtMetric})${byStr}${filterStr}${intervalPart}`;
    }

    if (partsNotes.length > 0) {
      return partsNotes.join('\n') + '\n' + dql;
    }
    return dql;
  }

  private isComputedMetricExpr(node: ASTNode): boolean {
    if (node.type === 'binary') {
      const hasAggLeft = this.containsAgg(node.left);
      const hasAggRight = this.containsAgg(node.right);
      if (hasAggLeft && (hasAggRight || node.right.type === 'literal')) {
        const aggs: FunctionCall[] = [];
        this.collectAggs(node, aggs);
        return aggs.length >= 2;
      }
    }
    return false;
  }

  private containsAgg(node: ASTNode): boolean {
    if (node.type === 'function' && AGG_FUNCTIONS.has(node.name.toLowerCase())) {
      return true;
    }
    if (node.type === 'binary') {
      return this.containsAgg(node.left) || this.containsAgg(node.right);
    }
    if (node.type === 'unaryMinus') {
      return this.containsAgg(node.expr);
    }
    return false;
  }

  private collectAggs(node: ASTNode, aggs: FunctionCall[]): void {
    if (node.type === 'function' && AGG_FUNCTIONS.has(node.name.toLowerCase())) {
      aggs.push(node);
    } else if (node.type === 'binary') {
      this.collectAggs(node.left, aggs);
      this.collectAggs(node.right, aggs);
    } else if (node.type === 'unaryMinus') {
      this.collectAggs(node.expr, aggs);
    }
  }

  private emitComputedMetric(
    item: SelectItem,
    byStr: string,
    filterStr: string,
  ): string {
    const aggs: FunctionCall[] = [];
    this.collectAggs(item.expression, aggs);

    const aggAliases = new Map<FunctionCall, string>();
    const tsParts: string[] = [];

    for (let i = 0; i < aggs.length; i++) {
      const agg = at(aggs, i);
      const alias = `m${i + 1}`;
      aggAliases.set(agg, alias);

      let rawField = '';
      if (agg.args.length > 0 && at(agg.args, 0).type !== 'star') {
        rawField = this.extractFieldName(at(agg.args, 0));
      }
      const fk = rawField
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/_/g, '')
        .replace(/`/g, '');
      const dtM = this.resolveMetricField(fk, rawField);
      const dtF = this.mapMetricAgg(agg.name.toLowerCase());

      tsParts.push(`${alias} = ${dtF}(${dtM})`);
    }

    let dql: string;
    if (tsParts.length > 1) {
      dql = `timeseries {${tsParts.join(', ')}}${byStr}${filterStr}`;
    } else {
      dql = `timeseries ${at(tsParts, 0)}${byStr}${filterStr}`;
    }

    const calcExpr = this.emitComputedExpr(item.expression, aggAliases);
    const resultName = item.alias
      ? this.sanitizeAlias(item.alias)
      : 'result';
    dql += `\n| fieldsAdd ${resultName} = ${calcExpr}`;

    return dql;
  }

  private emitComputedExpr(
    node: ASTNode,
    aggAliases: Map<FunctionCall, string>,
  ): string {
    if (
      node.type === 'function' &&
      AGG_FUNCTIONS.has(node.name.toLowerCase())
    ) {
      const alias = aggAliases.get(node as FunctionCall) ?? 'unknown';
      return `toDouble(${alias})`;
    }
    if (node.type === 'binary') {
      const left = this.emitComputedExpr(node.left, aggAliases);
      const right = this.emitComputedExpr(node.right, aggAliases);
      return `(${left} ${node.op} ${right})`;
    }
    if (node.type === 'literal') {
      const v = node.value;
      if (typeof v === 'number') {
        return Number.isInteger(v) ? `${v}.0` : String(v);
      }
      return String(v);
    }
    if (node.type === 'unaryMinus') {
      const inner = this.emitComputedExpr(node.expr, aggAliases);
      return `-${inner}`;
    }
    return this.emitExpr(node);
  }

  private emitMetricTransform(
    transform: MetricTransform,
    byStr: string,
    filterStr: string,
  ): string {
    const ttype = transform.type;
    const note = transform.note ?? '';
    let dql: string;

    if (ttype === 'calculated') {
      const template = transform.dql_single ?? transform.dql ?? '';
      dql = template.replace(/{by}/g, byStr).replace(/{filter}/g, filterStr);
    } else if (ttype === 'multi_metric') {
      dql = (transform.dql ?? '').replace(/{by}/g, byStr).replace(/{filter}/g, filterStr);
    } else if (ttype === 'unit_convert') {
      const metric = transform.metric ?? '';
      const postCalc = transform.post_calc ?? '';
      const alias = (metric.split('.').pop() ?? metric).slice(0, 12);
      dql = `timeseries ${alias} = avg(${metric})${byStr}${filterStr}`;
      if (postCalc) {
        dql += `\n${postCalc.replace(/{alias}/g, alias)}`;
      }
    } else {
      dql = `// Unknown transform type: ${ttype}`;
    }

    if (note) {
      dql = `// ${note}\n${dql}`;
    }
    return dql;
  }

  private extractMetricAggs(
    items: SelectItem[],
  ): Array<[string, string, string]> {
    const results: Array<[string, string, string]> = [];
    for (const item of items) {
      const extracted = this.walkForAgg(item.expression);
      if (extracted) {
        results.push(...extracted);
      }
    }
    return results;
  }

  private walkForAgg(
    node: ASTNode,
  ): Array<[string, string, string]> {
    if (node.type === 'function') {
      if (AGG_FUNCTIONS.has(node.name.toLowerCase())) {
        let rawField = '';
        if (node.args.length > 0 && at(node.args, 0).type !== 'star') {
          rawField = this.extractFieldName(at(node.args, 0));
        }
        return [[node.name.toLowerCase(), node.name.toLowerCase(), rawField]];
      }
    }
    if (node.type === 'binary') {
      const left = this.walkForAgg(node.left);
      const right = this.walkForAgg(node.right);
      return [...(left ?? []), ...(right ?? [])];
    }
    return [];
  }

  private extractFieldName(node: ASTNode): string {
    if (node.type === 'field') return node.name;
    if (node.type === 'function') {
      if (node.args.length > 0) {
        return this.extractFieldName(at(node.args, 0));
      }
    }
    return '';
  }

  private resolveMetricField(fieldKey: string, rawField: string): string {
    // 0. K8s context overrides
    if (this.currentK8sContext) {
      const k8sMetric = DQLEmitter.K8S_METRIC_OVERRIDES[fieldKey];
      if (k8sMetric) return k8sMetric;
    }

    // 1. Static map
    const dtMetric = this.metricMap[fieldKey];
    if (dtMetric) {
      if (this.metricResolver) {
        const [validated, warning] = this.metricResolver(
          fieldKey,
          rawField,
          dtMetric,
        );
        if (warning) this.warnings.push(warning);
        return validated;
      }
      return dtMetric;
    }

    // 2. Live resolver
    if (this.metricResolver) {
      const [resolved, warning] = this.metricResolver(
        fieldKey,
        rawField,
        null,
      );
      if (warning) this.warnings.push(warning);
      if (resolved) return resolved;
    }

    // Already a DT metric?
    if (rawField.startsWith('dt.') || rawField.startsWith('builtin:')) {
      return rawField;
    }

    // 3. Passthrough with warning
    this.warnings.push(
      `Unknown metric '${rawField}' -- no METRIC_MAP entry, no live registry match`,
    );
    return rawField;
  }

  private mapMetricAgg(func: string): string {
    const funcLow = func.toLowerCase();
    if (['latest', 'last', 'first', 'earliest', 'average'].includes(funcLow)) {
      return 'avg';
    }
    if (funcLow === 'derivative') {
      this.warnings.push(
        'derivative() -> DQL delta() in timeseries context',
      );
      return 'delta';
    }
    if (funcLow === 'bucketpercentile') {
      this.warnings.push(
        'bucketPercentile() -> DQL percentile() for Prometheus histograms',
      );
      return 'percentile';
    }
    const dt = FUNC_MAP[funcLow] ?? funcLow;
    const validTs = new Set([
      'sum', 'avg', 'min', 'max', 'count', 'countIf',
      'countDistinctExact', 'countDistinctApprox',
      'percentile', 'stddev', 'variance', 'delta',
    ]);
    if (!validTs.has(dt)) {
      this.warnings.push(`'${dt}' not valid for timeseries -- using avg`);
      return 'avg';
    }
    return dt;
  }

  private splitMetricConditions(
    cond: Condition,
  ): [Condition | undefined, string[]] {
    const metricFields = new Set([
      'allocatablememoryutilization', 'memoryusedbytes', 'memoryavailablebytes',
      'fscapacityutilization', 'fsavailablebytes', 'fsinodesused', 'fsinodes',
      'cpuusedbytes', 'allocatablecpuutilization', 'fsinodescapacityutilization',
    ]);
    const stripped: string[] = [];

    const walk = (c: Condition): Condition | undefined => {
      if (c.type === 'comparison') {
        if (
          c.left.type === 'field' &&
          metricFields.has(
            c.left.name.toLowerCase().replace(/\./g, '').replace(/_/g, ''),
          )
        ) {
          stripped.push(c.left.name);
          return undefined;
        }
        return c;
      }
      if (c.type === 'logical') {
        const left = walk(c.left);
        const right = walk(c.right);
        if (left === undefined && right === undefined) return undefined;
        if (left === undefined) return right;
        if (right === undefined) return left;
        return { type: 'logical', op: c.op, left, right };
      }
      if (c.type === 'not') {
        const inner = walk(c.inner);
        return inner ? { type: 'not', inner } : undefined;
      }
      return c;
    };

    const remaining = walk(cond);
    return [remaining, stripped];
  }

  // -----------------------------------------------------------------------
  // EVENTS QUERIES (fetch events)
  // -----------------------------------------------------------------------

  private emitEventsQuery(query: Query): string {
    const parts: string[] = ['fetch events'];

    if (query.where) {
      parts.push(`| filter ${this.emitCondition(query.where)}`);
    }

    const fieldExprs = query.selectItems
      .filter((item) => !this.isAggExpr(item.expression))
      .map((item) => this.emitExpr(item.expression));
    if (fieldExprs.length > 0) {
      parts.push(`| fields ${fieldExprs.join(', ')}`);
    }

    if (query.limit && query.limit.value !== 'MAX') {
      parts.push(`| limit ${query.limit.value}`);
    }

    return parts.join('\n');
  }

  // -----------------------------------------------------------------------
  // FETCH QUERIES (spans, logs, bizevents, etc.)
  // -----------------------------------------------------------------------

  private emitFetchQuery(query: Query, fetchType: string): string {
    const parts: string[] = [];

    // 1. fetch <type>
    parts.push(`fetch ${fetchType}`);

    // 1b. Auto-filter for TransactionError
    const fromType = query.fromClause
      .toLowerCase()
      .replace(/_/g, '')
      .replace(/-/g, '');
    if (fromType === 'transactionerror') {
      parts.push('| filter otel.status_code == "ERROR"');
    }

    // 2. Filter -- extract subqueries for separate lookup steps
    let subqueries: InSubqueryCond[] = [];
    let remainingWhere: Condition | undefined;
    if (query.where) {
      [remainingWhere, subqueries] = this.extractSubqueries(query.where);
    }

    if (remainingWhere) {
      const filterStr = this.emitCondition(remainingWhere);
      parts.push(`| filter ${filterStr}`);
    }

    // 3. Lookup steps from subqueries
    for (const sq of subqueries) {
      this.emitLookup(sq, parts);
    }

    // 4. Aggregation
    const hasAgg = this.hasAggregation(query.selectItems);
    const hasTs = query.timeseries !== undefined;

    if (hasTs || hasAgg) {
      const cmd = hasTs ? 'makeTimeseries' : 'summarize';
      let byClause = '';

      // CASES in FACET handling
      const facetFieldsAdd: string[] = [];
      if (query.facetItems && query.facetItems.length > 0) {
        const hasCases = query.facetItems.some(
          (fi) =>
            fi.expression.type === 'function' &&
            fi.expression.name.toLowerCase() === 'cases',
        );
        if (hasCases) {
          const byRefs: string[] = [];
          for (let i = 0; i < query.facetItems.length; i++) {
            const fItem = at(query.facetItems, i);
            if (
              fItem.expression.type === 'function' &&
              fItem.expression.name.toLowerCase() === 'cases'
            ) {
              const colName = this.sanitizeAlias(
                fItem.alias ?? `_category_${i + 1}`,
              );
              const casesExpr = this.emitExpr(fItem.expression);
              facetFieldsAdd.push(`${colName} = ${casesExpr}`);
              byRefs.push(colName);
            } else {
              const exprStr = this.emitExpr(fItem.expression);
              if (fItem.alias) {
                byRefs.push(
                  `${this.sanitizeAlias(fItem.alias)}=${exprStr}`,
                );
              } else {
                byRefs.push(exprStr);
              }
            }
          }
          byClause = `, by: {${byRefs.join(', ')}}`;
        } else {
          const byItems = this.emitFacetItems(query.facetItems);
          byClause = `, by: {${byItems}}`;
        }
      }

      // Emit fieldsAdd for CASES before aggregation
      for (const fa of facetFieldsAdd) {
        parts.push(`| fieldsAdd ${fa}`);
      }

      // Interval for makeTimeseries
      let intervalClause = '';
      if (hasTs) {
        const intStr = DQLEmitter.formatInterval(query.timeseries);
        if (intStr) {
          intervalClause = `, interval: ${intStr}`;
        }
      }

      // Check for computed-aggregation expressions that need decomposition
      const decomposed = this.decomposeComputedAggs(
        query.selectItems,
        hasTs,
      );

      if (decomposed) {
        const [aggExprs, fieldsAdd] = decomposed;
        // Inject histogram bin if set
        if (this.histogramBinExpr) {
          if (byClause) {
            byClause = byClause.slice(0, -1) + `, ${this.histogramBinExpr}}`;
          } else {
            byClause = `, by: {${this.histogramBinExpr}}`;
          }
          this.histogramBinExpr = undefined;
        }
        const aggStr = this.formatAggList(cmd, aggExprs);
        parts.push(`| ${cmd} ${aggStr}${byClause}${intervalClause}`);
        for (const fa of fieldsAdd) {
          parts.push(`| fieldsAdd ${fa}`);
        }
      } else {
        const aggExprs = this.emitAggregations(
          query.selectItems,
          hasTs,
        );
        // Inject histogram bin if set
        if (this.histogramBinExpr) {
          if (byClause) {
            byClause = byClause.slice(0, -1) + `, ${this.histogramBinExpr}}`;
          } else {
            byClause = `, by: {${this.histogramBinExpr}}`;
          }
          this.histogramBinExpr = undefined;
        }
        const aggStr = this.formatAggList(cmd, aggExprs);
        parts.push(`| ${cmd} ${aggStr}${byClause}${intervalClause}`);
      }
    } else {
      // No aggregation -- project fields
      const fieldExprs = query.selectItems.map((item) =>
        this.emitExpr(item.expression),
      );
      parts.push(`| fields ${fieldExprs.join(', ')}`);
      if (query.facetItems && query.facetItems.length > 0) {
        const byItems = this.emitFacetItems(query.facetItems);
        parts.push(`| summarize by: {${byItems}}`);
      }
    }

    // 4b. Funnel conversion rates
    if (this.funnelSteps.length >= 2) {
      for (let i = 0; i < this.funnelSteps.length - 1; i++) {
        const stepCurEntry = at(this.funnelSteps, i);
        const stepNextEntry = at(this.funnelSteps, i + 1);
        const stepCur = stepCurEntry[0];
        const stepNext = stepNextEntry[0];
        const labelCur = stepCurEntry[1];
        const labelNext = stepNextEntry[1];
        const safeCur = labelCur.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeNext = labelNext.replace(/[^a-zA-Z0-9_]/g, '_');
        parts.push(
          `| fieldsAdd conv_${safeCur}_to_${safeNext} = ` +
            `(toDouble(${stepNext}) / toDouble(${stepCur})) * 100.0`,
        );
      }
      this.funnelSteps = [];
    }

    // 5. Sort
    if (query.orderBy) {
      const direction =
        query.orderBy.direction === 'ASC' ? 'asc' : 'desc';
      const expr = this.emitExpr(query.orderBy.expression);
      parts.push(`| sort ${expr} ${direction}`);
    }

    // 6. Limit
    if (query.limit && query.limit.value !== 'MAX') {
      parts.push(`| limit ${query.limit.value}`);
    }

    return parts.join('\n');
  }

  // -----------------------------------------------------------------------
  // Aggregations
  // -----------------------------------------------------------------------

  private hasAggregation(items: SelectItem[]): boolean {
    return items.some((item) => this.isAggExpr(item.expression));
  }

  private isAggExpr(node: ASTNode): boolean {
    if (node.type === 'function') {
      if (AGG_FUNCTIONS.has(node.name.toLowerCase())) return true;
    }
    if (node.type === 'binary') {
      return this.isAggExpr(node.left) || this.isAggExpr(node.right);
    }
    if (node.type === 'unaryMinus') {
      return this.isAggExpr(node.expr);
    }
    return false;
  }

  private sanitizeAlias(alias: string): string {
    if (!alias) return alias;
    // Starts with digit -> backtick
    if (/^\d/.test(alias)) return `\`${alias}\``;
    // DQL reserved word -> backtick
    if (DQLEmitter.DQL_RESERVED_WORDS.has(alias.toLowerCase())) {
      return `\`${alias}\``;
    }
    // Contains spaces or special chars -> backtick
    if (/[^a-zA-Z0-9_]/.test(alias)) return `\`${alias}\``;
    return alias;
  }

  private formatAggList(cmd: string, aggExprs: string[]): string {
    let totalItems = 0;
    for (const expr of aggExprs) {
      totalItems += (expr.match(/\), /g) ?? []).length + 1;
    }

    const joined = aggExprs.join(', ');

    if (totalItems > 1 && (cmd === 'makeTimeseries' || cmd === 'summarize')) {
      return '{' + joined + '}';
    }
    return joined;
  }

  private emitAggregations(
    items: SelectItem[],
    needsNaming: boolean,
  ): string[] {
    const seen = new Map<string, string>();
    const result: string[] = [];

    for (const item of items) {
      const exprStr = this.emitAggExpr(item.expression);

      const alias = item.alias ? this.sanitizeAlias(item.alias) : undefined;

      // Dedup: if same expression with no alias, skip
      const normalized = exprStr.toLowerCase().trim();
      if (!alias && seen.has(normalized)) continue;
      seen.set(normalized, exprStr);

      const alreadyNamed = exprStr.includes('(')
        ? (exprStr.split('(')[0] ?? '').includes('=')
        : exprStr.includes('=');

      if (alias && alreadyNamed) {
        if (exprStr.includes(', ') && (exprStr.match(/=/g) ?? []).length > 1) {
          result.push(exprStr);
        } else {
          const eqPos = exprStr.indexOf('=');
          result.push(`${alias}=${exprStr.slice(eqPos + 1)}`);
        }
      } else if (alias) {
        result.push(`${alias}=${exprStr}`);
      } else if (alreadyNamed) {
        result.push(exprStr);
      } else if (needsNaming && this.needsNaming(item.expression)) {
        const autoName = this.autoName(item.expression);
        result.push(`${autoName}=${exprStr}`);
      } else {
        result.push(exprStr);
      }
    }

    return result;
  }

  private needsNaming(node: ASTNode): boolean {
    if (node.type === 'function') {
      if (
        node.name.toLowerCase() === 'percentile' &&
        node.args.length >= 2
      ) {
        return true;
      }
      if (node.args.length >= 2 && AGG_FUNCTIONS.has(node.name.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  private autoName(node: ASTNode): string {
    if (node.type === 'function') {
      const name = node.name.toLowerCase();
      if (name === 'percentile' && node.args.length >= 2) {
        const pctArg = at(node.args, 1);
        if (
          pctArg.type === 'literal' &&
          typeof pctArg.value === 'number'
        ) {
          return `p${Math.floor(pctArg.value)}`;
        }
      }
      return `${FUNC_MAP[name] ?? name}_${this.nextCounter()}`;
    }
    return `agg_${this.nextCounter()}`;
  }

  // -----------------------------------------------------------------------
  // Computed-aggregation decomposition for makeTimeseries
  // -----------------------------------------------------------------------

  private containsComputedAgg(node: ASTNode): boolean {
    if (node.type === 'function') {
      const nameLow = node.name.toLowerCase();
      if (nameLow === 'cdfpercentage') return true;
      if (nameLow === 'percentage' && node.where) return true;
    }
    if (node.type === 'binary') {
      const leftAgg = this.isAggExpr(node.left);
      const rightAgg = this.isAggExpr(node.right);
      if (leftAgg && rightAgg) return true;
      if (leftAgg || rightAgg) return true;
    }
    return false;
  }

  private decomposeComputedAggs(
    items: SelectItem[],
    isTimeseries: boolean,
  ): [string[], string[]] | undefined {
    if (!isTimeseries) return undefined;

    const needsDecomp = items.some((item) =>
      this.containsComputedAgg(item.expression),
    );
    if (!needsDecomp) return undefined;

    const aggStrings: string[] = [];
    const fieldsAdd: string[] = [];
    let counter = 0;
    const seenCount: string[] = [];

    const nextId = (): number => {
      counter++;
      return counter;
    };

    const getCountAlias = (): string => {
      if (seenCount.length === 0) {
        const alias = `_total_${nextId()}`;
        aggStrings.push(`${alias}=count()`);
        seenCount.push(alias);
      }
      return at(seenCount, 0);
    };

    // Pre-scan: check if any expression actually uses count()
    const exprNeedsCount = (expr: ASTNode): boolean => {
      if (expr.type === 'function') {
        if (['cdfpercentage', 'percentage'].includes(expr.name.toLowerCase())) {
          return true;
        }
        if (expr.name.toLowerCase() === 'count') return true;
      }
      if (expr.type === 'binary') {
        return exprNeedsCount(expr.left) || exprNeedsCount(expr.right);
      }
      return false;
    };

    const anyNeedsCount = items.some((item) =>
      exprNeedsCount(item.expression),
    );
    if (anyNeedsCount) {
      getCountAlias();
    }

    for (const item of items) {
      const expr = item.expression;

      // -- cdfPercentage(field, t1, t2, ...) --
      if (
        expr.type === 'function' &&
        expr.name.toLowerCase() === 'cdfpercentage' &&
        expr.args.length >= 2
      ) {
        const fieldStr = this.emitExpr(at(expr.args, 0));
        const totalAlias = getCountAlias();

        for (const arg of expr.args.slice(1)) {
          const tStr = this.emitExpr(arg);
          const tLabel = tStr.replace(/\./g, '_').replace(/-/g, '_');
          const belowAlias = `_below_${tLabel}_${nextId()}`;
          aggStrings.push(
            `${belowAlias}=countIf(${fieldStr} <= ${tStr})`,
          );
          const pctName = `pct_le_${tLabel}`;
          fieldsAdd.push(
            `${pctName} = 100.0 * toDouble(${belowAlias}) / toDouble(${totalAlias})`,
          );
        }

        this.warnings.push(
          'cdfPercentage() -> decomposed into countIf/count ' +
            'aggregations + fieldsAdd percentages',
        );
        continue;
      }

      // -- percentage(count(*), WHERE cond) --
      if (
        expr.type === 'function' &&
        expr.name.toLowerCase() === 'percentage' &&
        expr.where
      ) {
        const condStr = this.emitCondition(expr.where);
        const matchedAlias = `_matched_${nextId()}`;
        const totalAlias = getCountAlias();
        aggStrings.push(`${matchedAlias}=countIf(${condStr})`);
        const resultName = item.alias
          ? this.sanitizeAlias(item.alias)
          : `percentage_${nextId()}`;
        fieldsAdd.push(
          `${resultName} = 100.0 * toDouble(${matchedAlias}) / toDouble(${totalAlias})`,
        );
        continue;
      }

      // -- BinaryOp between aggregations --
      if (
        expr.type === 'binary' &&
        this.containsComputedAgg(expr)
      ) {
        const localAggs: FunctionCall[] = [];
        this.collectAggs(expr, localAggs);
        const localAliases = new Map<FunctionCall, string>();
        for (const agg of localAggs) {
          const alias = `_m${nextId()}`;
          localAliases.set(agg, alias);
          const aggStr = this.emitAggExpr(agg);
          if (aggStr === 'count()' && seenCount.length > 0) {
            localAliases.set(agg, at(seenCount, 0));
          } else {
            aggStrings.push(`${alias}=${aggStr}`);
            if (aggStr === 'count()') {
              seenCount.push(alias);
            }
          }
        }
        const calcExpr = this.emitComputedExpr(expr, localAliases);
        const resultName = item.alias
          ? this.sanitizeAlias(item.alias)
          : `computed_${nextId()}`;
        fieldsAdd.push(`${resultName} = ${calcExpr}`);
        continue;
      }

      // -- Normal aggregation -- pass through --
      const aggStr = this.emitAggExpr(expr);
      if (aggStr === 'count()' && seenCount.length > 0) {
        if (item.alias) {
          fieldsAdd.push(
            `${this.sanitizeAlias(item.alias)} = toDouble(${at(seenCount, 0)})`,
          );
        }
        continue;
      }
      if (item.alias) {
        aggStrings.push(`${this.sanitizeAlias(item.alias)}=${aggStr}`);
      } else if (this.needsNaming(expr)) {
        const autoN = this.autoName(expr);
        aggStrings.push(`${autoN}=${aggStr}`);
      } else {
        aggStrings.push(aggStr);
      }
    }

    // Deduplicate aggStrings
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const a of aggStrings) {
      if (!seen.has(a)) {
        seen.add(a);
        deduped.push(a);
      }
    }

    return [deduped, fieldsAdd];
  }

  private nextCounter(): number {
    this.aggCounter++;
    return this.aggCounter;
  }

  private emitAggExpr(node: ASTNode): string {
    if (node.type === 'function') {
      return this.emitFunction(node);
    }
    if (node.type === 'binary') {
      const left = this.emitAggExpr(node.left);
      const right = this.emitAggExpr(node.right);
      return `${left} ${node.op} ${right}`;
    }
    if (node.type === 'unaryMinus') {
      return `-${this.emitAggExpr(node.expr)}`;
    }
    if (node.type === 'literal') {
      return this.emitLiteral(node);
    }
    return this.emitExpr(node);
  }

  // -----------------------------------------------------------------------
  // Functions
  // -----------------------------------------------------------------------

  private emitFunction(node: FunctionCall): string {
    const nameLow = node.name.toLowerCase();

    // -- percentage(count(*), WHERE cond)
    if (nameLow === 'percentage' && node.where) {
      const condStr = this.emitCondition(node.where);
      const aggKeywords = [
        'countIf(', 'count()', 'sum(', 'avg(', 'min(', 'max(', 'percentile(',
      ];
      const hasNestedAgg = aggKeywords.some((kw) => condStr.includes(kw));
      if (hasNestedAgg) {
        this.warnings.push(
          'percentage() wrapping aggregation functions detected. ' +
            'DQL does not support nested aggregations. ' +
            'This query needs manual decomposition into: ' +
            'summarize step1 aggregations | fieldsAdd percentage calculation',
        );
        return (
          '// ERROR: Nested aggregation detected - manual fix required\n' +
          '// Original: percentage(count(*), WHERE <complex condition>)\n' +
          '// Fix: Use multi-step pipeline:\n' +
          '//   | summarize matching = countIf(<simple_condition>), total = count()\n' +
          '//   | fieldsAdd pct = 100.0 * toDouble(matching) / toDouble(total)\n' +
          `(100.0 * countIf(${condStr}) / count())`
        );
      }
      return `(100.0 * countIf(${condStr}) / count())`;
    }

    // -- count(*, filter(WHERE cond)) -> countIf(cond)
    const filterIfFunc = FILTER_IF_MAP[nameLow];
    if (filterIfFunc && node.args.length > 0) {
      for (const arg of node.args) {
        if (
          arg.type === 'function' &&
          arg.name.toLowerCase() === 'filter' &&
          arg.where
        ) {
          const condStr = this.emitCondition(arg.where);
          const otherArgs = node.args
            .filter((a) => a !== arg && a.type !== 'star')
            .map((a) => this.emitExpr(a));
          if (otherArgs.length > 0) {
            return `${filterIfFunc}(${otherArgs.join(', ')}, ${condStr})`;
          }
          return `${filterIfFunc}(${condStr})`;
        }
      }
    }

    // -- filter(func(field), WHERE cond) -> funcIf(field, cond)
    if (nameLow === 'filter' && node.where && node.args.length > 0) {
      const inner = at(node.args, 0);
      if (inner.type === 'function') {
        const dtIf = FILTER_IF_MAP[inner.name.toLowerCase()];
        if (dtIf) {
          const fieldStr = inner.args.length > 0
            ? inner.args.map((a) => this.emitExpr(a)).join(', ')
            : '';
          const condStr = this.emitCondition(node.where);
          if (fieldStr && at(inner.args, 0).type !== 'star') {
            return `${dtIf}(${fieldStr}, ${condStr})`;
          } else {
            return `${dtIf}(${condStr})`;
          }
        } else {
          this.warnings.push(
            `filter(${inner.name}(...), WHERE ...) has no DQL funcIf equivalent`,
          );
        }
      }
    }

    // -- rate(count(*), 1 minute) -> count() with warning
    if (nameLow === 'rate') {
      this.warnings.push(
        'rate() not directly supported in DQL makeTimeseries; using base aggregation',
      );
      if (node.args.length > 0 && at(node.args, 0).type === 'function') {
        return this.emitFunction(at(node.args, 0) as FunctionCall);
      }
      return 'count()';
    }

    // -- median(field) -> percentile(field, 50)
    if (nameLow === 'median') {
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        return `percentile(${fieldStr}, 50)`;
      }
      return 'percentile(duration, 50)';
    }

    // -- stddev(field) -> DQL native stddev()
    if (nameLow === 'stddev') {
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        return `stddev(${fieldStr})`;
      }
      return 'stddev(duration)';
    }

    // -- substring(str, start, end) -> substring(str, from:start, to:end)
    if (nameLow === 'substring' && node.args.length === 3) {
      const strExpr = this.emitExpr(at(node.args, 0));
      const startExpr = this.emitExpr(at(node.args, 1));
      const endExpr = this.emitExpr(at(node.args, 2));
      return `substring(${strExpr}, from:${startExpr}, to:${endExpr})`;
    }

    // -- histogram(field, numBars, ceiling, [width])
    if (nameLow === 'histogram') {
      const fieldExpr =
        node.args.length > 0 ? this.emitExpr(at(node.args, 0)) : 'duration';
      let binWidth: string | undefined;
      if (node.args.length >= 4) {
        binWidth = this.emitExpr(at(node.args, 3));
      } else if (node.args.length >= 3) {
        try {
          const numBars = parseFloat(this.emitExpr(at(node.args, 1)));
          const ceiling = parseFloat(this.emitExpr(at(node.args, 2)));
          if (numBars > 0) {
            const rawWidth = ceiling / numBars;
            binWidth =
              rawWidth === Math.floor(rawWidth)
                ? String(Math.floor(rawWidth))
                : String(rawWidth);
          }
        } catch {
          binWidth = '1';
        }
      } else if (node.args.length >= 2) {
        binWidth = '1';
      }
      if (!binWidth || binWidth === '0') {
        binWidth = '1';
      }

      this.warnings.push(
        `histogram(${fieldExpr}) -> count() by bin(${fieldExpr}, ${binWidth}) as categoricalBarChart`,
      );
      this.histogramBinExpr = `bin(${fieldExpr}, ${binWidth})`;
      return 'count()';
    }

    // -- funnel(steps)
    if (nameLow === 'funnel') {
      this.funnelSteps = [];
      if (node.args.length === 0) return 'count()';

      // Skip column argument (first arg)
      const steps: Array<[Condition, string]> = [];
      let pendingCond: Condition | undefined;
      for (let ai = 1; ai < node.args.length; ai++) {
        const arg = at(node.args, ai);
        if (isCondition(arg)) {
          pendingCond = arg;
        } else if (arg.type === 'literal' && pendingCond) {
          const label = String(arg.value);
          steps.push([pendingCond, label]);
          pendingCond = undefined;
        }
      }
      if (pendingCond) {
        steps.push([pendingCond, `Step ${steps.length + 1}`]);
      }

      if (steps.length === 0) return 'count()';

      const aggParts: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        const step = at(steps, i);
        const cond = step[0];
        const label = step[1];
        const safeLabel = label.replace(/[^a-zA-Z0-9_]/g, '_');
        const condStr = this.emitCondition(cond);
        aggParts.push(`step${i + 1}_${safeLabel}=countIf(${condStr})`);
      }

      this.funnelSteps = steps.map((step, i) => {
        const label = step[1];
        return [
          `step${i + 1}_${label.replace(/[^a-zA-Z0-9_]/g, '_')}`,
          label,
        ];
      });

      this.warnings.push(
        `FUNNEL decomposed into ${steps.length} countIf() steps with conversion rates. ` +
          'Use DT\'s Funnel tile visualization for best results.',
      );
      return aggParts.join(', ');
    }

    // -- apdex(t:threshold)
    if (nameLow === 'apdex') {
      let threshold = 0.5;
      for (const arg of node.args) {
        if (arg.type === 'literal' && typeof arg.value === 'number') {
          threshold = arg.value;
        } else if (arg.type === 'field') {
          const tMatch = arg.name.match(/^t:(\d+(?:\.\d+)?)$/i);
          if (tMatch?.[1]) {
            threshold = parseFloat(tMatch[1]);
          }
        }
      }
      const frustratedT = threshold * 4;
      this.warnings.push(
        `apdex(t:${threshold}) decomposed into multi-step: ` +
          'summarize satisfied/tolerating/total then fieldsAdd',
      );
      return (
        `(countIf(duration < ${threshold}s) + ` +
        `countIf(duration >= ${threshold}s and duration < ${frustratedT}s) * 0.5) ` +
        '/ count()'
      );
    }

    // -- CASES(WHERE cond, 'label', ...)
    if (nameLow === 'cases') {
      const pairs: Array<[string, string]> = [];
      let i = 0;
      while (i < node.args.length) {
        const arg = at(node.args, i);
        if (i + 1 < node.args.length) {
          const nextArg = at(node.args, i + 1);
          if (isCondition(arg)) {
            const cond = this.emitCondition(arg);
            const label = this.emitExpr(nextArg);
            pairs.push([cond, label]);
            i += 2;
          } else if (arg.type === 'function') {
            const cond = this.emitFunction(arg);
            const label = this.emitExpr(nextArg);
            pairs.push([cond, label]);
            i += 2;
          } else {
            i += 1;
          }
        } else {
          i += 1;
        }
      }
      if (pairs.length === 0) return '"Other"';
      let result = '"Other"';
      for (const [cond, label] of [...pairs].reverse()) {
        result = `if(${cond}, ${label}, else:${result})`;
      }
      return result;
    }

    // -- Multi-percentile: percentile(duration, 50, 90, 95, 99)
    if (nameLow === 'percentile' && node.args.length >= 3) {
      const fieldStr = this.emitExpr(at(node.args, 0));
      const pcts: number[] = [];
      for (const a of node.args.slice(1)) {
        if (a.type === 'literal' && typeof a.value === 'number') {
          pcts.push(Math.floor(a.value));
        }
      }
      return pcts
        .map((p) => `p${p}=percentile(${fieldStr}, ${p})`)
        .join(', ');
    }

    // -- count(*) -> count()
    if (nameLow === 'count') {
      if (
        node.args.length === 0 ||
        (node.args.length === 1 && at(node.args, 0).type === 'star')
      ) {
        return 'count()';
      }
      if (node.args.length === 1) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        return `countIf(isNotNull(${fieldStr}))`;
      }
    }

    // -- derivative(attr, time_interval) -> delta(field)
    if (nameLow === 'derivative') {
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        if (node.args.length >= 2 && at(node.args, 1).type === 'timeInterval') {
          const ti = at(node.args, 1) as unknown as { value: number; unit: string };
          this.warnings.push(
            `derivative(${fieldStr}, ${ti.value} ${ti.unit}) -> ` +
              'DQL delta() or rate() over makeTimeseries interval',
          );
          return `delta(${fieldStr})`;
        }
        this.warnings.push('derivative() -> DQL delta() function');
        return `delta(${fieldStr})`;
      }
      return 'delta(duration)';
    }

    // -- jparse(jsonStr, 'path')
    if (nameLow === 'jparse') {
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        if (node.args.length >= 2) {
          const pathArg = at(node.args, 1);
          if (
            pathArg.type === 'literal' &&
            typeof pathArg.value === 'string'
          ) {
            const path = pathArg.value.replace(/^\$\.?/, '');
            return `${fieldStr}[\`${path}\`]`;
          }
        }
        this.warnings.push(
          'jparse() -> access JSON fields directly in DQL (record type)',
        );
        return fieldStr;
      }
      return '/* jparse() */';
    }

    // -- clamp_max(value, max)
    if (nameLow === 'clamp_max') {
      if (node.args.length >= 2) {
        const valStr = this.emitExpr(at(node.args, 0));
        const maxStr = this.emitExpr(at(node.args, 1));
        return `if(${valStr} > ${maxStr}, ${maxStr}, else:${valStr})`;
      }
      const argsStr = node.args.map((a) => this.emitExpr(a)).join(', ');
      return `clamp_max(${argsStr})`;
    }

    // -- clamp_min(value, min)
    if (nameLow === 'clamp_min') {
      if (node.args.length >= 2) {
        const valStr = this.emitExpr(at(node.args, 0));
        const minStr = this.emitExpr(at(node.args, 1));
        return `if(${valStr} < ${minStr}, ${minStr}, else:${valStr})`;
      }
      const argsStr = node.args.map((a) => this.emitExpr(a)).join(', ');
      return `clamp_min(${argsStr})`;
    }

    // -- cdfPercentage(attr, threshold1, threshold2, ...)
    if (nameLow === 'cdfpercentage') {
      if (node.args.length >= 2) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        const cdfParts: string[] = [];
        for (const arg of node.args.slice(1)) {
          const tStr = this.emitExpr(arg);
          cdfParts.push(`(100.0 * countIf(${fieldStr} <= ${tStr}) / count())`);
        }
        this.warnings.push(
          'cdfPercentage() -> computed as countIf(field <= threshold) / count() * 100',
        );
        return cdfParts.join(', ');
      }
      return '/* cdfPercentage() requires field and threshold args */';
    }

    // -- bucketPercentile(bucket_attr, p1, p2, ...)
    if (nameLow === 'bucketpercentile') {
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        if (node.args.length >= 2) {
          const pcts: number[] = [];
          for (const a of node.args.slice(1)) {
            if (a.type === 'literal' && typeof a.value === 'number') {
              pcts.push(Math.floor(a.value));
            }
          }
          this.warnings.push(
            'bucketPercentile() (Prometheus histogram) -> DQL percentile(). ' +
              'Ensure metric uses _bucket suffix.',
          );
          if (pcts.length > 0) {
            return pcts
              .map((p) => `p${p}=percentile(${fieldStr}, ${p})`)
              .join(', ');
          }
        }
        return (
          `p1=percentile(${fieldStr}, 1), p25=percentile(${fieldStr}, 25), ` +
          `p50=percentile(${fieldStr}, 50), p75=percentile(${fieldStr}, 75), ` +
          `p99=percentile(${fieldStr}, 99)`
        );
      }
      return 'percentile(duration, 50)';
    }

    // -- getField(result, 'key')
    if (nameLow === 'getfield') {
      if (node.args.length >= 2) {
        const objStr = this.emitExpr(at(node.args, 0));
        const keyArg = at(node.args, 1);
        if (
          keyArg.type === 'literal' &&
          typeof keyArg.value === 'string'
        ) {
          return `${objStr}[\`${keyArg.value}\`]`;
        }
        const keyStr = this.emitExpr(keyArg);
        return `${objStr}[${keyStr}]`;
      }
      if (node.args.length > 0) {
        return this.emitExpr(at(node.args, 0));
      }
      return '/* getField() */';
    }

    // -- cardinality()
    if (nameLow === 'cardinality') {
      this.warnings.push(
        'cardinality() has no direct DQL equivalent; use countDistinct() on dimensions',
      );
      if (node.args.length > 0) {
        const fieldStr = this.emitExpr(at(node.args, 0));
        return `countDistinct(${fieldStr})`;
      }
      return '/* cardinality() -> use DT metric browser */';
    }

    // -- predictLinear(attr, seconds)
    if (nameLow === 'predictlinear') {
      this.warnings.push(
        'predictLinear() -> use Dynatrace Davis AI predictions',
      );
      if (node.args.length > 0) {
        return this.emitExpr(at(node.args, 0));
      }
      return '/* predictLinear() -> Davis AI */';
    }

    // -- blob()
    if (nameLow === 'blob') {
      this.warnings.push(
        'blob() binary data handling not supported in DQL',
      );
      if (node.args.length > 0) {
        return this.emitExpr(at(node.args, 0));
      }
      return '/* blob() not supported */';
    }

    // -- mapKeys() / mapValues()
    if (nameLow === 'mapkeys' || nameLow === 'mapvalues') {
      this.warnings.push(`${node.name}() -> use record field access in DQL`);
      if (node.args.length > 0) {
        return this.emitExpr(at(node.args, 0));
      }
      return `/* ${node.name}() -> record access */`;
    }

    // -- keyset() / eventType()
    if (nameLow === 'keyset' || nameLow === 'eventtype') {
      this.warnings.push(`${node.name}() -> use DT Schema browser`);
      return `/* ${node.name}() -> use DT Schema browser */`;
    }

    // -- bytecountestimate()
    if (nameLow === 'bytecountestimate') {
      this.warnings.push(
        'bytecountestimate() -> use DT Data Explorer for ingest volume',
      );
      if (node.args.length > 0) {
        return `/* bytecountestimate(${this.emitExpr(at(node.args, 0))}) */`;
      }
      return '/* bytecountestimate() -> DT Data Explorer */';
    }

    // -- Generic function mapping
    return this.emitFunctionCall(node);
  }

  private emitFunctionCall(node: FunctionCall): string {
    const nameLow = node.name.toLowerCase();
    const dtFunc = FUNC_MAP[nameLow] ?? node.name;

    // DQL if() requires the third parameter to be named 'else:'
    if (nameLow === 'if' && node.args.length >= 3) {
      const arg0 = at(node.args, 0);
      const condStr = isCondition(arg0)
        ? this.emitCondition(arg0)
        : this.emitExpr(arg0);
      const trueStr = this.emitExpr(at(node.args, 1));
      const falseStr = this.emitExpr(at(node.args, 2));
      return `if(${condStr}, ${trueStr}, else:${falseStr})`;
    }

    // DQL indexOf() optional 3rd param must be named 'from:'
    if (nameLow === 'indexof' && node.args.length >= 3) {
      const exprStr = this.emitExpr(at(node.args, 0));
      const substrStr = this.emitExpr(at(node.args, 1));
      const fromStr = this.emitExpr(at(node.args, 2));
      return `indexOf(${exprStr}, ${substrStr}, from:${fromStr})`;
    }

    // DQL round() optional 2nd param must be named 'scale:'
    if (nameLow === 'round' && node.args.length >= 2) {
      const valStr = this.emitExpr(at(node.args, 0));
      const scaleStr = this.emitExpr(at(node.args, 1));
      return `round(${valStr}, scale:${scaleStr})`;
    }

    // NR: capture(field, 'regex_pattern') -> DQL: parse(field, "DPL_PATTERN")
    if (nameLow === 'capture' && node.args.length >= 2) {
      const fieldStr = this.emitExpr(at(node.args, 0));
      const patternArg = at(node.args, 1);
      if (
        patternArg.type === 'literal' &&
        typeof patternArg.value === 'string'
      ) {
        const regexStr = patternArg.value.replace(/^['"]|['"]$/g, '');
        // NOTE: In the Python version, a RegexToDPLConverter is imported here.
        // For now, fall back to extract() with the original regex pattern.
        this.warnings.push(
          'capture() regex could not be converted to DPL; using extract() with original pattern',
        );
        return `extract(${fieldStr}, "${regexStr}")`;
      }
    }

    const argsStr = node.args.map((a) => this.emitExpr(a)).join(', ');
    return `${dtFunc}(${argsStr})`;
  }

  // -----------------------------------------------------------------------
  // Conditions
  // -----------------------------------------------------------------------

  private emitCondition(cond: Condition): string {
    if (cond.type === 'logical') {
      const left = this.emitCondition(cond.left);
      const right = this.emitCondition(cond.right);
      const op = cond.op; // already lowercase 'and' | 'or'
      return `${left} ${op} ${right}`;
    }

    if (cond.type === 'not') {
      const inner = this.emitCondition(cond.inner);
      return `not(${inner})`;
    }

    if (cond.type === 'comparison') {
      // INTERCEPT: aparse(field, 'pattern') = 'value'
      if (
        cond.left.type === 'function' &&
        cond.left.name.toLowerCase() === 'aparse'
      ) {
        if (
          cond.left.args.length >= 2 &&
          cond.right.type === 'literal'
        ) {
          const fieldExpr = this.emitExpr(at(cond.left.args, 0));
          const patternNode = at(cond.left.args, 1);
          const value = String(cond.right.value);
          const op = cond.op === '=' ? '==' : cond.op;

          if (patternNode.type === 'literal') {
            const pattern = String(patternNode.value);
            const wildcards =
              (pattern.match(/%/g) ?? []).length +
              (pattern.match(/\*/g) ?? []).length;
            if (wildcards === 1) {
              const fullStr = pattern
                .replace('%', value)
                .replace('*', value);
              if (op === '==' || op === '!=') {
                return `${fieldExpr} ${op} "${fullStr}"`;
              } else {
                const prefix = (pattern.split('%')[0] ?? '').split('*')[0] ?? '';
                if (prefix && op === '==') {
                  return `startsWith(${fieldExpr}, "${prefix}") and endsWith(${fieldExpr}, "${value}")`;
                }
              }
            }
          }

          this.warnings.push(
            'aparse() converted to contains() -- verify match logic',
          );
          return `contains(${fieldExpr}, "${value}")`;
        }
      }

      let left = this.emitExpr(cond.left);
      const right = this.emitExpr(cond.right);
      const op = cond.op === '=' ? '==' : cond.op;
      // Smart remap for http.request.path with full URL
      if (left === 'http.request.path' && cond.right.type === 'literal') {
        const val = String(cond.right.value);
        if (val.startsWith('http://') || val.startsWith('https://')) {
          left = 'http.url';
        }
      }
      return `${left} ${op} ${right}`;
    }

    if (cond.type === 'isNull') {
      const expr = this.emitExpr(cond.expr);
      return cond.negated ? `isNotNull(${expr})` : `isNull(${expr})`;
    }

    if (cond.type === 'inList') {
      const expr = this.emitExpr(cond.expr);
      const vals = cond.values.map((v) => this.emitExpr(v)).join(', ');
      const neg = cond.negated ? 'not ' : '';
      return `${neg}in(${expr}, {${vals}})`;
    }

    if (cond.type === 'like') {
      return this.emitLike(cond);
    }

    if (cond.type === 'rlike') {
      const expr = this.emitExpr(cond.expr);
      const neg = cond.negated ? 'not ' : '';
      let dplPattern = cond.pattern;
      dplPattern = dplPattern.replace(/\.\*/g, '*').replace(/\.\+/g, '?*');
      dplPattern = dplPattern.replace(/\./g, '?');
      dplPattern = dplPattern.replace(/^\^/, '').replace(/\$$/, '');
      return `${neg}matches(${expr}, "${dplPattern}")`;
    }

    if (cond.type === 'inSubquery') {
      this.warnings.push(
        'InSubqueryCond should have been extracted to lookup',
      );
      return 'true';
    }

    return 'true';
  }

  private emitLike(cond: LikeCond): string {
    let expr = this.emitExpr(cond.expr);
    const p = cond.pattern;
    const negWrap = (s: string): string =>
      cond.negated ? `not(${s})` : s;

    // Smart remap for http.request.path with full URL pattern
    if (
      expr === 'http.request.path' &&
      (p.startsWith('http://') || p.startsWith('https://'))
    ) {
      expr = 'http.url';
    }

    // %pattern% -> contains
    if (p.startsWith('%') && p.endsWith('%') && p.length > 2) {
      const inner = p.slice(1, -1);
      return negWrap(`contains(${expr}, "${inner}")`);
    }
    // pattern% -> startsWith
    if (p.endsWith('%') && !p.startsWith('%')) {
      const inner = p.slice(0, -1);
      return negWrap(`startsWith(toString(${expr}), "${inner}")`);
    }
    // %pattern -> endsWith
    if (p.startsWith('%') && !p.endsWith('%')) {
      const inner = p.slice(1);
      return negWrap(`endsWith(toString(${expr}), "${inner}")`);
    }
    // No wildcard -> exact match
    if (!p.includes('%')) {
      const op = cond.negated ? '!=' : '==';
      return `${expr} ${op} "${p}"`;
    }
    // Complex pattern with % in middle -> matchesPhrase
    const regex = p.replace(/%/g, '.*').replace(/_/g, '.');
    return negWrap(`matchesPhrase(${expr}, "${regex}")`);
  }

  // -----------------------------------------------------------------------
  // Expressions
  // -----------------------------------------------------------------------

  private emitExpr(node: ASTNode): string {
    if (node.type === 'star') return '*';
    if (node.type === 'literal') return this.emitLiteral(node);
    if (node.type === 'field') return this.mapField(node.name);
    if (node.type === 'function') return this.emitFunction(node);
    if (node.type === 'binary') {
      const left = this.emitExpr(node.left);
      const right = this.emitExpr(node.right);
      // Simplify duration.ms/1000 -> duration
      if (left === 'duration' && node.op === '/' && (right === '1000' || right === '1000.0')) {
        return 'duration';
      }
      if (left === 'duration' && node.op === '*' && (right === '1000' || right === '1000.0')) {
        return 'duration';
      }
      return `${left} ${node.op} ${right}`;
    }
    if (node.type === 'unaryMinus') {
      return `-${this.emitExpr(node.expr)}`;
    }
    if (node.type === 'timeInterval') {
      return `${node.value}`;
    }
    // Condition nodes
    if (isCondition(node)) {
      return this.emitCondition(node);
    }
    return String(node);
  }

  private emitLiteral(node: LiteralExpr): string {
    if (typeof node.value === 'string') return `"${node.value}"`;
    if (typeof node.value === 'boolean') {
      return node.value ? 'true' : 'false';
    }
    if (node.value === null) return 'null';
    return String(node.value);
  }

  private validateNoNestedAggregations(dql: string): string {
    const aggFuncs = [
      'countIf', 'count', 'sum', 'avg', 'min', 'max',
      'percentile', 'median', 'countDistinctExact', 'countDistinctApprox',
      'collectArray', 'collectDistinct', 'stddev', 'takeAny', 'takeFirst', 'takeLast',
    ];

    for (const func of aggFuncs) {
      const pattern = func + '(';
      let idx = 0;
      while (true) {
        idx = dql.indexOf(pattern, idx);
        if (idx === -1) break;
        // Find matching close paren
        let depth = 1;
        let pos = idx + pattern.length;
        while (pos < dql.length && depth > 0) {
          if (dql[pos] === '(') depth++;
          else if (dql[pos] === ')') depth--;
          pos++;
        }
        const argStr = dql.slice(idx + pattern.length, pos - 1);
        for (const innerFunc of aggFuncs) {
          if (argStr.includes(innerFunc + '(')) {
            this.warnings.push(
              `NESTED AGGREGATION DETECTED: ${func}() contains ${innerFunc}() ` +
                'which DQL will reject with NO_NESTED_AGGREGATIONS. ' +
                'Decompose into: summarize step | fieldsAdd calculation',
            );
            break;
          }
        }
        idx = pos;
      }
    }
    return dql;
  }

  private mapField(name: string): string {
    const low = name.toLowerCase();

    // In metric context, don't remap ambiguous dimension names
    if (
      this.queryClass === 'METRIC' ||
      this.queryClass.startsWith('K8S_')
    ) {
      if (DQLEmitter.METRIC_DIMENSION_PASSTHROUGH.has(low)) {
        return name;
      }
    }

    // Check exact match first
    const exact = this.fieldMap[name];
    if (exact) return exact;
    // Case-insensitive
    const lowMatch = this.fieldMap[low];
    if (lowMatch) return lowMatch;
    // Pass through unmapped fields
    return name;
  }

  // -----------------------------------------------------------------------
  // FACET items
  // -----------------------------------------------------------------------

  private emitFacetItems(items: FacetItem[]): string {
    const parts: string[] = [];
    for (const item of items) {
      const exprStr = this.emitExpr(item.expression);
      if (item.alias) {
        parts.push(`${this.sanitizeAlias(item.alias)}=${exprStr}`);
      } else {
        parts.push(exprStr);
      }
    }
    return parts.join(', ');
  }

  // -----------------------------------------------------------------------
  // Subquery extraction
  // -----------------------------------------------------------------------

  private extractSubqueries(
    cond: Condition,
  ): [Condition | undefined, InSubqueryCond[]] {
    const subqueries: InSubqueryCond[] = [];

    const walk = (c: Condition): Condition | undefined => {
      if (c.type === 'inSubquery') {
        subqueries.push(c);
        return undefined;
      }
      if (c.type === 'logical') {
        const left = walk(c.left);
        const right = walk(c.right);
        if (left === undefined && right === undefined) return undefined;
        if (left === undefined) return right;
        if (right === undefined) return left;
        return { type: 'logical', op: c.op, left, right };
      }
      if (c.type === 'not') {
        const inner = walk(c.inner);
        if (inner === undefined) return undefined;
        return { type: 'not', inner };
      }
      return c;
    };

    const remaining = walk(cond);
    return [remaining, subqueries];
  }

  private emitLookup(sq: InSubqueryCond, parts: string[]): void {
    const field = this.emitExpr(sq.expr);
    const sub = sq.subquery;
    const subFrom = sub.fromClause
      .toLowerCase()
      .replace(/_/g, '')
      .replace(/-/g, '');
    const fetchMap: Record<string, string> = {
      transaction: 'spans',
      span: 'spans',
      log: 'logs',
      transactionerror: 'spans',
      pageview: 'bizevents',
    };
    const fetchType = fetchMap[subFrom] ?? 'spans';
    const selField = this.emitExpr(at(sub.selectItems, 0).expression);

    let subFilter = '';
    if (sub.where) {
      subFilter = ` | filter ${this.emitCondition(sub.where)}`;
    }

    parts.push(
      `| lookup [fetch ${fetchType}${subFilter} | fields ${selField}], ` +
        `sourceField:${field}, lookupField:${selField}, prefix:"sub."`,
    );

    const nullCheck = sq.negated ? 'isNull' : 'isNotNull';
    parts.push(`| filter ${nullCheck}(sub.${selField})`);
  }
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

/**
 * Check if an ASTNode is a Condition (discriminated union check).
 */
function isCondition(node: ASTNode): node is Condition {
  return (
    node.type === 'comparison' ||
    node.type === 'logical' ||
    node.type === 'not' ||
    node.type === 'isNull' ||
    node.type === 'inList' ||
    node.type === 'inSubquery' ||
    node.type === 'like' ||
    node.type === 'rlike'
  );
}
