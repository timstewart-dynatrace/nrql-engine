import { describe, it, expect, beforeEach } from 'vitest';
import { LogArchiveTransformer } from '../../src/transformers/index.js';

describe('LogArchiveTransformer', () => {
  let transformer: LogArchiveTransformer;

  beforeEach(() => {
    transformer = new LogArchiveTransformer();
  });

  it('should fail when neither archive nor exports supplied', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(false);
  });

  it('should emit a Grail bucket with COLD default tier', () => {
    const result = transformer.transform({
      archive: { retentionDays: 365 },
    });
    expect(result.success).toBe(true);
    const b = result.data!.bucket!;
    expect(b.schemaId).toBe('builtin:bucket.retention');
    expect(b.retentionDays).toBe(365);
    expect(b.storageTier).toBe('COLD');
  });

  it('should map compliance flags to DT tags and warn about Data Plus', () => {
    const result = transformer.transform({
      archive: { retentionDays: 365, compliance: ['HIPAA', 'PCI', 'FEDRAMP'] },
    });
    expect(result.data!.bucket!.complianceTags).toEqual([
      'hipaa',
      'pci-dss',
      'fedramp-moderate',
    ]);
    expect(result.warnings.some((w) => w.includes('Data Plus'))).toBe(true);
  });

  it('should warn on unsupported compliance tags', () => {
    const result = transformer.transform({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archive: { retentionDays: 30, compliance: ['ISO27001'] as any },
    });
    expect(result.warnings.some((w) => w.includes('Unsupported compliance'))).toBe(true);
  });

  it('should emit OpenPipeline egress entries for streaming exports', () => {
    const result = transformer.transform({
      exports: [
        {
          name: 'cloudwatch-logs',
          target: 'AWS_KINESIS_FIREHOSE',
          endpoint: 'arn:aws:firehose:...',
        },
        {
          target: 'AZURE_EVENT_HUB',
          endpoint: 'sb://xyz.servicebus.windows.net/log-hub',
        },
      ],
    });
    expect(result.data!.egress).toHaveLength(2);
    expect(result.data!.egress[0]!.schemaId).toBe(
      'builtin:openpipeline.logs.pipelines',
    );
    expect(result.data!.egress[0]!.transport).toBe('AWS_KINESIS_FIREHOSE');
  });

  it('should carry NRQL export filters as TODO matcher', () => {
    const result = transformer.transform({
      exports: [
        {
          target: 'HTTP',
          endpoint: 'https://log-ingest.example.com',
          nrqlFilter: "level = 'ERROR'",
        },
      ],
    });
    expect(result.data!.egress[0]!.matcher).toContain('NRQL TODO');
    expect(result.warnings.some((w) => w.includes('NRQL filter'))).toBe(true);
  });

  it('should handle archive + exports together', () => {
    const result = transformer.transform({
      archive: { retentionDays: 90 },
      exports: [{ target: 'HTTP', endpoint: 'https://x' }],
    });
    expect(result.data!.bucket).toBeDefined();
    expect(result.data!.egress).toHaveLength(1);
  });
});
