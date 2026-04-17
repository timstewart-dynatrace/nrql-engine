/**
 * Legacy Cloud Integration Transformer (Gen2-only fallback).
 *
 * For tenants still on the classic DT cloud integration APIs
 * (`/api/config/v1/aws/credentials`, `/api/config/v1/azure/credentials`,
 * `/api/config/v1/gcp/credentials`). The default
 * `CloudIntegrationTransformer` targets the Gen3 Settings v2 schemas
 * (`builtin:cloud.aws` / `.azure` / `.gcp`). This variant emits the
 * classic v1 shape for customers that have not upgraded.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type {
  NRCloudIntegrationInput,
  NRCloudServiceConfig,
} from './cloud-integration.transformer.js';

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LegacyAwsCredentialsConfig {
  readonly endpoint: '/api/config/v1/aws/credentials';
  readonly label: string;
  readonly partitionType: 'AWS_DEFAULT' | 'AWS_CN' | 'AWS_US_GOV';
  readonly authenticationData: {
    readonly type: 'ROLE';
    readonly roleBasedAuthentication: {
      readonly iamRole: string;
      readonly accountId: string;
    };
  };
  readonly taggedOnly: boolean;
  readonly tagsToMonitor: Array<{ name: string; value?: string }>;
  readonly servicesToMonitor: string[];
}

export interface LegacyAzureCredentialsConfig {
  readonly endpoint: '/api/config/v1/azure/credentials';
  readonly label: string;
  readonly appId: string;
  readonly directoryId: string;
  readonly key: '<dt-azure-client-secret>';
  readonly autoTagging: boolean;
  readonly monitorOnlyTaggedEntities: boolean;
  readonly monitorOnlyTagPairs: Array<{ name: string; value?: string }>;
  readonly supportingServicesToMonitor: string[];
}

export interface LegacyGcpCredentialsConfig {
  readonly endpoint: '/api/config/v1/gcp/credentials';
  readonly label: string;
  readonly projects: string[];
  readonly services: string[];
  /** Path in the classic credentials vault where the service-account JSON lives. */
  readonly credentialsVaultRef: string;
}

export type LegacyCloudIntegrationPayload =
  | LegacyAwsCredentialsConfig
  | LegacyAzureCredentialsConfig
  | LegacyGcpCredentialsConfig;

