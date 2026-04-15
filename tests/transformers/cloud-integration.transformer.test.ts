import { describe, it, expect, beforeEach } from 'vitest';
import { CloudIntegrationTransformer } from '../../src/transformers/index.js';

describe('CloudIntegrationTransformer', () => {
  let transformer: CloudIntegrationTransformer;

  beforeEach(() => {
    transformer = new CloudIntegrationTransformer();
  });

  it('should fail when provider is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({} as any);
    expect(result.success).toBe(false);
  });

  it('should fail when accountId is missing', () => {
    const result = transformer.transform({ provider: 'AWS' });
    expect(result.success).toBe(false);
  });

  it('should emit AWS integration with correct schema', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '123456789012',
      enabledServices: ['aws_ec2', 'aws_lambda', 'aws_rds'],
    });
    expect(result.success).toBe(true);
    expect(result.data!.integration.schemaId).toBe('builtin:cloud.aws');
    expect(result.data!.integration.accountId).toBe('123456789012');
    const serviceNames = result.data!.integration.services.map((s) => s.serviceName);
    expect(serviceNames).toContain('ec2');
    expect(serviceNames).toContain('lambda');
    expect(serviceNames).toContain('rds');
  });

  it('should emit Azure integration with subscription id', () => {
    const result = transformer.transform({
      provider: 'AZURE',
      accountId: 'sub-abc-123',
      enabledServices: ['azure_vm', 'azure_sql'],
    });
    expect(result.data!.integration.schemaId).toBe('builtin:cloud.azure');
    const serviceNames = result.data!.integration.services.map((s) => s.serviceName);
    expect(serviceNames).toContain('virtual_machines');
    expect(serviceNames).toContain('sql_db');
  });

  it('should emit GCP integration with project id', () => {
    const result = transformer.transform({
      provider: 'GCP',
      accountId: 'my-gcp-project',
      enabledServices: ['gcp_gke', 'gcp_bigquery'],
    });
    expect(result.data!.integration.schemaId).toBe('builtin:cloud.gcp');
    const serviceNames = result.data!.integration.services.map((s) => s.serviceName);
    expect(serviceNames).toContain('kubernetes_engine');
    expect(serviceNames).toContain('bigquery');
  });

  it('should warn on unmapped service names', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '123',
      enabledServices: ['aws_ec2', 'aws_quantum_ledger'],
    });
    expect(result.warnings.some((w) => w.includes('aws_quantum_ledger'))).toBe(true);
    expect(result.data!.integration.services).toHaveLength(1);
  });

  it('should default polling interval to 60 seconds', () => {
    const result = transformer.transform({ provider: 'AWS', accountId: '123' });
    expect(result.data!.integration.pollingIntervalSeconds).toBe(60);
  });

  it('should emit provider-specific manual steps', () => {
    const aws = transformer.transform({ provider: 'AWS', accountId: '1' });
    expect(aws.warnings.some((w) => w.includes('IAM role'))).toBe(true);

    const azure = transformer.transform({ provider: 'AZURE', accountId: '2' });
    expect(azure.warnings.some((w) => w.includes('AD app registration'))).toBe(true);

    const gcp = transformer.transform({ provider: 'GCP', accountId: '3' });
    expect(gcp.warnings.some((w) => w.includes('service account'))).toBe(true);
  });

  it('should transform multiple integrations via transformAll', () => {
    const results = transformer.transformAll([
      { provider: 'AWS', accountId: '111' },
      { provider: 'GCP', accountId: 'proj' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  // ─── Depth-pass additions (P08-01) ───────────────────────────────────

  it('should emit per-service polling + namespace overrides from rich services[]', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '1',
      services: [
        {
          service: 'aws_ec2',
          pollingIntervalSeconds: 30,
          namespaces: ['AWS/EC2'],
          tagAllowlist: { Environment: ['prod', 'staging'] },
        },
      ],
    });
    const ec2 = result.data!.integration.services[0]!;
    expect(ec2.pollingIntervalSeconds).toBe(30);
    expect(ec2.namespaces).toEqual(['AWS/EC2']);
    expect(ec2.tagAllowlist).toEqual({ Environment: ['prod', 'staging'] });
  });

  it('should emit AWS scope with ingestMode default POLLING', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '1',
      awsRegions: ['us-east-1', 'eu-west-1'],
    });
    expect(result.data!.integration.awsScope).toBeDefined();
    expect(result.data!.integration.awsScope!.ingestMode).toBe('POLLING');
    expect(result.data!.integration.awsScope!.regions).toEqual([
      'us-east-1',
      'eu-west-1',
    ]);
  });

  it('should warn when AWS regions are unspecified', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '1',
    });
    expect(result.warnings.some((w) => w.includes('No awsRegions'))).toBe(true);
  });

  it('should warn and pair with metric-streams when ingestMode=METRIC_STREAM', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '1',
      awsRegions: ['us-east-1'],
      awsIngestMode: 'METRIC_STREAM',
    });
    expect(result.data!.integration.awsScope!.ingestMode).toBe('METRIC_STREAM');
    expect(result.warnings.some((w) => w.includes('METRIC_STREAM'))).toBe(true);
  });

  it('should emit Azure scope with resource groups + management group', () => {
    const result = transformer.transform({
      provider: 'AZURE',
      accountId: 'sub-1',
      azureSubscriptions: ['sub-1', 'sub-2', 'sub-3'],
      azureManagementGroupId: 'mg-root',
      azureResourceGroups: ['rg-apps', 'rg-data'],
    });
    const scope = result.data!.integration.azureScope!;
    expect(scope.subscriptions).toHaveLength(3);
    expect(scope.managementGroupId).toBe('mg-root');
    expect(scope.resourceGroups).toEqual(['rg-apps', 'rg-data']);
  });

  it('should warn on multi-subscription Azure without managementGroupId', () => {
    const result = transformer.transform({
      provider: 'AZURE',
      accountId: 'sub-1',
      azureSubscriptions: ['sub-1', 'sub-2'],
    });
    expect(result.warnings.some((w) => w.includes('managementGroupId'))).toBe(true);
  });

  it('should emit GCP scope with multiple projects + service-account email', () => {
    const result = transformer.transform({
      provider: 'GCP',
      accountId: 'proj-a',
      gcpProjects: ['proj-a', 'proj-b', 'proj-c'],
      gcpServiceAccountEmail: 'dt-integration@proj-a.iam.gserviceaccount.com',
    });
    const scope = result.data!.integration.gcpScope!;
    expect(scope.projects).toEqual(['proj-a', 'proj-b', 'proj-c']);
    expect(scope.serviceAccountEmail).toContain('dt-integration@');
  });

  it('should merge rich + simple service lists without duplicates', () => {
    const result = transformer.transform({
      provider: 'AWS',
      accountId: '1',
      services: [{ service: 'aws_ec2', pollingIntervalSeconds: 30 }],
      enabledServices: ['aws_ec2', 'aws_s3'], // ec2 already in rich config; s3 added via simple
    });
    const names = result.data!.integration.services.map((s) => s.serviceName);
    expect(names).toEqual(['ec2', 's3']);
    expect(result.data!.integration.services[0]!.pollingIntervalSeconds).toBe(30);
  });

  it('should cover expanded service catalogs (AWS ECS / Azure Cosmos / GCP Cloud Run)', () => {
    const aws = transformer.transform({
      provider: 'AWS',
      accountId: '1',
      enabledServices: ['aws_ecs', 'aws_fargate', 'aws_elasticache', 'aws_route53'],
      awsRegions: ['us-east-1'],
    });
    expect(aws.data!.integration.services.map((s) => s.serviceName)).toEqual([
      'ecs',
      'fargate',
      'elasticache',
      'route53',
    ]);

    const azure = transformer.transform({
      provider: 'AZURE',
      accountId: 's',
      enabledServices: ['azure_cosmosdb', 'azure_servicebus', 'azure_keyvault'],
    });
    expect(azure.data!.integration.services.map((s) => s.serviceName)).toEqual([
      'cosmos_db',
      'service_bus',
      'key_vault',
    ]);

    const gcp = transformer.transform({
      provider: 'GCP',
      accountId: 'p',
      enabledServices: ['gcp_cloudrun', 'gcp_pubsub', 'gcp_spanner'],
    });
    expect(gcp.data!.integration.services.map((s) => s.serviceName)).toEqual([
      'cloud_run',
      'pubsub',
      'spanner',
    ]);
  });
});
