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
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        { functionDetection, layerInstructions, manualSteps: MANUAL_STEPS },
        MANUAL_STEPS,
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
