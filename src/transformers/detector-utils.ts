/**
 * Shared helpers + types for Davis anomaly-detector emission
 * (`builtin:davis.anomaly-detectors`, schema v1.0.14).
 *
 * Canonical value shape (verified against a Gen3 tenant 2026-04-20):
 *
 *   { enabled, title, description, source (text),
 *     executionSettings: {},                          // actor injected at import (D16)
 *     analyzer: { name, input: [{ key, value }] },   // all strings, minLength 1
 *     eventTemplate: { properties: [{ key, value }] } }  // ONLY properties
 *
 * Forbidden: `name`, `strategy`, `eventTemplate.title|description|eventType|davisMerge`.
 *
 * `analyzer.input[query].value` is server-validated as DQL — raw NRQL is
 * rejected with `Invalid DQL query. 'FROM' isn't allowed here.`
 * `nrqlToAnalyzerQuery` routes NRQL through the compiler and falls back to
 * a commented placeholder when conversion is LOW-confidence or fails.
 *
 * Anomaly-detector analyzers only accept timeseries results. Verified live
 * (live-validation 2026-09, D1): `fetch … | summarize …` fails with
 * "No valid time series records found"; `fetch … | makeTimeseries …` works.
 * The old placeholder `timeseries count()` is also invalid (D11: count() needs
 * a metric key). Settings envelopes carry no `detectorId` (D3: not a schema field).
 *
 * Also rejected by the live Settings validator (D16–D21): null/missing
 * `executionSettings.actor` (transformers emit `{}`; `withDetectorActor` fills
 * it at import/export), `dealertingSamples > slidingWindow`, non-Davis
 * `event.type` values, and the non-existent analyzer inputs
 * `minLocationsFailing` / `learningPeriodDays` / `dimensions` (splits go in
 * the query via `addSplitDimension`).
 *
 * Mirrors Python `transformers/_detector_utils.py` in
 * NewRelic-to-Dynatrace-Migration-Utilities.
 */

import { NRQLCompiler } from '../compiler/compiler.js';

export const DAVIS_ANOMALY_DETECTOR_SCHEMA_ID = 'builtin:davis.anomaly-detectors' as const;

/** Canonical Davis analyzer ids. */
export const DAVIS_ANALYZERS = {
  STATIC_THRESHOLD: 'dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer',
  AUTO_ADAPTIVE: 'dt.statistics.ui.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer',
  SEASONAL_BASELINE:
    'dt.statistics.ui.anomaly_detection.SeasonalBaselineAnomalyDetectionAnalyzer',
} as const;

export type DavisAnalyzerName = (typeof DAVIS_ANALYZERS)[keyof typeof DAVIS_ANALYZERS];

export interface DTKeyValue {
  readonly key: string;
  readonly value: string;
}

/** Settings 2.0 envelope for a `builtin:davis.anomaly-detectors` object. */
export interface DTAnomalyDetector {
  readonly schemaId: typeof DAVIS_ANOMALY_DETECTOR_SCHEMA_ID;
  readonly scope: 'environment';
  readonly value: {
    readonly enabled: boolean;
    readonly title: string;
    readonly description: string;
    readonly source: string;
    /** `{}` from transformers; `actor` (service-user UUID) is injected at import (D16). */
    readonly executionSettings: {
      readonly actor?: string;
      readonly queryOffset?: string;
    };
    readonly analyzer: {
      readonly name: DavisAnalyzerName;
      readonly input: DTKeyValue[];
    };
    readonly eventTemplate: {
      readonly properties: DTKeyValue[];
    };
  };
}

export const DETECTOR_SOURCE = 'newrelic-migration';

/**
 * Valid timeseries that matches no data, so an unconverted detector can never
 * fire (verified live: analyzer reports "no input data", no alert).
 */
export const FALLBACK_QUERY =
  'timeseries unconverted = count(dt.host.cpu.usage), ' +
  'filter:{host.name == "__nr_migration_unconverted__"}';

/** @deprecated Use `FALLBACK_QUERY` (the old `timeseries count()` was invalid DQL). */
export const PLACEHOLDER_DQL = FALLBACK_QUERY;

let sharedCompiler: NRQLCompiler | undefined;

function getCompiler(): NRQLCompiler {
  sharedCompiler ??= new NRQLCompiler();
  return sharedCompiler;
}

function fallback(nrql: string): string {
  const oneLine = nrql.split(/\s+/).filter(Boolean).join(' ');
  return `// UNCONVERTED NRQL: ${oneLine}\n${FALLBACK_QUERY}`;
}

