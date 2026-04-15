import { describe, it, expect, beforeEach } from 'vitest';
import { OnHostIntegrationTransformer } from '../../src/transformers/index.js';

describe('OnHostIntegrationTransformer', () => {
  let transformer: OnHostIntegrationTransformer;

  beforeEach(() => {
    transformer = new OnHostIntegrationTransformer();
  });

  it('should fail on unknown kind', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({
      kind: 'unknown' as any,
      endpoints: [{ host: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('should fail with no endpoints', () => {
    const result = transformer.transform({ kind: 'nginx', endpoints: [] });
    expect(result.success).toBe(false);
  });

  it('should emit nginx extension on port 80', () => {
    const result = transformer.transform({
      kind: 'nginx',
      endpoints: [{ host: 'web.local' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.extension.schemaId).toBe('com.dynatrace.extension.nginx');
    expect(result.data!.extension.endpoints[0]!.port).toBe(80);
  });

  it('should cover all 10 integrations', () => {
    const kinds = [
      'nginx',
      'haproxy',
      'kafka',
      'rabbitmq',
      'elasticsearch',
      'memcached',
      'couchbase',
      'consul',
      'apache',
      'etcd',
    ] as const;
    for (const kind of kinds) {
      const result = transformer.transform({
        kind,
        endpoints: [{ host: 'x' }],
      });
      expect(result.success).toBe(true);
      expect(result.data!.extension.schemaId).toContain(kind);
    }
  });

  it('should default interval to 60 seconds', () => {
    const result = transformer.transform({
      kind: 'nginx',
      endpoints: [{ host: 'x' }],
    });
    expect(result.data!.extension.intervalSeconds).toBe(60);
  });

  it('should honor custom port + attributes', () => {
    const result = transformer.transform({
      kind: 'kafka',
      endpoints: [
        { host: 'broker-1', port: 9093, attributes: { cluster: 'prod' } },
      ],
    });
    const ep = result.data!.extension.endpoints[0]!;
    expect(ep.port).toBe(9093);
    expect(ep.attributes['cluster']).toBe('prod');
    expect(ep.attributes['nr-migrated']).toBe('true');
  });

  it('should warn on empty endpoint host', () => {
    const result = transformer.transform({
      kind: 'nginx',
      endpoints: [{ host: '' }],
    });
    expect(result.warnings.some((w) => w.includes('no host'))).toBe(true);
  });
});
