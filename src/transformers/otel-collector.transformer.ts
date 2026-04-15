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
  /**
   * Processor pipeline (as defined in the collector config yaml under
   * `processors:`). Keys match the collector-contrib processor names.
   * The transformer emits a DT-equivalent processor chain plus
   * warnings for constructs that do not translate.
   */
  readonly processors?: NROtelProcessor[];
}

export type NROtelProcessor =
  | {
      readonly kind: 'attributes';
      readonly actions: Array<{
        readonly key: string;
        readonly action: 'insert' | 'update' | 'upsert' | 'delete' | 'hash' | 'extract';
        readonly value?: string;
        readonly fromAttribute?: string;
        readonly pattern?: string;
      }>;
    }
  | { readonly kind: 'filter'; readonly match: 'include' | 'exclude'; readonly expression: string }
  | { readonly kind: 'batch'; readonly timeoutSeconds?: number; readonly sendBatchSize?: number }
  | { readonly kind: 'memory_limiter'; readonly limitMiB?: number; readonly checkIntervalSeconds?: number }
  | { readonly kind: 'resource'; readonly attributes: Record<string, string> }
  | { readonly kind: 'unknown'; readonly name: string };

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

/**
 * A translated DT-side processor step. The collector pipeline (a list
 * of named processors) maps to an ordered list of DT OpenPipeline /
 * collector equivalents. Unknown processors are preserved as
 * passthrough entries with warnings.
 */
export type DTOtelProcessorStep =
  | {
      readonly kind: 'fieldsAdd';
      readonly displayName: string;
      readonly fields: Array<{ field: string; value: string }>;
    }
  | {
      readonly kind: 'fieldsRemove';
      readonly displayName: string;
      readonly fields: string[];
    }
  | {
      readonly kind: 'fieldsRename';
      readonly displayName: string;
      readonly renames: Array<{ from: string; to: string }>;
    }
  | {
      readonly kind: 'filter';
      readonly displayName: string;
      readonly matcher: string;
    }
  | {
      readonly kind: 'batch';
      readonly displayName: string;
      readonly timeoutSeconds: number;
      readonly maxRecords: number;
    }
  | {
      readonly kind: 'memoryLimiter';
      readonly displayName: string;
      readonly limitMiB: number;
      readonly checkIntervalSeconds: number;
    }
  | {
      readonly kind: 'passthrough';
      readonly displayName: string;
      readonly note: string;
    };

export interface OtelCollectorTransformData {
  readonly exporter: DTOtlpExporter;
  readonly ingestMapping: DTOtelIngestMapping;
  readonly processorPipeline: DTOtelProcessorStep[];
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

function translateProcessor(
  p: NROtelProcessor,
  index: number,
  warnings: string[],
): DTOtelProcessorStep[] {
  const name = `processor_${index}_${p.kind}`;
  switch (p.kind) {
    case 'attributes': {
      const fieldsAdd: Array<{ field: string; value: string }> = [];
      const fieldsRemove: string[] = [];
      const fieldsRename: Array<{ from: string; to: string }> = [];

      for (const a of p.actions) {
        switch (a.action) {
          case 'insert':
          case 'update':
          case 'upsert':
            fieldsAdd.push({ field: a.key, value: a.value ?? `$${a.fromAttribute ?? ''}` });
            break;
          case 'delete':
            fieldsRemove.push(a.key);
            break;
          case 'hash':
            fieldsAdd.push({ field: a.key, value: `hash(${a.key})` });
            warnings.push(
              `attributes action=hash on '${a.key}' emitted as DPL hash() call — verify DPL hash output matches the SHA-1 convention the collector used.`,
            );
            break;
          case 'extract':
            if (a.fromAttribute && a.pattern) {
              fieldsAdd.push({
                field: a.key,
                value: `extract(${a.fromAttribute}, "${a.pattern}")`,
              });
            } else {
              warnings.push(
                `attributes action=extract on '${a.key}' missing fromAttribute/pattern — skipped.`,
              );
            }
            break;
        }
      }

      const steps: DTOtelProcessorStep[] = [];
      if (fieldsAdd.length > 0)
        steps.push({ kind: 'fieldsAdd', displayName: `${name}_add`, fields: fieldsAdd });
      if (fieldsRemove.length > 0)
        steps.push({ kind: 'fieldsRemove', displayName: `${name}_remove`, fields: fieldsRemove });
      if (fieldsRename.length > 0)
        steps.push({ kind: 'fieldsRename', displayName: `${name}_rename`, renames: fieldsRename });
      return steps;
    }
    case 'filter': {
      const matcher =
        p.match === 'include' ? p.expression : `not (${p.expression})`;
      return [{ kind: 'filter', displayName: name, matcher }];
    }
    case 'batch':
      return [
        {
          kind: 'batch',
          displayName: name,
          timeoutSeconds: p.timeoutSeconds ?? 5,
          maxRecords: p.sendBatchSize ?? 8192,
        },
      ];
    case 'memory_limiter':
      return [
        {
          kind: 'memoryLimiter',
          displayName: name,
          limitMiB: p.limitMiB ?? 512,
          checkIntervalSeconds: p.checkIntervalSeconds ?? 1,
        },
      ];
    case 'resource':
      return [
        {
          kind: 'fieldsAdd',
          displayName: name,
          fields: Object.entries(p.attributes).map(([field, value]) => ({ field, value })),
        },
      ];
    case 'unknown':
      warnings.push(
        `Processor '${p.name}' has no direct DT equivalent; emitted a passthrough note. Review manually.`,
      );
      return [
        {
          kind: 'passthrough',
          displayName: name,
          note: `Original collector processor '${p.name}' — no direct translation.`,
        },
      ];
  }
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

      const processorPipeline: DTOtelProcessorStep[] = [];
      const processors = input.processors ?? [];
      processors.forEach((p, i) => {
        processorPipeline.push(...translateProcessor(p, i, warnings));
      });

      return success(
        { exporter, ingestMapping, processorPipeline, manualSteps: MANUAL_STEPS },
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