/**
 * Translate NRQL to DQL for an `analyzer.input` `query` entry.
 *
 * - Empty / whitespace NRQL -> `FALLBACK_QUERY` (valid, inert timeseries).
 * - HIGH/MEDIUM compile -> compiled DQL normalised by `ensureTimeseries`
 *   (`summarize` -> `makeTimeseries`).
 * - LOW or failed compile, or DQL that cannot be made a timeseries ->
 *   `// UNCONVERTED NRQL: <orig>\n<FALLBACK_QUERY>` and a warning is appended
 *   (if `warnings` is given).
 */
export function nrqlToAnalyzerQuery(
  nrql: string,
  warnings?: string[],
  compiler?: NRQLCompiler,
): string {
  if (!nrql || !nrql.trim()) return FALLBACK_QUERY;

  let result;
  try {
    result = (compiler ?? getCompiler()).compile(nrql);
  } catch (err) {
    warnings?.push(
      `NRQL→DQL conversion raised (${String(err)}); detector emitted with placeholder query + original NRQL preserved as comment.`,
    );
    return fallback(nrql);
  }

  const confidence = (result.confidence ?? '').toUpperCase();
  if (result.success && result.dql && (confidence === 'HIGH' || confidence === 'MEDIUM')) {
    const timeseriesDql = ensureTimeseries(result.dql);
    if (timeseriesDql !== null) return timeseriesDql;
    warnings?.push(
      'Converted DQL is not a timeseries (anomaly detectors require ' +
        'timeseries/makeTimeseries); detector emitted with an inert ' +
        'placeholder query + original NRQL preserved as comment.',
    );
    return fallback(nrql);
  }

  warnings?.push(
    `NRQL→DQL conversion was ${result.success ? confidence || 'UNKNOWN' : 'FAILED'}; detector emitted with placeholder query + original NRQL preserved as comment for operator review.`,
  );
  return fallback(nrql);
}

/**
 * Stringify a threshold the way Python's `str(float(x))` does
 * (`500` -> `"500.0"`) so analyzer input is byte-identical across ports.
 */
