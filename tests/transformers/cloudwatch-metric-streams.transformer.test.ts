import { describe, it, expect, beforeEach } from 'vitest';
import { CloudWatchMetricStreamsTransformer } from '../../src/transformers/index.js';

describe('CloudWatchMetricStreamsTransformer', () => {
  let transformer: CloudWatchMetricStreamsTransformer;

  beforeEach(() => {
    transformer = new CloudWatchMetricStreamsTransformer();
  });

  it('should fail without awsAccountId', () => {
    const result = transformer.transform({ awsRegion: 'us-east-1' });
    expect(result.success).toBe(false);
  });

  it('should fail without awsRegion', () => {
    const result = transformer.transform({ awsAccountId: '123' });
    expect(result.success).toBe(false);
  });

  it('should emit builtin:aws.metric-streams config with OTel 1.0 output', () => {
    const result = transformer.transform({
      awsAccountId: '123456789012',
      awsRegion: 'us-east-1',
      includeNamespaces: ['AWS/EC2', 'AWS/Lambda'],
    });
    expect(result.success).toBe(true);
    expect(result.data!.streamConfig.schemaId).toBe('builtin:aws.metric-streams');
    expect(result.data!.streamConfig.outputFormat).toBe('opentelemetry1.0');
    expect(result.data!.streamConfig.includeNamespaces).toEqual([
      'AWS/EC2',
      'AWS/Lambda',
    ]);
  });

  it('should emit Firehose delivery stream with DT HTTP endpoint', () => {
    const result = transformer.transform({
      awsAccountId: '123456789012',
      awsRegion: 'eu-west-1',
    });
    const fh = result.data!.firehoseSpec;
    expect(fh.httpEndpoint.url).toContain('/api/v2/metrics/ingest/aws-metric-streams');
    expect(fh.httpEndpoint.name).toBe('Dynatrace Metric Streams');
    expect(fh.httpEndpoint.s3BackupMode).toBe('FailedDataOnly');
    expect(fh.s3BackupBucket).toContain('123456789012');
    expect(fh.s3BackupBucket).toContain('eu-west-1');
  });

  it('should emit IAM trust policy fragment', () => {
    const result = transformer.transform({
      awsAccountId: '123456789012',
      awsRegion: 'us-east-1',
    });
    expect(result.data!.iamTrust.principal.Service).toBe('firehose.amazonaws.com');
    expect(result.data!.iamTrust.resource).toContain('s3:::');
  });

  it('should warn when no includeNamespaces set', () => {
    const result = transformer.transform({
      awsAccountId: '1',
      awsRegion: 'us-east-1',
    });
    expect(result.warnings.some((w) => w.includes('No includeNamespaces'))).toBe(true);
  });

  it('should warn on non-OTel1.0 output format input', () => {
    const result = transformer.transform({
      awsAccountId: '1',
      awsRegion: 'us-east-1',
      outputFormat: 'opentelemetry0.7',
      includeNamespaces: ['AWS/EC2'],
    });
    expect(result.warnings.some((w) => w.includes('opentelemetry1.0'))).toBe(true);
  });

  it('should carry custom Firehose stream name when provided', () => {
    const result = transformer.transform({
      awsAccountId: '1',
      awsRegion: 'us-east-1',
      firehoseStreamName: 'my-custom-stream',
    });
    expect(result.data!.firehoseSpec.name).toBe('my-custom-stream');
  });
});
