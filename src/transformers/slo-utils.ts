/**
 * Shared helpers for Gen3 Platform SLO emission (`POST /platform/slo/v1/slos`).
 *
 * Platform SLOs carry a DQL indicator (`customSli.indicator`) that must
 * produce an `sli` field (array of doubles, percent). Mirrors Python
 * `transformers/_slo_utils.py` in NewRelic-to-Dynatrace-Migration-Utilities —
 * indicator strings are identical and pinned by parity tests.
 *
 * Payload shape verified against the Dynatrace SLO SDK, the Terraform
 * `dynatrace_platform_slo` resource, and Monaco `slo-v2` fixtures.
 */

export const DEFAULT_LATENCY_THRESHOLD_MS = 1000;

export interface DTPlatformSloCriteria {
  readonly target: number;
  readonly warning: number;
  readonly timeframeFrom: string;
  readonly timeframeTo: string;
}

export interface DTPlatformSlo {
  readonly name: string;
  readonly description: string;
  readonly criteria: DTPlatformSloCriteria[];
  readonly customSli: { readonly indicator: string };
  readonly tags: string[];
  readonly externalId?: string;
}

/** Platform SLO warning sits between target and 100 (warning > target). */
export function defaultWarning(target: number): number {
  return Math.round(Math.min(target + (100 - target) / 2, 99.99) * 100) / 100;
}

/** Scope the per-service series by service name or by a DT SERVICE-… id. */
export interface ServiceScope {
  readonly serviceName?: string;
  readonly serviceId?: string;
}

function serviceScope(scope: ServiceScope): string {
  let step = '\n| fieldsAdd entityName = getNodeName(dt.smartscape.service)';
  if (scope.serviceName) {
    const escaped = scope.serviceName.replace(/"/g, '\\"');
    step += `\n| filter contains(entityName, "${escaped}")`;
  }
  if (scope.serviceId) {
    step += `\n| filter dt.smartscape.service == toSmartscapeId("${scope.serviceId}")`;
  }
  return step;
}

/** Service success-rate SLI (non-failed requests / all requests). */
export function availabilityIndicator(scope: ServiceScope = {}): string {
  return (
    'timeseries {\n' +
    '  total=sum(dt.service.request.count),\n' +
    '  failures=sum(dt.service.request.failure_count)\n' +
    `}, by: { dt.smartscape.service }${serviceScope(scope)}\n` +
    '| fieldsAdd sli=(((total[]-failures[])/total[])*(100))\n' +
    '| fieldsRemove total, failures'
  );
}

/**
 * Share of time buckets whose avg response time is within the threshold.
 * `dt.service.request.response_time` is in microseconds.
 */
export function latencyIndicator(
  thresholdMs: number = DEFAULT_LATENCY_THRESHOLD_MS,
  scope: ServiceScope = {},
): string {
  const thresholdUs = Math.trunc(thresholdMs) * 1000;
  return (
    'timeseries total=avg(dt.service.request.response_time), default:0, ' +
    `by: { dt.smartscape.service }${serviceScope(scope)}\n` +
    `| fieldsAdd high=iCollectArray(if(total[] > ${thresholdUs}, total[]))\n` +
    `| fieldsAdd low=iCollectArray(if(total[] <= ${thresholdUs}, total[]))\n` +
    '| fieldsAdd highRespTimes=iCollectArray(if(isNull(high[]), 0, else: 1))\n' +
    '| fieldsAdd lowRespTimes=iCollectArray(if(isNull(low[]), 0, else: 1))\n' +
    '| fieldsAdd sli=100*(lowRespTimes[]/(lowRespTimes[]+highRespTimes[]))\n' +
    '| fieldsRemove total, high, low, highRespTimes, lowRespTimes'
  );
}

export interface BuildPlatformSloOptions {
  readonly name: string;
  readonly description: string;
  readonly target: number;
  readonly indicator: string;
  readonly timeframeFrom?: string;
  readonly warning?: number;
  readonly tags?: string[];
  readonly externalId?: string;
}

/** Platform SLO API request body. */
export function buildPlatformSlo(opts: BuildPlatformSloOptions): DTPlatformSlo {
  return {
    name: opts.name,
    description: opts.description.slice(0, 1000),
    criteria: [
      {
        target: opts.target,
        warning: opts.warning ?? defaultWarning(opts.target),
        timeframeFrom: opts.timeframeFrom ?? 'now-7d',
        timeframeTo: 'now',
      },
    ],
    customSli: { indicator: opts.indicator },
    tags: [...(opts.tags ?? [])],
    ...(opts.externalId ? { externalId: opts.externalId } : {}),
  };
}

const SERVICE_NAME_RE =
  /\b(?:appName|entityName|entity\.name|service\.name)\s*=\s*'([^']+)'/i;
const DURATION_THRESHOLD_RE = /\bduration\s*<=?\s*([\d.]+)/i;

export function extractServiceName(where: string): string | undefined {
  return SERVICE_NAME_RE.exec(where)?.[1];
}

/** NR `duration` is in seconds. */
export function extractLatencyThresholdMs(where: string): number | undefined {
  const m = DURATION_THRESHOLD_RE.exec(where);
  return m?.[1] !== undefined ? Math.round(parseFloat(m[1]) * 1000) : undefined;
}