export function formatThreshold(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** Build a static-threshold analyzer input list (all values strings). */
export function staticThresholdInput(opts: {
  query: string;
  threshold: number;
  alertCondition: string;
  violatingSamples: number;
  slidingWindow: number;
}): DTKeyValue[] {
  return [
    { key: 'query', value: opts.query },
    { key: 'threshold', value: formatThreshold(opts.threshold) },
    { key: 'alertCondition', value: opts.alertCondition },
    { key: 'alertOnMissingData', value: 'false' },
    { key: 'violatingSamples', value: String(opts.violatingSamples) },
    { key: 'slidingWindow', value: String(opts.slidingWindow) },
    { key: 'dealertingSamples', value: dealertingSamples(opts.slidingWindow) },
  ];
}

// ---------------------------------------------------------------------------
// Timeseries normalisation (D1)
// ---------------------------------------------------------------------------

const AGG_FUNC_SOURCE =
  '\\b(count|countIf|countDistinct|countDistinctExact|countDistinctApprox|sum|avg|min|max|' +
  'percentile|median|stddev|variance)\\s*\\(';
const AGG_FUNC_RE = new RegExp(`^${AGG_FUNC_SOURCE}`);
/** Stages after `summarize` that can be dropped without changing the aggregate. */
const TRAILING_OK: ReadonlySet<string> = new Set(['sort', 'limit']);

function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Index just past the balanced `(...)` that opens at/after `start`. */
function callSpan(text: string, start: number): number {
  const open = text.indexOf('(', start);
  if (open < 0) throw new Error('no opening parenthesis');
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unbalanced parentheses');
}

function isSingleCall(expr: string): boolean {
  return AGG_FUNC_RE.test(expr) && callSpan(expr, 0) === expr.length;
}

/** `summarize` body -> [makeTimeseries body, post fieldsAdd items, temp names]. */
function rewriteSummarize(body: string): [string, string[], string[]] | null {
  const items = splitTopLevel(body);
  const by = items.filter((i) => /^by\s*:/.test(i));
  const aggs = items.filter((i) => !/^by\s*:/.test(i));
  if (aggs.length === 0) return null;
  const named: string[] = [];
  const post: string[] = [];
  const temps: string[] = [];
  for (let idx = 0; idx < aggs.length; idx++) {
    const item = aggs[idx]!;
    const m = /^([A-Za-z_][\w.]*|`[^`]+`)\s*=\s*([\s\S]+)$/.exec(item);
    const alias = m ? m[1]! : null;
    const expr = m ? m[2]!.trim() : item;
    if (isSingleCall(expr)) {
      named.push(alias ? `${alias} = ${expr}` : expr);
      continue;
    }
    // Arithmetic over aggregations (e.g. percentage): compute each call as a
    // series, then combine element-wise.
    const out: string[] = [];
    let pos = 0;
    let found = false;
    for (const call of expr.matchAll(new RegExp(AGG_FUNC_SOURCE, 'g'))) {
      const start = call.index ?? 0;
      if (start < pos) continue;
      const end = callSpan(expr, start);
      const name = `nr_agg${temps.length}`;
      temps.push(name);
      named.push(`${name} = ${expr.slice(start, end)}`);
      out.push(`${expr.slice(pos, start)}${name}[]`);
      pos = end;
      found = true;
    }
    if (!found) return null;
    out.push(expr.slice(pos));
    post.push(`${alias ?? `value${idx}`} = ${out.join('')}`);
  }
  const aggPart = named.length === 1 ? named[0]! : `{ ${named.join(', ')} }`;
  return [[aggPart, ...by].join(', '), post, temps];
}

/**
 * Return `dql` as a timeseries query for an analyzer, or `null` if unsafe.
 *
 * - `timeseries …` passes through unchanged.
 * - `fetch … | summarize …` becomes `fetch … | makeTimeseries …`; arithmetic
 *   over aggregations is split into `nr_aggN` series combined with
 *   `fieldsAdd valueN = …[]` + `fieldsRemove`. Only trailing `sort` / `limit`
 *   stages are dropped.
 * - Anything else (smartscapeNodes, post-aggregation fieldsAdd, several
 *   summarize stages, no aggregation) returns `null`.
 *
 * Mirrors Python `_detector_utils.ensure_timeseries`.
 */
export function ensureTimeseries(dql: string): string | null {
  const lines = dql.split('\n');
  const comments = lines.filter((ln) => ln.trimStart().startsWith('//'));
  const code = lines.filter((ln) => ln.trim() && !ln.trimStart().startsWith('//'));
  if (code.length === 0) return null;
  const stages = code.map((ln) => ln.trim().replace(/^\|+/, '').trim());
  const cmd = (stage: string): string => (stage ? (stage.split(/\s+/)[0] ?? '') : '');
  const head = stages[0]!;
  const rest = stages.slice(1);

  if (cmd(head) === 'timeseries' && !rest.some((s) => cmd(s) === 'summarize')) return dql;
  if (cmd(head) !== 'fetch') return null;
  if (
    stages.some((s) => cmd(s) === 'makeTimeseries') &&
    !stages.some((s) => cmd(s) === 'summarize')
  ) {
    return dql;
  }
  const idx = stages.flatMap((s, i) => (cmd(s) === 'summarize' ? [i] : []));
  if (idx.length !== 1) return null;
  const i = idx[0]!;
  if (stages.slice(i + 1).some((s) => !TRAILING_OK.has(cmd(s)))) return null;
  let rewritten: [string, string[], string[]] | null;
  try {
    rewritten = rewriteSummarize(stages[i]!.slice('summarize'.length).trim());
  } catch {
    return null;
  }
  if (rewritten === null) return null;
  const [body, post, temps] = rewritten;
  const out = [...stages.slice(0, i), `makeTimeseries ${body}`];
  if (post.length > 0) {
    out.push(`fieldsAdd ${post.join(', ')}`);
    out.push(`fieldsRemove ${temps.join(', ')}`);
  }
  const query = out[0]! + out.slice(1).map((s) => `\n| ${s}`).join('');
  return [...comments, query].join('\n');
}

// ---------------------------------------------------------------------------
// Metric-key and condition helpers for non-NRQL / infrastructure detectors
// ---------------------------------------------------------------------------

/**
 * Classic metric-selector keys are not valid in DQL (D2: "There isn't a
 * parameter builtin."). Grail equivalents below were confirmed to exist on a
 * live tenant. Identical to Python `_detector_utils.GRAIL_METRIC_KEYS`.
 */
export const GRAIL_METRIC_KEYS: Readonly<Record<string, string>> = {
  'builtin:host.cpu.usage': 'dt.host.cpu.usage',
  'builtin:host.mem.usage': 'dt.host.memory.usage',
  'builtin:host.disk.usedPct': 'dt.host.disk.used.percent',
  'builtin:host.cpu.load': 'dt.host.cpu.load',
  'builtin:host.net.bytesRx': 'dt.host.net.nic.bytes_rx',
  'builtin:host.net.bytesTx': 'dt.host.net.nic.bytes_tx',
  'builtin:host.availability': 'dt.host.availability',
  'builtin:tech.generic.process.count': 'dt.process.count',
  'builtin:synthetic.http.availability.location.total': 'dt.synthetic.http.availability',
  'builtin:service.response.time': 'dt.service.request.response_time',
  'builtin:apps.web.actionCount.osAndGeo': 'dt.frontend.request.count',
};

const TIMESERIES_AGGS: ReadonlySet<string> = new Set(['avg', 'sum', 'min', 'max', 'count']);

/** `timeseries <agg>(<grail key>)` for a metric key, or the inert fallback (+ warning). */
export function metricTimeseriesQuery(
  metricKey: string,
  warnings?: string[],
  agg = 'avg',
): string {
  const grailKey = GRAIL_METRIC_KEYS[metricKey] ?? metricKey;
  if (grailKey.startsWith('builtin:') || !grailKey.startsWith('dt.')) {
    warnings?.push(
      `Metric '${metricKey}' has no verified Grail metric key; detector ` +
        'emitted with an inert placeholder query for operator review.',
    );
    return `// UNMAPPED METRIC: ${metricKey}\n${FALLBACK_QUERY}`;
  }
  const fn = TIMESERIES_AGGS.has(agg) ? agg : 'avg';
  return `timeseries ${fn}(${grailKey})`;
}

/** NR term operator -> StaticThreshold analyzer alertCondition. */
const OPERATOR_TO_CONDITION: Readonly<Record<string, string>> = {
  ABOVE: 'ABOVE',
  ABOVE_OR_EQUALS: 'ABOVE',
  BELOW: 'BELOW',
  BELOW_OR_EQUALS: 'BELOW',
};

/** Map an NR term operator; unsupported operators keep `defaultCondition` with a warning. */
export function alertConditionFor(
  operator: string | null | undefined,
  defaultCondition: string,
  warnings?: string[],
): string {
  if (!operator) return defaultCondition;
  const op = String(operator).toUpperCase();
  const mapped = OPERATOR_TO_CONDITION[op];
  if (mapped) {
    if (op.endsWith('_OR_EQUALS')) {
      warnings?.push(
        `NR operator ${op} mapped to ${mapped} ` +
          '(the analyzer has no inclusive comparison); adjust the threshold if needed.',
      );
    }
    return mapped;
  }
  warnings?.push(
    `NR operator '${operator}' is not supported by the static threshold analyzer; ` +
      `using ${defaultCondition}.`,
  );
  return defaultCondition;
}

/**
 * `[violatingSamples, slidingWindow]` for an NR threshold duration + occurrence mode.
 * `ALL` (default): every 1-minute sample in the window must violate.
 * `AT_LEAST_ONCE`: a single violating sample in the window is enough.
 */
export function sampleSettings(
  durationSeconds: number,
  occurrences?: string | null,
): [number, number] {
  const window = Math.max(1, Math.floor(Number(durationSeconds) / 60));
  if (String(occurrences ?? '').toUpperCase() === 'AT_LEAST_ONCE') return [1, window];
  return [window, window];
}

// ---------------------------------------------------------------------------
// Settings-validator constraints (D16–D21)
// ---------------------------------------------------------------------------

/**
 * Add `by: {dimension}` to the timeseries stage of an analyzer query.
 * D21: analyzers have no `dimensions` input; splitting belongs in the query.
 * Queries that already split (`by:`) or are the inert fallback are unchanged.
 */
export function addSplitDimension(dql: string, dimension: string | undefined): string {
  if (!dimension || dql.includes('__nr_migration_unconverted__')) return dql;
  const lines = dql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const stage = lines[i]!.trim().replace(/^\|+/, '').trim();
    if (stage.startsWith('timeseries ') || stage.startsWith('makeTimeseries ')) {
      if (!stage.includes('by:')) lines[i] = `${lines[i]!.trimEnd()}, by: {${dimension}}`;
      break;
    }
  }
  return lines.join('\n');
}

