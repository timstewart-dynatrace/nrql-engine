/**
 * OpenTelemetry Collector Transformer — Converts a New Relic OTel
 * collector configuration (`exporters.otlp` pointed at NR's OTLP
 * endpoint) to the equivalent Dynatrace OTLP ingest configuration.
 *
 * Gen3 output:
 *   - DT OTLP exporter block (endpoint, headers with Api-Token auth)
 *   - Optional `builtin:otel.ingest-mappings` settings override for
 *     tenant-side resource attribute filtering
 *
 * NR access keys → DT API tokens must be re-provisioned — flagged as
 * a manual step.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NROtelSignal = 'traces' | 'metrics' | 'logs';

export interface NROtelCollectorInput {
  readonly name?: string;
  /** NR OTLP endpoint, e.g. https://otlp.nr-data.net:4317 */
  readonly endpoint?: string;
  readonly signals?: NROtelSignal[];
  readonly protocol?: 'grpc' | 'http';
  /** Resource attributes injected by the collector (service.name, deployment.environment, …). */
  readonly resourceAttributes?: Record<string, string>;
  /** NR license key — never transferable. */
  readonly apiKey?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTOtlpExporter {
  readonly name: string;
  readonly endpoint: string;
  readonly protocol: 'grpc' | 'http';
  readonly headers: Record<string, string>;
  readonly signals: NROtelSignal[];
  readonly resourceAttributes: Record<string, string>;
}

export interface DTOtelIngestMapping {
  readonly schemaId: 'builtin:otel.ingest-mappings';
  readonly displayName: string;
  readonly serviceNameSource: string;
}

export interface OtelCollectorTransformData {
  readonly exporter: DTOtlpExporter;
  readonly ingestMapping: DTOtelIngestMapping;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rewriteEndpoint(protocol: 'grpc' | 'http'): string {
  // Default DT OTLP endpoints. Replace `<env-id>` at upload time.
  if (protocol === 'grpc') return 'https://<env-id>.live.dynatrace.com/api/v2/otlp';
  return 'https://<env-id>.live.dynatrace.com/api/v2/otlp/v1';
}

const MANUAL_STEPS: string[] = [
  'Re-provision a DT API token with `openTelemetryTrace.ingest`, `metrics.ingest`, and `logs.ingest` scopes. NR license keys are not transferable.',
  'Replace `<env-id>` in the endpoint with your Dynatrace environment id (e.g. abc12345).',
  'If your collector was using attribute processors tailored to NR (`newrelic.licenseKey`, `newrelic.source`), remove them — DT does not consume them.',
  'Verify resource-attribute propagation: `service.name` + `deployment.environment` are the minimum DT expects for Smartscape mapping.',
];

// ---------------------------------------------------------------------------
// OpenTelemetryCollectorTransformer
// ---------------------------------------------------------------------------

export class OpenTelemetryCollectorTransformer {
  transform(input: NROtelCollectorInput): TransformResult<OtelCollectorTransformData> {
    try {
      const name = input.name ?? 'otlp-dynatrace';
      const protocol = input.protocol ?? 'grpc';
      const signals = input.signals ?? ['traces', 'metrics', 'logs'];
      const warnings: string[] = [];

      if (!input.endpoint) {
        warnings.push(
          'NR OTel endpoint not provided; emitted placeholder DT endpoint. Set `<env-id>` before deploying.',
        );
      }

      const exporter: DTOtlpExporter = {
        name,
        endpoint: rewriteEndpoint(protocol),
        protocol,
        headers: { Authorization: 'Api-Token <dt-ingest-token>' },
        signals,
        resourceAttributes: { ...(input.resourceAttributes ?? {}) },
      };

      const ingestMapping: DTOtelIngestMapping = {
        schemaId: 'builtin:otel.ingest-mappings',
        displayName: `[Migrated] ${name} mapping`,
        serviceNameSource: 'resourceAttributes.service.name',
      };

      return success(
        { exporter, ingestMapping, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NROtelCollectorInput[],
  ): TransformResult<OtelCollectorTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
