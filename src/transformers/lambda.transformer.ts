/**
 * Lambda Transformer — Converts New Relic Lambda function monitoring
 * configuration to Dynatrace Gen3 serverless settings.
 *
 * Gen3 output:
 *   - `builtin:serverless.function-detection` rule associating the
 *     function arn with a DT service
 *   - Lambda layer requirement flagged as a manual deployment step
 *     (customer must attach the DT Lambda extension layer to each
 *     function — NR's Lambda layer cannot be converted in place)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRLambdaRuntime =
  | 'nodejs'
  | 'python'
  | 'java'
  | 'dotnet'
  | 'go'
  | 'ruby'
  | 'custom';

export interface NRLambdaFunctionInput {
  readonly functionName?: string;
  readonly functionArn?: string;
  readonly region?: string;
  readonly runtime?: NRLambdaRuntime;
  readonly tracing?: 'ACTIVE' | 'PASSTHROUGH' | 'OFF';
  readonly layerArn?: string;
  readonly customAttributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTServerlessFunctionDetection {
  readonly schemaId: 'builtin:serverless.function-detection';
  readonly displayName: string;
  readonly functionArn: string;
  readonly functionName: string;
  readonly region: string;
  readonly runtime: NRLambdaRuntime;
  readonly tracingEnabled: boolean;
  readonly tags: Record<string, string>;
}

export interface LambdaTransformData {
  readonly functionDetection: DTServerlessFunctionDetection;
  readonly layerInstructions: string;
  /**
   * Region-resolved DT Lambda layer ARN (or undefined for runtimes that
   * don't use a layer — e.g. go). Format:
   *   arn:aws:lambda:<region>:<dt-account>:layer:<name>:<version>
   */
  readonly resolvedLayerArn: string | undefined;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * DT publishes Lambda layers to its own AWS account per region. The
 * account id is the same across regions for a given AWS partition but
 * the region must be correct for the layer to be attachable.
 *
 * Layer names follow a per-runtime convention that DT publishes. This
 * table encodes the commercial (`aws`) partition only; GovCloud and
 * China partitions use different layer-publisher accounts and are
 * flagged as a manual follow-up.
 */
const DT_LAYER_PUBLISHER_ACCOUNT = '725887861453';

const LAYER_NAME_BY_RUNTIME: Record<NRLambdaRuntime, string | undefined> = {
  nodejs: 'Dynatrace_OneAgent_nodejs',
  python: 'Dynatrace_OneAgent_python',
  java: 'Dynatrace_OneAgent_java',
  dotnet: 'Dynatrace_OneAgent_dotnet',
  go: undefined, // Go: compiled-in, no layer
  ruby: 'Dynatrace_OneAgent_ruby',
  custom: 'Dynatrace_OneAgent_otel', // OTel layer for custom runtimes
};

/**
 * Regions where DT publishes the layer. Commercial (`aws`) partition
 * only — us-gov-* and cn-* require separate publisher accounts.
 */
const SUPPORTED_LAYER_REGIONS: ReadonlySet<string> = new Set([
  // US
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  // Canada / Mexico
  'ca-central-1', 'ca-west-1', 'mx-central-1',
  // South America
  'sa-east-1',
  // Europe
  'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-central-1', 'eu-central-2',
  'eu-north-1', 'eu-south-1', 'eu-south-2',
  // Africa
  'af-south-1',
  // Middle East
  'me-south-1', 'me-central-1', 'il-central-1',
  // Asia Pacific
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5',
  'ap-south-1', 'ap-south-2',
  'ap-east-1',
]);

const LAYER_VERSION_PLACEHOLDER = '<version>';

function resolveLayerArn(region: string, runtime: NRLambdaRuntime): string | undefined {
  const layerName = LAYER_NAME_BY_RUNTIME[runtime];
  if (!layerName) return undefined;
  if (!SUPPORTED_LAYER_REGIONS.has(region)) return undefined;
  return `arn:aws:lambda:${region}:${DT_LAYER_PUBLISHER_ACCOUNT}:layer:${layerName}:${LAYER_VERSION_PLACEHOLDER}`;
}

