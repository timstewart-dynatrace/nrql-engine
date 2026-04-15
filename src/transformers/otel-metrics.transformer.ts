/**
 * OpenTelemetry Metrics Direct Transformer — Converts NR direct OTLP
 * metrics exporter configuration (applications pushing OTLP straight
 * to NR, no intermediate collector) to Dynatrace OTLP metrics ingest.
 *
 * Distinct from `OpenTelemetryCollectorTransformer`:
 *   - collector transformer translates a collector-side yaml with
 *     processors/exporters
 *   - this transformer translates the SDK-level exporter config
 *     embedded in an application (e.g. the values passed to
 *     OtlpHttpMetricExporter / OtlpGrpcMetricExporter)
 *
 * Gen3 output:
 *   - DT OTLP metrics endpoint (grpc or http)
 *   - `builtin:otel.metrics.ingest` settings stub covering temporality
 *     (DELTA vs CUMULATIVE) and preferred histogram layout
 *   - SDK attribute mapping guidance (service.name / service.instance.id /
 *     deployment.environment → DT semconv)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NROtelMetricTemporality = 'DELTA' | 'CUMULATIVE';
export type NROtelHistogramLayout = 'EXPLICIT_BUCKET' | 'EXPONENTIAL';

export interface NROtelMetricsInput {
  readonly name?: string;
  readonly endpoint?: string;
  readonly protocol?: 'grpc' | 'http';
  readonly temporality?: NROtelMetricTemporality;
  readonly histogramLayout?: NROtelHistogramLayout;
  readonly exportIntervalSeconds?: number;
  readonly resourceAttributes?: Record<string, string>;
  /** Instrumentation scope names carried in the NR config. */
  readonly instrumentationScopes?: string[];
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTOtelMetricsExporter {
  readonly endpoint: string;
  readonly protocol: 'grpc' | 'http';
  readonly headers: Record<string, string>;
  readonly temporality: NROtelMetricTemporality;
  readonly histogramLayout: NROtelHistogramLayout;
  readonly exportIntervalSeconds: number;
}

export interface DTOtelMetricsIngestSettings {
  readonly schemaId: 'builtin:otel.metrics.ingest';
  readonly displayName: string;
  readonly acceptedTemporality: NROtelMetricTemporality;
  readonly serviceNameSource: string;
  readonly resourceAttributePolicy: 'PASSTHROUGH' | 'RESTRICT';
}

export interface OtelMetricsTransformData {
  readonly exporter: DTOtelMetricsExporter;
  readonly ingestSettings: DTOtelMetricsIngestSettings;
  readonly semconvGuidance: string[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rewriteEndpoint(protocol: 'grpc' | 'http'): string {
  if (protocol === 'grpc') return 'https://<env-id>.live.dynatrace.com/api/v2/otlp';
  return 'https://<env-id>.live.dynatrace.com/api/v2/otlp/v1/metrics';
}

const SEMCONV_GUIDANCE: string[] = [
  '`service.name` is required for Smartscape mapping — verify the SDK resource has it set.',
  '`service.instance.id` should be a stable per-pod/per-host value; DT uses it to distinguish replicas.',
  '`deployment.environment` becomes a DT dimension; pin it to prod/staging/dev to match your bucket strategy.',
  '`host.name` should match the OneAgent-reported host.name so OTel metrics merge with agent telemetry.',
];

const MANUAL_STEPS: string[] = [
  'Re-provision a DT API token with `metrics.ingest` scope; paste it into the exporter Authorization header.',
  'Replace `<env-id>` in the exporter endpoint with your Dynatrace environment id.',
  'DT recommends DELTA temporality for OTLP metrics. If the NR SDK was configured with CUMULATIVE, switch it in the SDK config — DT converts if necessary but DELTA is cheaper.',
  'For histograms, EXPONENTIAL (base-2) layout is preferred by DT; explicit-bucket histograms still ingest but consume more storage.',
];

// ---------------------------------------------------------------------------
// OpenTelemetryMetricsTransformer
// ---------------------------------------------------------------------------

export class OpenTelemetryMetricsTransformer {
  transform(input: NROtelMetricsInput): TransformResult<OtelMetricsTransformData> {
    try {
      const name = input.name ?? 'otlp-metrics-dynatrace';
      const protocol = input.protocol ?? 'grpc';
      const temporality = input.temporality ?? 'DELTA';
      const histogramLayout = input.histogramLayout ?? 'EXPONENTIAL';
      const warnings: string[] = [];

      if (temporality === 'CUMULATIVE') {
        warnings.push(
          'Exporter configured for CUMULATIVE temporality. DT supports both but DELTA is the DT-recommended default and uses less storage.',
        );
      }
      if (histogramLayout === 'EXPLICIT_BUCKET') {
        warnings.push(
          'EXPLICIT_BUCKET histogram layout detected. Consider switching the SDK to EXPONENTIAL histograms for cheaper DT ingest.',
        );
      }
      if (!input.endpoint) {
        warnings.push(
          'NR OTLP metrics endpoint not provided; emitted placeholder DT endpoint. Update `<env-id>` before deploying.',
        );
      }
      const missingSemconv: string[] = [];
      const attrs = input.resourceAttributes ?? {};
      if (!attrs['service.name']) missingSemconv.push('service.name');
      if (!attrs['service.instance.id']) missingSemconv.push('service.instance.id');
      if (missingSemconv.length > 0) {
        warnings.push(
          `Resource attributes missing: ${missingSemconv.join(', ')}. Smartscape / replica distinction requires them.`,
        );
      }

      const exporter: DTOtelMetricsExporter = {
        endpoint: rewriteEndpoint(protocol),
        protocol,
        headers: { Authorization: 'Api-Token <dt-metrics-ingest-token>' },
        temporality,
        histogramLayout,
        exportIntervalSeconds: input.exportIntervalSeconds ?? 60,
      };

      const ingestSettings: DTOtelMetricsIngestSettings = {
        schemaId: 'builtin:otel.metrics.ingest',
        displayName: `[Migrated] ${name}`,
        acceptedTemporality: temporality,
        serviceNameSource: 'resourceAttributes.service.name',
        resourceAttributePolicy: 'PASSTHROUGH',
      };

      return success(
        { exporter, ingestSettings, semconvGuidance: SEMCONV_GUIDANCE, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NROtelMetricsInput[],
  ): TransformResult<OtelMetricsTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
