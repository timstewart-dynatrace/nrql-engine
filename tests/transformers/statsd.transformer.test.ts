import { describe, it, expect, beforeEach } from 'vitest';
import { StatsDTransformer } from '../../src/transformers/index.js';

describe('StatsDTransformer', () => {
  let transformer: StatsDTransformer;

  beforeEach(() => {
    transformer = new StatsDTransformer();
  });

  it('should default listenPort to 8125 and protocol to udp', () => {
    const result = transformer.transform({});
    expect(result.data!.ingest.listenPort).toBe(8125);
    expect(result.data!.ingest.protocol).toBe('udp');
  });

  it('should honor explicit port and tcp protocol', () => {
    const result = transformer.transform({ listenPort: 9100, protocol: 'tcp' });
    expect(result.data!.ingest.listenPort).toBe(9100);
    expect(result.data!.ingest.protocol).toBe('tcp');
  });

  it('should carry tag mappings into dimensionMappings', () => {
    const result = transformer.transform({
      tagMappings: { host: 'dt.host.name', svc: 'service.name' },
    });
    expect(result.data!.ingest.dimensionMappings).toEqual({
      host: 'dt.host.name',
      svc: 'service.name',
    });
  });

  it('should emit forward endpoint to DT metrics ingest', () => {
    const result = transformer.transform({});
    expect(result.data!.ingest.forwardEndpoint).toContain('/api/v2/metrics/ingest');
  });

  it('should emit manual steps about ActiveGate + token', () => {
    const result = transformer.transform({});
    expect(result.warnings.some((w) => w.includes('ActiveGate'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('metrics.ingest'))).toBe(true);
  });

  it('should set schemaId correctly', () => {
    const result = transformer.transform({});
    expect(result.data!.ingest.schemaId).toBe('builtin:statsd.ingest');
  });
});