export interface LegacyCloudIntegrationTransformData {
  readonly config: LegacyCloudIntegrationPayload;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Service-name maps (NR → classic DT v1 names differ slightly from Gen3)
// ---------------------------------------------------------------------------

const V1_SERVICE_MAP_AWS: Record<string, string> = {
  aws_ec2: 'EC2',
  aws_lambda: 'LAMBDA',
  aws_rds: 'RDS',
  aws_dynamodb: 'DYNAMODB',
  aws_eks: 'EKS',
  aws_elb: 'ELB',
  aws_s3: 'S3',
  aws_sqs: 'SQS',
  aws_sns: 'SNS',
  aws_apigateway: 'APIGATEWAY',
  aws_ecs: 'ECS',
  aws_fargate: 'FARGATE',
  aws_elasticache: 'ELASTICACHE',
  aws_route53: 'ROUTE53',
  aws_kinesis: 'KINESIS',
  aws_firehose: 'FIREHOSE',
  aws_stepfunctions: 'STEP_FUNCTIONS',
  cloudwatch: 'CLOUD_WATCH',
};

const V1_SERVICE_MAP_AZURE: Record<string, string> = {
  azure_vm: 'VIRTUAL_MACHINES',
  azure_sql: 'SQL_SERVERS',
  azure_appservice: 'APP_SERVICE',
  azure_aks: 'KUBERNETES_SERVICES',
  azure_functions: 'FUNCTIONS',
  azure_storage: 'STORAGE_ACCOUNTS',
  azure_cosmosdb: 'COSMOS_DB',
  azure_servicebus: 'SERVICE_BUS',
  azure_keyvault: 'KEY_VAULT',
  azure_eventhubs: 'EVENT_HUBS',
  azure_loadbalancer: 'LOAD_BALANCERS',
  azure_applicationgateway: 'APPLICATION_GATEWAYS',
};

const V1_SERVICE_MAP_GCP: Record<string, string> = {
  gcp_gce: 'COMPUTE_ENGINE',
  gcp_gke: 'KUBERNETES_ENGINE',
  gcp_cloudsql: 'CLOUD_SQL',
  gcp_bigquery: 'BIGQUERY',
  gcp_functions: 'CLOUD_FUNCTIONS',
  gcp_monitoring: 'CLOUD_MONITORING',
  gcp_cloudrun: 'CLOUD_RUN',
  gcp_pubsub: 'PUBSUB',
  gcp_spanner: 'SPANNER',
  gcp_bigtable: 'BIGTABLE',
  gcp_appengine: 'APP_ENGINE',
  gcp_cloudstorage: 'CLOUD_STORAGE',
};

const LEGACY_WARNING =
  'Emitting Gen2 classic /api/config/v1/* cloud credentials payload (legacy). Default output targets the Gen3 Settings v2 builtin:cloud.* schemas — use CloudIntegrationTransformer unless legacy parity is required.';

const MANUAL_STEPS: string[] = [
  'Classic DT cloud credentials have been superseded by Gen3 Settings v2 schemas on newer tenants. Confirm the target tenant still accepts /api/config/v1/* before applying.',
  'Re-provision IAM role ARN / Azure app registration / GCP service-account JSON in DT — NR auth identities are not transferable.',
  'Tag allow/exclude lists in the classic v1 payload are simpler than the Gen3 per-service tagAllowlist map; if you rely on per-service tag scoping, use the Gen3 transformer instead.',
];

function resolveServices(
  provider: 'AWS' | 'AZURE' | 'GCP',
  input: NRCloudIntegrationInput,
  warnings: string[],
): string[] {
  const map =
    provider === 'AWS'
      ? V1_SERVICE_MAP_AWS
      : provider === 'AZURE'
        ? V1_SERVICE_MAP_AZURE
        : V1_SERVICE_MAP_GCP;
  const fromSimple = input.enabledServices ?? [];
  const fromRich = (input.services ?? []).map((s: NRCloudServiceConfig) => s.service);
  const merged = Array.from(new Set([...fromRich, ...fromSimple]));
  const out: string[] = [];
  for (const s of merged) {
    const mapped = map[s.toLowerCase()];
    if (mapped) out.push(mapped);
    else
      warnings.push(
        `Service '${s}' has no classic-v1 name for ${provider}; enable manually via the classic UI.`,
      );
  }
  return out;
}

// ---------------------------------------------------------------------------
// LegacyCloudIntegrationTransformer
// ---------------------------------------------------------------------------

export class LegacyCloudIntegrationTransformer {
  transform(
    input: NRCloudIntegrationInput,
  ): TransformResult<LegacyCloudIntegrationTransformData> {
    try {
      if (!input.provider) return failure(['provider is required']);
      if (!input.accountId?.trim()) {
        return failure(['accountId is required']);
      }
      const warnings: string[] = [LEGACY_WARNING];
      const label = input.name ?? `nr-migrated-${input.provider.toLowerCase()}-${input.accountId}`;

      let config: LegacyCloudIntegrationPayload;

      if (input.provider === 'AWS') {
        const services = resolveServices('AWS', input, warnings);
        config = {
          endpoint: '/api/config/v1/aws/credentials',
          label,
          partitionType: 'AWS_DEFAULT',
          authenticationData: {
            type: 'ROLE',
            roleBasedAuthentication: {
              iamRole: '<dt-iam-role>',
              accountId: input.accountId,
            },
          },
          taggedOnly: false,
          tagsToMonitor: [],
          servicesToMonitor: services,
        };
      } else if (input.provider === 'AZURE') {
        const services = resolveServices('AZURE', input, warnings);
        config = {
          endpoint: '/api/config/v1/azure/credentials',
          label,
          appId: '<dt-azure-client-id>',
          directoryId: '<dt-azure-tenant-id>',
          key: '<dt-azure-client-secret>',
          autoTagging: true,
          monitorOnlyTaggedEntities: false,
          monitorOnlyTagPairs: [],
          supportingServicesToMonitor: services,
        };
      } else {
        const services = resolveServices('GCP', input, warnings);
        const projects = input.gcpProjects ?? [input.accountId];
        config = {
          endpoint: '/api/config/v1/gcp/credentials',
          label,
          projects,
          services,
          credentialsVaultRef: 'CREDENTIALS_VAULT-<dt-ref>',
        };
      }

      return success({ config, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCloudIntegrationInput[],
  ): TransformResult<LegacyCloudIntegrationTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
