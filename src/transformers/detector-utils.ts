/**
 * Shared helpers + types for Davis anomaly-detector emission
 * (`builtin:davis.anomaly-detectors`, schema v1.0.14).
 *
 * Canonical value shape (verified against a Gen3 tenant 2026-04-20):
 *
 *   { enabled, title, description, source (text),
 *     executionSettings: { actor, queryOffset },
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
  /** Migration-side id used to bind workflows (`davis_event.detectorIds`). */
  readonly detectorId: string;
  readonly value: {
    readonly enabled: boolean;
    readonly title: string;
    readonly description: string;
    readonly source: string;
    readonly executionSettings: {
      readonly actor: string | null;
      readonly queryOffset: string | null;
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

/** Valid-DQL placeholder used when no confident translation exists. */
export const PLACEHOLDER_DQL = 'timeseries count()';

let sharedCompiler: NRQLCompiler | undefined;

function getCompiler(): NRQLCompiler {
  sharedCompiler ??= new NRQLCompiler();
  return sharedCompiler;
}

function fallback(nrql: string): string {
  const oneLine = nrql.split(/\s+/).filter(Boolean).join(' ');
  return `// UNCONVERTED NRQL: ${oneLine}\n${PLACEHOLDER_DQL}`;
}

/**
 * Translate NRQL to DQL for an `analyzer.input` `query` entry.
 *
 * - Empty / whitespace NRQL -> `timeseries count()`.
 * - HIGH/MEDIUM compile -> compiled DQL.
 * - LOW or failed compile -> `// UNCONVERTED NRQL: <orig>\ntimeseries count()`
 *   and a warning is appended (if `warnings` is given).
 */
export function nrqlToAnalyzerQuery(
  nrql: string,
  warnings?: string[],
  compiler?: NRQLCompiler,
): string {
  if (!nrql || !nrql.trim()) return PLACEHOLDER_DQL;

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
    return result.dql;
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
    { key: 'dealertingSamples', value: '5' },
  ];
}
