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
});
