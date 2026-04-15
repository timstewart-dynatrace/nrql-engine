import { describe, it, expect, beforeEach } from 'vitest';
import { LambdaTransformer } from '../../src/transformers/index.js';

describe('LambdaTransformer', () => {
  let transformer: LambdaTransformer;

  beforeEach(() => {
    transformer = new LambdaTransformer();
  });

  it('should fail when arn is missing', () => {
    const result = transformer.transform({ functionName: 'foo' });
    expect(result.success).toBe(false);
  });

  it('should derive name from arn when name is missing', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:123:function:my-function',
      runtime: 'nodejs',
    });
    expect(result.success).toBe(true);
    expect(result.data!.functionDetection.functionName).toBe('my-function');
  });

  it('should derive region from arn', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-west-2:123:function:fn',
      runtime: 'python',
    });
    expect(result.data!.functionDetection.region).toBe('us-west-2');
  });

  it('should set tracingEnabled only for ACTIVE tracing', () => {
    const active = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:a',
      tracing: 'ACTIVE',
    });
    expect(active.data!.functionDetection.tracingEnabled).toBe(true);

    const off = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:b',
      tracing: 'OFF',
    });
    expect(off.data!.functionDetection.tracingEnabled).toBe(false);
  });

  it('should resolve a per-region layer ARN for supported runtimes', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:eu-west-1:1:function:fn',
      runtime: 'python',
    });
    expect(result.data!.resolvedLayerArn).toBe(
      'arn:aws:lambda:eu-west-1:725887861453:layer:Dynatrace_OneAgent_python:<version>',
    );
  });

  it('should not emit a layer ARN for go runtime (compiled-in)', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:fn',
      runtime: 'go',
    });
    expect(result.data!.resolvedLayerArn).toBeUndefined();
  });

  it('should warn and omit ARN for unsupported regions (GovCloud / China)', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-gov-west-1:1:function:fn',
      runtime: 'nodejs',
    });
    expect(result.data!.resolvedLayerArn).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('GovCloud'))).toBe(true);
  });

  it('should resolve layer ARNs across commercial regions', () => {
    const regions = [
      'us-east-1',
      'us-west-2',
      'eu-central-1',
      'eu-west-2',
      'ap-southeast-2',
      'ap-northeast-1',
      'sa-east-1',
      'ca-central-1',
    ];
    for (const region of regions) {
      const result = transformer.transform({
        functionArn: `arn:aws:lambda:${region}:1:function:fn`,
        runtime: 'nodejs',
      });
      expect(result.data!.resolvedLayerArn).toContain(region);
      expect(result.data!.resolvedLayerArn).toContain('Dynatrace_OneAgent_nodejs');
    }
  });

  it('should produce per-runtime layer instructions', () => {
    const runtimes = ['nodejs', 'python', 'java', 'dotnet', 'go', 'ruby', 'custom'] as const;
    for (const runtime of runtimes) {
      const result = transformer.transform({
        functionArn: `arn:aws:lambda:us-east-1:1:function:${runtime}-fn`,
        runtime,
      });
      expect(result.success).toBe(true);
      expect(result.data!.layerInstructions.length).toBeGreaterThan(0);
    }
  });

  it('should merge customAttributes into tags alongside nr-migrated', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:fn',
      customAttributes: { team: 'platform', env: 'prod' },
    });
    expect(result.data!.functionDetection.tags['team']).toBe('platform');
    expect(result.data!.functionDetection.tags['env']).toBe('prod');
    expect(result.data!.functionDetection.tags['nr-migrated']).toBe('true');
  });

  it('should emit manual-step warnings for token + layer swap', () => {
    const result = transformer.transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:fn',
    });
    expect(result.warnings.some((w) => w.includes('DT_CONNECTION_AUTH_TOKEN'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Lambda extension layer'))).toBe(true);
  });

  it('should fail when region cannot be derived', () => {
    const result = transformer.transform({ functionArn: 'not-an-arn' });
    expect(result.success).toBe(false);
  });
});
