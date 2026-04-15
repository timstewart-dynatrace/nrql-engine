/**
 * Cloud Integration Transformer — Converts New Relic AWS / Azure / GCP
 * integration configs to Dynatrace Gen3 cloud integration settings.
 *
 * Gen3 schemas:
 *   - AWS   → `builtin:cloud.aws`
 *   - Azure → `builtin:cloud.azure`
 *   - GCP   → `builtin:cloud.gcp`
 *
 * Each provider has account/subscription/project-level identity plus a
 * list of monitored services (EC2, Lambda, RDS, App Service, Cloud SQL,
 * …). IAM roles, app registrations, service-account JSON keys cannot
 * be transferred — they must be re-provisioned in Dynatrace and
 * flagged as manual steps.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRCloudProvider = 'AWS' | 'AZURE' | 'GCP';

export interface NRCloudIntegrationInput {
  readonly provider: NRCloudProvider;
  readonly name?: string;
  /** AWS account id / Azure subscription id / GCP project id */
  readonly accountId?: string;
  /** NR-side auth reference (IAM role arn, client id, service-account email). Never transferable. */
  readonly authReference?: string;
  readonly enabledServices?: string[];
  /** Optional metric polling interval in seconds. */
  readonly pollingIntervalSeconds?: number;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTCloudIntegration {
  readonly schemaId: 'builtin:cloud.aws' | 'builtin:cloud.azure' | 'builtin:cloud.gcp';
  readonly displayName: string;
  readonly provider: NRCloudProvider;
  readonly accountId: string;
  readonly enabled: boolean;
  readonly services: DTCloudService[];
  readonly pollingIntervalSeconds: number;
}

export interface DTCloudService {
  readonly serviceName: string;
  readonly enabled: boolean;
}

export interface CloudIntegrationTransformData {
  readonly integration: DTCloudIntegration;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// NR service name → DT service name mapping
// ---------------------------------------------------------------------------

const SERVICE_MAP: Record<NRCloudProvider, Record<string, string>> = {
  AWS: {
    aws_ec2: 'ec2',
    aws_lambda: 'lambda',
    aws_rds: 'rds',
    aws_dynamodb: 'dynamodb',
    aws_eks: 'eks',
    aws_elb: 'elb',
    aws_s3: 's3',
    aws_sqs: 'sqs',
    aws_sns: 'sns',
    aws_apigateway: 'apigateway',
    cloudwatch: 'cloudwatch',
  },
  AZURE: {
    azure_vm: 'virtual_machines',
    azure_sql: 'sql_db',
    azure_appservice: 'app_service',
    azure_aks: 'aks',
    azure_functions: 'functions',
    azure_storage: 'storage',
    azure_monitor: 'azure_monitor',
  },
  GCP: {
    gcp_gce: 'compute_engine',
    gcp_gke: 'kubernetes_engine',
    gcp_cloudsql: 'cloud_sql',
    gcp_bigquery: 'bigquery',
    gcp_functions: 'cloud_functions',
    gcp_monitoring: 'cloud_monitoring',
  },
};

const SCHEMA_MAP: Record<NRCloudProvider, DTCloudIntegration['schemaId']> = {
  AWS: 'builtin:cloud.aws',
  AZURE: 'builtin:cloud.azure',
  GCP: 'builtin:cloud.gcp',
};

const MANUAL_STEPS: Record<NRCloudProvider, string[]> = {
  AWS: [
    'Re-create the AWS IAM role granting Dynatrace read-only access (sts:AssumeRole with the DT trust policy). The NR IAM role arn is not transferable.',
    'Paste the new IAM role arn into the Dynatrace AWS integration; DT validates by calling sts:GetCallerIdentity.',
    'If the NR integration used CloudWatch Metric Streams, recreate the Kinesis Firehose delivery stream against DT (or migrate to the DT-managed polling path).',
  ],
  AZURE: [
    'Create a new Azure AD app registration with the Reader role on the target subscription. NR client credentials are not transferable.',
    'Record the tenantId, clientId, and clientSecret into the Dynatrace Azure integration.',
    'Grant Monitoring Reader on any management group if the integration spans multiple subscriptions.',
  ],
  GCP: [
    'Create a new GCP service account with the Monitoring Viewer + Cloud Asset Viewer roles. NR service-account JSON keys are not transferable.',
    'Upload the service-account JSON key into the Dynatrace GCP integration.',
    'If the NR integration monitored multiple projects, list each project id explicitly in the DT integration.',
  ],
};

// ---------------------------------------------------------------------------
// CloudIntegrationTransformer
// ---------------------------------------------------------------------------

export class CloudIntegrationTransformer {
  transform(input: NRCloudIntegrationInput): TransformResult<CloudIntegrationTransformData> {
    try {
      if (!input.provider) {
        return failure(['Cloud provider (AWS / AZURE / GCP) is required']);
      }
      const provider = input.provider;
      const accountId = input.accountId?.trim();
      if (!accountId) {
        return failure([
          `Account identifier (${
            provider === 'AWS' ? 'AWS account id' : provider === 'AZURE' ? 'subscription id' : 'project id'
          }) is required for ${provider} integration`,
        ]);
      }

      const warnings: string[] = [];
      const displayName = input.name ?? `[Migrated] ${provider} ${accountId}`;
      const providerMap = SERVICE_MAP[provider];

      const services: DTCloudService[] = [];
      for (const nrService of input.enabledServices ?? []) {
        const dtService = providerMap[nrService.toLowerCase()];
        if (dtService) {
          services.push({ serviceName: dtService, enabled: true });
        } else {
          warnings.push(
            `NR service '${nrService}' has no direct Dynatrace ${provider} mapping; enable the equivalent DT extension manually.`,
          );
        }
      }

      const integration: DTCloudIntegration = {
        schemaId: SCHEMA_MAP[provider],
        displayName,
        provider,
        accountId,
        enabled: true,
        services,
        pollingIntervalSeconds: input.pollingIntervalSeconds ?? 60,
      };

      const manualSteps = MANUAL_STEPS[provider];

      return success({ integration, manualSteps }, [...warnings, ...manualSteps]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCloudIntegrationInput[],
  ): TransformResult<CloudIntegrationTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
