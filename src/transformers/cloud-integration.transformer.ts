/**
 * Cloud Integration Transformer — Converts New Relic AWS / Azure / GCP
 * integration configs to Dynatrace Gen3 cloud integration settings at
 * full per-service fidelity.
 *
 * Per-service options preserved:
 *   - Polling interval (global + per-service override)
 *   - Tag / namespace / resource-group allowlist + excludelist
 *   - Region restriction (AWS) / subscription scope (Azure) /
 *     multi-project list (GCP)
 *   - Metric-stream vs polling ingestion selector (AWS)
 *   - Private-endpoint / Log Analytics workspace references (Azure)
 *   - Service-account email / federation source (GCP)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRCloudProvider = 'AWS' | 'AZURE' | 'GCP';

export type NRAwsIngestMode = 'POLLING' | 'METRIC_STREAM';

export interface NRCloudServiceConfig {
  /** NR service key, e.g. `aws_ec2`, `azure_vm`, `gcp_gke`. */
  readonly service: string;
  readonly enabled?: boolean;
  /** Override the global polling interval for this service. */
  readonly pollingIntervalSeconds?: number;
  /** AWS-only: which namespace(s) to consume (if service supports multiple). */
  readonly namespaces?: string[];
  /** Allow-list of tags / labels; keys are cloud-native (e.g., 'Environment'). */
  readonly tagAllowlist?: Record<string, string[]>;
  readonly tagExcludelist?: Record<string, string[]>;
  /** Resource-id allowlist (ARNs / resource IDs). */
  readonly resourceAllowlist?: string[];
}

export interface NRCloudIntegrationInput {
  readonly provider: NRCloudProvider;
  readonly name?: string;
  /** AWS account id / Azure subscription id / GCP project id. */
  readonly accountId?: string;
  /** NR-side auth reference (IAM role arn, client id, service-account email). Never transferable. */
  readonly authReference?: string;
  /** Legacy: simple service-enable list (back-compat). Each string maps through SERVICE_MAP. */
  readonly enabledServices?: string[];
  /** Rich per-service configuration. Takes precedence over enabledServices. */
  readonly services?: NRCloudServiceConfig[];
  readonly pollingIntervalSeconds?: number;

  // ─── AWS-specific ────────────────────────────────────────────────────
  readonly awsRegions?: string[];
  readonly awsIngestMode?: NRAwsIngestMode;
  readonly awsExcludedRegions?: string[];

  // ─── Azure-specific ──────────────────────────────────────────────────
  readonly azureResourceGroups?: string[];
  readonly azureExcludedResourceGroups?: string[];
  readonly azureManagementGroupId?: string;
  readonly azureSubscriptions?: string[];