const LAYER_INSTRUCTIONS: Record<NRLambdaRuntime, string> = {
  nodejs:
    'Attach the DT Lambda layer arn:aws:lambda:<region>:<dt-account>:layer:Dynatrace_OneAgent_nodejs_<version> and set DT_TENANT / DT_CONNECTION_AUTH_TOKEN env vars.',
  python:
    'Attach the DT Lambda layer arn:aws:lambda:<region>:<dt-account>:layer:Dynatrace_OneAgent_python_<version> and wrap the handler with the DT OneAgent SDK initializer.',
  java:
    'Add the DT Java agent layer and set AWS_LAMBDA_EXEC_WRAPPER=/opt/dynatrace-java-wrapper on the function configuration.',
  dotnet:
    'Attach the DT .NET layer and set CORECLR_PROFILER + DT_CONNECTION_AUTH_TOKEN env vars.',
  go:
    'The Go runtime is compiled-in — import dynatrace/go-otel and re-deploy the function (no layer).',
  ruby:
    'Attach the DT Ruby layer and set DT_TENANT + DT_CONNECTION_AUTH_TOKEN env vars.',
  custom:
    'For custom runtimes, use the OpenTelemetry Lambda layer and point the OTLP exporter at the DT ingest endpoint.',
};

const MANUAL_STEPS: string[] = [
  'Replace the NR Lambda layer on each function with the DT Lambda extension layer (or OneAgent layer per runtime). See layerInstructions for the per-runtime command.',
  'Re-provision DT_TENANT and DT_CONNECTION_AUTH_TOKEN env vars on each Lambda function. NR license keys are not transferable.',
  'If tracing was disabled in NR, enable AWS X-Ray Active tracing or the DT distributed-tracing header propagation to match expected behavior.',
];

// ---------------------------------------------------------------------------
// LambdaTransformer
// ---------------------------------------------------------------------------

export class LambdaTransformer {
  transform(input: NRLambdaFunctionInput): TransformResult<LambdaTransformData> {
    try {
      const functionArn = input.functionArn?.trim();
      const functionName = input.functionName?.trim() ?? this.deriveNameFromArn(functionArn);
      if (!functionArn || !functionName) {
        return failure(['Lambda function arn and name are required']);
      }
      const region = input.region ?? this.deriveRegionFromArn(functionArn);
      if (!region) {
        return failure([`Could not derive AWS region from arn '${functionArn}'`]);
      }

      const runtime = input.runtime ?? 'nodejs';
      const tracingEnabled = input.tracing === 'ACTIVE';

      const warnings: string[] = [];
      const resolvedLayerArn = resolveLayerArn(region, runtime);
      if (!resolvedLayerArn && runtime !== 'go') {
        if (!SUPPORTED_LAYER_REGIONS.has(region)) {
          warnings.push(
            `Region '${region}' is not in the DT Lambda layer commercial-partition table (may be GovCloud / China). Attach the layer manually using the DT-supplied ARN for that partition.`,
          );
        }
      }

      const functionDetection: DTServerlessFunctionDetection = {
        schemaId: 'builtin:serverless.function-detection',
        displayName: `[Migrated] ${functionName}`,
        functionArn,
        functionName,
        region,
        runtime,
        tracingEnabled,
        tags: {
          'nr-migrated': 'true',
          ...(input.customAttributes ?? {}),
        },
      };

      const layerInstructions = LAYER_INSTRUCTIONS[runtime];

      return success(
        { functionDetection, layerInstructions, resolvedLayerArn, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRLambdaFunctionInput[],
  ): TransformResult<LambdaTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }

  private deriveNameFromArn(arn: string | undefined): string | undefined {
    if (!arn) return undefined;
    const parts = arn.split(':');
    return parts[parts.length - 1];
  }

  private deriveRegionFromArn(arn: string): string | undefined {
    // arn:aws:lambda:<region>:<account>:function:<name>
    const match = /^arn:aws:lambda:([^:]+):/.exec(arn);
    return match ? match[1] : undefined;
  }
}