/** D17: the analyzer requires dealertingSamples <= slidingWindow. */
export function dealertingSamples(slidingWindow: number): string {
  return String(Math.max(1, Math.min(5, Math.trunc(Number(slidingWindow)))));
}

/** Placeholder actor used by IaC exporters before substituting a variable reference. */
export const DETECTOR_ACTOR_PLACEHOLDER = '__DETECTOR_ACTOR__';

/**
 * Copy of a detector envelope with `executionSettings.actor` set (no-op for
 * other schemas). The Settings API rejects a null / missing actor or one that
 * is not a service user on the tenant (D16). Mirrors Python
 * `clients/_detector_actor.with_detector_actor`.
 */
export function withDetectorActor<
  T extends { readonly schemaId?: string; readonly value?: unknown },
>(envelope: T, actor: string): T {
  if (envelope.schemaId !== DAVIS_ANOMALY_DETECTOR_SCHEMA_ID) return envelope;
  const value = { ...((envelope.value as Record<string, unknown> | undefined) ?? {}) };
  const current = (value['executionSettings'] as Record<string, unknown> | undefined) ?? {};
  const settings: Record<string, unknown> = Object.fromEntries(
    Object.entries(current).filter(([, v]) => v !== null && v !== undefined),
  );
  settings['actor'] = actor;
  value['executionSettings'] = settings;
  return { ...envelope, value };
}
