/**
 * Log Archive + Streaming Export Transformer — Covers two related NR
 * log-pipeline features:
 *
 *   - **Log Live Archive** (NR's tiered long-term storage) → Grail
 *     cold bucket + per-bucket retention policy.
 *   - **Streaming Exports** (Kinesis Firehose / Azure Event Hubs /
 *     GCP Pub/Sub) → OpenPipeline HTTP egress processor targeting the
 *     same downstream transport.
 *
 * Both emit distinct output shapes in the same transform result so a
 * single NR archive+export config translates in one call.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRArchiveStorageTier = 'HOT' | 'WARM' | 'COLD';

export interface NRLogArchiveConfig {
  readonly bucketName?: string;
  readonly retentionDays: number;
  readonly storageTier?: NRArchiveStorageTier;
  readonly compliance?: Array<'HIPAA' | 'PCI' | 'FEDRAMP' | 'SOX'>;
}

export type NRStreamingExportTarget =
  | 'AWS_KINESIS_FIREHOSE'
  | 'AZURE_EVENT_HUB'
  | 'GCP_PUBSUB'
  | 'HTTP';

export interface NRStreamingExportConfig {
  readonly name?: string;
  readonly target: NRStreamingExportTarget;
  readonly endpoint: string;
  readonly nrqlFilter?: string;
  readonly authRef?: string;
}

export interface NRLogArchiveInput {
  readonly archive?: NRLogArchiveConfig;
  readonly exports?: NRStreamingExportConfig[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTGrailBucket {
  readonly schemaId: 'builtin:bucket.retention';
  readonly bucketName: string;
  readonly retentionDays: number;
  readonly storageTier: NRArchiveStorageTier;
  readonly complianceTags: string[];
}

export type DTComplianceTag = 'hipaa' | 'pci-dss' | 'fedramp-moderate' | 'sox';

export interface DTOpenPipelineEgress {
  readonly schemaId: 'builtin:openpipeline.logs.pipelines';
  readonly stage: 'egress';
  readonly displayName: string;
  readonly transport: NRStreamingExportTarget;
  readonly endpoint: string;
  readonly authRef: string;
  readonly matcher: string;
}

export interface LogArchiveTransformData {
  readonly bucket: DTGrailBucket | undefined;
  readonly egress: DTOpenPipelineEgress[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPLIANCE_MAP: Record<string, DTComplianceTag> = {
  HIPAA: 'hipaa',
  PCI: 'pci-dss',
  FEDRAMP: 'fedramp-moderate',
  SOX: 'sox',
};

const MANUAL_STEPS: string[] = [
  'Grail buckets are tenant-level resources — coordinate retention policy with your Dynatrace admin team before applying (retention changes are not trivially reversible).',
  'Compliance tags (hipaa / pci-dss / fedramp-moderate / sox) require the Data Plus tier on the target tenant. Confirm the tier before applying or the tags will be silently dropped.',
  'Streaming egress targets require re-provisioning transport credentials in DT credentials vault. NR endpoint URLs and signing keys are not transferable.',
  'If the NR exports had NRQL filters, compile each via nrql-engine and replace the TODO matcher comment before enabling the pipeline.',
];

// ---------------------------------------------------------------------------
// LogArchiveTransformer
// ---------------------------------------------------------------------------

export class LogArchiveTransformer {
  transform(input: NRLogArchiveInput): TransformResult<LogArchiveTransformData> {
    try {
      if (!input.archive && (!input.exports || input.exports.length === 0)) {
        return failure([
          'At least one of archive or exports must be supplied',
        ]);
      }
      const warnings: string[] = [];

      let bucket: DTGrailBucket | undefined;
      if (input.archive) {
        const unsupportedCompliance = (input.archive.compliance ?? []).filter(
          (c) => !COMPLIANCE_MAP[c],
        );
        if (unsupportedCompliance.length > 0) {
          warnings.push(
            `Unsupported compliance tags skipped: ${unsupportedCompliance.join(', ')}`,
          );
        }
        const complianceTags = (input.archive.compliance ?? [])
          .map((c) => COMPLIANCE_MAP[c])
          .filter((v): v is DTComplianceTag => !!v);

        bucket = {
          schemaId: 'builtin:bucket.retention',
          bucketName: input.archive.bucketName ?? `nr_migrated_archive_${input.archive.retentionDays}d`,
          retentionDays: input.archive.retentionDays,
          storageTier: input.archive.storageTier ?? 'COLD',
          complianceTags,
        };

        if (complianceTags.length > 0) {
          warnings.push(
            'Compliance tags emitted; confirm the DT tenant has the Data Plus tier or the tags will be dropped at apply time.',
          );
        }
      }

      const egress: DTOpenPipelineEgress[] = (input.exports ?? []).map((e, i) => {
        if (e.nrqlFilter) {
          warnings.push(
            `Export '${e.name ?? e.endpoint}' has an NRQL filter — compile via nrql-engine and replace the TODO matcher.`,
          );
        }
        return {
          schemaId: 'builtin:openpipeline.logs.pipelines',
          stage: 'egress',
          displayName: `[Migrated Export] ${e.name ?? `export_${i}`}`,
          transport: e.target,
          endpoint: e.endpoint,
          authRef: e.authRef ?? 'CREDENTIALS_VAULT-<dt-ref>',
          matcher: e.nrqlFilter
            ? `/* NRQL TODO: ${e.nrqlFilter} */ true`
            : 'true',
        };
      });

      return success(
        { bucket, egress, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRLogArchiveInput[],
  ): TransformResult<LogArchiveTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
