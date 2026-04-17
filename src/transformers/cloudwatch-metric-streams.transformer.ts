/**
 * CloudWatch Metric Streams Transformer — Converts New Relic CloudWatch
 * Metric Streams (Kinesis-Firehose-based ingestion path) to Dynatrace
 * AWS Metric Streams ingest settings.
 *
 * Gen3 output:
 *   - Firehose delivery-stream spec pointing at the DT ingest endpoint
 *     `/api/v2/metrics/ingest/aws-metric-streams`
 *   - `builtin:aws.metric-streams` settings object scoping which
 *     AWS namespaces and output formats are accepted
 *   - IAM role trust-policy stub for the Firehose delivery role
 *
 * Manual steps: re-provision the Firehose IAM role, create the Firehose
 * delivery stream, attach the DT-side HTTP endpoint destination.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRCloudWatchMetricStreamInput {
  readonly name?: string;
  readonly awsAccountId?: string;
  readonly awsRegion?: string;
  /**
   * AWS CloudWatch namespaces streamed (e.g. `AWS/EC2`, `AWS/Lambda`,
   * `AWS/RDS`). Empty list = all namespaces (not recommended).
   */
  readonly includeNamespaces?: string[];
  readonly excludeNamespaces?: string[];
  readonly outputFormat?: 'json' | 'opentelemetry0.7' | 'opentelemetry1.0';
  /** NR Firehose stream name (customer-side; re-created on DT side). */
  readonly firehoseStreamName?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTAwsMetricStreamsConfig {
  readonly schemaId: 'builtin:aws.metric-streams';
  readonly displayName: string;
  readonly awsAccountId: string;
  readonly awsRegion: string;
  readonly enabled: boolean;
  readonly includeNamespaces: string[];
  readonly excludeNamespaces: string[];
  readonly outputFormat: 'opentelemetry1.0';
}

export interface DTFirehoseDeliveryStreamSpec {
  readonly name: string;
  readonly httpEndpoint: {
    readonly url: string;
    readonly name: 'Dynatrace Metric Streams';
    readonly accessKey: string;
    readonly s3BackupMode: 'FailedDataOnly';
  };
  readonly s3BackupBucket: string;
  readonly roleArn: string;
}

export interface DTFirehoseIamTrust {
  readonly statementId: 'FirehoseToDynatrace';
  readonly effect: 'Allow';
  readonly principal: { readonly Service: 'firehose.amazonaws.com' };
  readonly action: 's3:PutObject';
  readonly resource: string;
}

export interface CloudWatchMetricStreamsTransformData {
  readonly streamConfig: DTAwsMetricStreamsConfig;
  readonly firehoseSpec: DTFirehoseDeliveryStreamSpec;
  readonly iamTrust: DTFirehoseIamTrust;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Create a DT API token with `metrics.ingest` scope and paste it into the Firehose httpEndpoint.accessKey field.',
  'Replace `<env-id>` in the httpEndpoint URL with your Dynatrace environment id.',
  'Provision a new S3 bucket for failed-delivery backup (NR buckets are not transferable) and update s3BackupBucket.',
  'Create the IAM role referenced by roleArn with the supplied trust policy and firehose:PutRecord + s3:PutObject permissions.',
  'Enable the CloudWatch Metric Stream on the AWS side pointing at the new Firehose delivery stream.',
];

// ---------------------------------------------------------------------------
// CloudWatchMetricStreamsTransformer
// ---------------------------------------------------------------------------

export class CloudWatchMetricStreamsTransformer {
  transform(
    input: NRCloudWatchMetricStreamInput,
  ): TransformResult<CloudWatchMetricStreamsTransformData> {
    try {
      const name = input.name ?? 'nr-metric-stream-migrated';
      const awsAccountId = input.awsAccountId?.trim();
      const awsRegion = input.awsRegion?.trim();
      if (!awsAccountId) return failure(['awsAccountId is required']);
      if (!awsRegion) return failure(['awsRegion is required']);

      const warnings: string[] = [];
      const includeNamespaces = input.includeNamespaces ?? [];
      const excludeNamespaces = input.excludeNamespaces ?? [];

      if (includeNamespaces.length === 0) {
        warnings.push(
          'No includeNamespaces set — the stream will forward every CloudWatch namespace. Explicit allowlist is strongly recommended for cost control.',
        );
      }

      if (input.outputFormat && input.outputFormat !== 'opentelemetry1.0') {
        warnings.push(
          `NR stream outputFormat '${input.outputFormat}' is not the DT-required 'opentelemetry1.0'. Recreate the AWS Metric Stream with OpenTelemetry 1.0 output.`,
        );
      }

      const streamConfig: DTAwsMetricStreamsConfig = {
        schemaId: 'builtin:aws.metric-streams',
        displayName: `[Migrated] ${name}`,
        awsAccountId,
        awsRegion,
        enabled: true,
        includeNamespaces: [...includeNamespaces],
        excludeNamespaces: [...excludeNamespaces],
        outputFormat: 'opentelemetry1.0',
      };

      const firehoseSpec: DTFirehoseDeliveryStreamSpec = {
        name: input.firehoseStreamName ?? `dt-metric-stream-${awsRegion}`,
        httpEndpoint: {
          url: `https://<env-id>.live.dynatrace.com/api/v2/metrics/ingest/aws-metric-streams`,
          name: 'Dynatrace Metric Streams',
          accessKey: '<dt-ingest-token>',
          s3BackupMode: 'FailedDataOnly',
        },
        s3BackupBucket: `dt-metric-stream-backup-${awsAccountId}-${awsRegion}`,
        roleArn: `arn:aws:iam::${awsAccountId}:role/dt-firehose-delivery-role`,
      };

      const iamTrust: DTFirehoseIamTrust = {
        statementId: 'FirehoseToDynatrace',
        effect: 'Allow',
        principal: { Service: 'firehose.amazonaws.com' },
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${firehoseSpec.s3BackupBucket}/*`,
      };

      return success(
        { streamConfig, firehoseSpec, iamTrust, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCloudWatchMetricStreamInput[],
  ): TransformResult<CloudWatchMetricStreamsTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
