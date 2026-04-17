import { describe, it, expect, beforeEach } from 'vitest';
import { CustomEntityTransformer } from '../../src/transformers/index.js';

describe('CustomEntityTransformer', () => {
  let transformer: CustomEntityTransformer;

  beforeEach(() => {
    transformer = new CustomEntityTransformer();
  });

  it('should fail without a name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({ name: '' as any });
    expect(result.success).toBe(false);
  });

  it('should emit payload with endpoint and nr-migrated tag', () => {
    const result = transformer.transform({
      name: 'Legacy Mainframe',
      guid: 'ENT-123',
      type: 'MAINFRAME',
      group: 'legacy',
    });
    expect(result.success).toBe(true);
    expect(result.data!.endpoint).toBe('/api/v2/entities/custom');
    expect(result.data!.payload.customDeviceId).toBe('ENT-123');
    expect(result.data!.payload.tags).toContain('nr-migrated');
    expect(result.data!.payload.type).toBe('MAINFRAME');
  });

  it('should derive customDeviceId from name and warn when guid missing', () => {
    const result = transformer.transform({ name: 'Legacy Mainframe' });
    expect(result.data!.payload.customDeviceId).toBe('nr-migrated-legacy-mainframe');
    expect(result.warnings.some((w) => w.includes('no NR guid'))).toBe(true);
  });

  it('should serialize tags as key:value strings', () => {
    const result = transformer.transform({
      name: 'X',
      tags: { env: 'prod', team: 'platform' },
    });
    expect(result.data!.payload.tags).toContain('env:prod');
    expect(result.data!.payload.tags).toContain('team:platform');
  });

  it('should include ipAddresses and listenPorts when provided', () => {
    const result = transformer.transform({
      name: 'X',
      ipAddresses: ['10.0.0.1'],
      listenPorts: [8080, 8443],
    });
    expect(result.data!.payload.ipAddresses).toEqual(['10.0.0.1']);
    expect(result.data!.payload.listenPorts).toEqual([8080, 8443]);
  });

  it('should omit optional fields when unset', () => {
    const result = transformer.transform({ name: 'X' });
    expect(result.data!.payload.ipAddresses).toBeUndefined();
    expect(result.data!.payload.listenPorts).toBeUndefined();
    expect(result.data!.payload.configUrl).toBeUndefined();
  });

  it('should include configUrl + faviconUrl when supplied', () => {
    const result = transformer.transform({
      name: 'X',
      configUrl: 'https://cmdb.example.com/x',
      faviconUrl: 'https://example.com/icon.png',
    });
    expect(result.data!.payload.configUrl).toBe('https://cmdb.example.com/x');
    expect(result.data!.payload.faviconUrl).toBe('https://example.com/icon.png');
  });
});
