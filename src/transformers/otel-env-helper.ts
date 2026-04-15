/**
 * `getOtelEnvForDt` — data helper that returns the set of OTEL_* env
 * variables an application needs to push OTLP telemetry to a specific
 * Dynatrace tenant.
 *
 * Back-ported from the repeated recipe in Python
 * `Dynatrace-NewRelic/agents/*.install_otel_fallback()`. The agent
 * module in that repo does host operations (sed / systemctl /
 * shell-out); only the pure-data recipe — which env vars get which
 * values — is library-appropriate. This is that recipe.
 */

export type OtelTransportProtocol = 'grpc' | 'http/protobuf';

export interface OtelEnvOptions {
  readonly dtTenant: string; // e.g. "abc12345"
  readonly dtRegion?: string; // e.g. "live" (default) | "sprint" | "apps"
  readonly ingestToken: string; // DT ingest token (NOT api token)
  readonly serviceName: string;
  readonly serviceInstanceId?: string;
  readonly deploymentEnvironment?: string;
  readonly protocol?: OtelTransportProtocol;
  /** Additional static resource attributes to merge in. */
  readonly resourceAttributes?: Record<string, string>;
  /** Override OTLP signals. Default: traces + metrics + logs. */
  readonly signals?: ReadonlyArray<'traces' | 'metrics' | 'logs'>;
}

/**
 * Returns a map of OTEL_* environment variable name → string value.
 * The map is safe to pipe directly into a Docker / k8s env block or
 * a systemd override file.
 */
export function getOtelEnvForDt(options: OtelEnvOptions): Record<string, string> {
  const region = options.dtRegion ?? 'live';
  const protocol = options.protocol ?? 'grpc';

  const baseEndpoint =
    protocol === 'grpc'
      ? `https://${options.dtTenant}.${region}.dynatrace.com/api/v2/otlp`
      : `https://${options.dtTenant}.${region}.dynatrace.com/api/v2/otlp`;

  // Resource attributes string in the W3C convention (key=value,key2=value2).
  const resourceKV: Record<string, string> = {
    'service.name': options.serviceName,
    ...(options.serviceInstanceId
      ? { 'service.instance.id': options.serviceInstanceId }
      : {}),
    ...(options.deploymentEnvironment
      ? { 'deployment.environment': options.deploymentEnvironment }
      : {}),
    ...(options.resourceAttributes ?? {}),
  };
  const resourceAttrs = Object.entries(resourceKV)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

  const env: Record<string, string> = {
    OTEL_EXPORTER_OTLP_ENDPOINT: baseEndpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Api-Token ${options.ingestToken}`,
    OTEL_SERVICE_NAME: options.serviceName,
    OTEL_RESOURCE_ATTRIBUTES: resourceAttrs,
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
  };

  const signals = options.signals ?? ['traces', 'metrics', 'logs'];
  if (!signals.includes('traces')) env['OTEL_TRACES_EXPORTER'] = 'none';
  if (!signals.includes('metrics')) env['OTEL_METRICS_EXPORTER'] = 'none';
  if (!signals.includes('logs')) env['OTEL_LOGS_EXPORTER'] = 'none';

  return env;
}

/**
 * Convenience: format the env map as a `KEY=VALUE\n…` string suitable
 * for inline paste into a `.env` file or `docker run --env-file`.
 */
export function formatOtelEnvAsDotenv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => {
      const needsQuote = /\s|[#,="]/.test(v);
      return needsQuote ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`;
    })
    .join('\n');
}