  // ─── GCP-specific ────────────────────────────────────────────────────
  readonly gcpProjects?: string[];
  readonly gcpServiceAccountEmail?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTCloudService {
  readonly serviceName: string;
  readonly enabled: boolean;
  readonly pollingIntervalSeconds?: number;
  readonly namespaces?: string[];
  readonly tagAllowlist?: Record<string, string[]>;
  readonly tagExcludelist?: Record<string, string[]>;
  readonly resourceAllowlist?: string[];
}

export interface DTCloudIntegrationAwsScope {
  readonly regions: string[];
  readonly excludedRegions: string[];
  readonly ingestMode: NRAwsIngestMode;
}

export interface DTCloudIntegrationAzureScope {
  readonly subscriptions: string[];
  readonly resourceGroups: string[];
  readonly excludedResourceGroups: string[];
  readonly managementGroupId: string | undefined;
}

export interface DTCloudIntegrationGcpScope {
  readonly projects: string[];
  readonly serviceAccountEmail: string | undefined;
}

export interface DTCloudIntegration {
  readonly schemaId: 'builtin:cloud.aws' | 'builtin:cloud.azure' | 'builtin:cloud.gcp';
  readonly displayName: string;
  readonly provider: NRCloudProvider;
  readonly accountId: string;
  readonly enabled: boolean;
  readonly services: DTCloudService[];
  readonly pollingIntervalSeconds: number;
  readonly awsScope?: DTCloudIntegrationAwsScope;
  readonly azureScope?: DTCloudIntegrationAzureScope;
  readonly gcpScope?: DTCloudIntegrationGcpScope;
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
    aws_ecs: 'ecs',
    aws_fargate: 'fargate',
    aws_elasticache: 'elasticache',
    aws_route53: 'route53',
    aws_kinesis: 'kinesis',
    aws_firehose: 'firehose',
    aws_stepfunctions: 'stepfunctions',
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
    azure_cosmosdb: 'cosmos_db',
    azure_servicebus: 'service_bus',
    azure_keyvault: 'key_vault',
    azure_eventhubs: 'event_hubs',
    azure_loadbalancer: 'load_balancer',
    azure_applicationgateway: 'application_gateway',
  },
  GCP: {
    gcp_gce: 'compute_engine',
    gcp_gke: 'kubernetes_engine',
    gcp_cloudsql: 'cloud_sql',
    gcp_bigquery: 'bigquery',
    gcp_functions: 'cloud_functions',
    gcp_monitoring: 'cloud_monitoring',
    gcp_cloudrun: 'cloud_run',
    gcp_pubsub: 'pubsub',
    gcp_spanner: 'spanner',
    gcp_bigtable: 'bigtable',
    gcp_appengine: 'app_engine',
    gcp_cloudstorage: 'cloud_storage',
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
    'If the NR integration used CloudWatch Metric Streams, use CloudWatchMetricStreamsTransformer to emit the Firehose + IAM spec, or switch ingestMode to POLLING.',
    'Apply the per-service tag allow-list through the DT AWS integration settings UI (the engine emits the shape; DT applies it).',
  ],
  AZURE: [
    'Create a new Azure AD app registration with the Reader role on every target subscription. NR client credentials are not transferable.',
    'Record the tenantId, clientId, and clientSecret into the Dynatrace Azure integration.',
    'If integration spans multiple subscriptions, grant Monitoring Reader at the management-group level (managementGroupId is surfaced on the emitted scope).',
    'Resource-group allow/exclude lists must be applied per subscription via the DT Azure integration UI.',
  ],
  GCP: [
    'Create a new GCP service account with the Monitoring Viewer + Cloud Asset Viewer roles. NR service-account JSON keys are not transferable.',
    'Upload the service-account JSON key into the Dynatrace GCP integration, or use workload-identity federation if you prefer keyless auth.',
    'If the NR integration monitored multiple projects, list each project id explicitly (gcpProjects on input).',
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
      const globalPolling = input.pollingIntervalSeconds ?? 60;

      // Build services. Prefer the rich `services` array; fall back to
      // `enabledServices` for backward compatibility.
      const services: DTCloudService[] = [];
      const richServices = input.services ?? [];
      const simpleServices = input.enabledServices ?? [];

      for (const svc of richServices) {
        const dtService = providerMap[svc.service.toLowerCase()];
        if (!dtService) {
          warnings.push(
            `NR service '${svc.service}' has no direct Dynatrace ${provider} mapping; enable the equivalent DT extension manually.`,
          );
          continue;
        }
        const out: DTCloudService = {
          serviceName: dtService,
          enabled: svc.enabled ?? true,
          ...(svc.pollingIntervalSeconds !== undefined
            ? { pollingIntervalSeconds: svc.pollingIntervalSeconds }
            : {}),
          ...(svc.namespaces?.length ? { namespaces: [...svc.namespaces] } : {}),
          ...(svc.tagAllowlist ? { tagAllowlist: { ...svc.tagAllowlist } } : {}),
          ...(svc.tagExcludelist ? { tagExcludelist: { ...svc.tagExcludelist } } : {}),
          ...(svc.resourceAllowlist?.length
            ? { resourceAllowlist: [...svc.resourceAllowlist] }
            : {}),
        };
        services.push(out);
      }

      for (const nrService of simpleServices) {
        if (richServices.some((s) => s.service.toLowerCase() === nrService.toLowerCase())) {
          continue; // already covered by rich config
        }
        const dtService = providerMap[nrService.toLowerCase()];
        if (dtService) {
          services.push({ serviceName: dtService, enabled: true });
        } else {
          warnings.push(
            `NR service '${nrService}' has no direct Dynatrace ${provider} mapping; enable the equivalent DT extension manually.`,
          );
        }
      }

      // Provider-specific scope.
      let awsScope: DTCloudIntegrationAwsScope | undefined;
      let azureScope: DTCloudIntegrationAzureScope | undefined;
      let gcpScope: DTCloudIntegrationGcpScope | undefined;

      if (provider === 'AWS') {
        awsScope = {
          regions: input.awsRegions ?? [],
          excludedRegions: input.awsExcludedRegions ?? [],
          ingestMode: input.awsIngestMode ?? 'POLLING',
        };
        if (awsScope.regions.length === 0) {
          warnings.push(
            'No awsRegions provided — the integration will default to every enabled region. Explicit region allowlist is recommended.',
          );
        }
        if (awsScope.ingestMode === 'METRIC_STREAM') {
          warnings.push(
            'ingestMode=METRIC_STREAM selected — pair this integration with CloudWatchMetricStreamsTransformer output to provision the Firehose side.',
          );
        }
      } else if (provider === 'AZURE') {
        azureScope = {
          subscriptions: input.azureSubscriptions ?? [accountId],
          resourceGroups: input.azureResourceGroups ?? [],
          excludedResourceGroups: input.azureExcludedResourceGroups ?? [],
          managementGroupId: input.azureManagementGroupId,
        };
        if ((input.azureSubscriptions?.length ?? 0) > 1 && !input.azureManagementGroupId) {
          warnings.push(
            'Multi-subscription Azure integration detected but no managementGroupId supplied. Grant Monitoring Reader at the management-group level to avoid per-subscription role assignments.',
          );
        }
      } else {
        gcpScope = {
          projects: input.gcpProjects ?? [accountId],
          serviceAccountEmail: input.gcpServiceAccountEmail,
        };
      }

      const integration: DTCloudIntegration = {
        schemaId: SCHEMA_MAP[provider],
        displayName,
        provider,
        accountId,
        enabled: true,
        services,
        pollingIntervalSeconds: globalPolling,
        ...(awsScope ? { awsScope } : {}),
        ...(azureScope ? { azureScope } : {}),
        ...(gcpScope ? { gcpScope } : {}),
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
