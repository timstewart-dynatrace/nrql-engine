import { describe, it, expect, beforeEach } from 'vitest';
import { NpmTransformer } from '../../src/transformers/index.js';

describe('NpmTransformer', () => {
  let transformer: NpmTransformer;

  beforeEach(() => {
    transformer = new NpmTransformer();
  });

  it('should fail when no devices or collectors are supplied', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(false);
  });

  it('should emit SNMP extension config for a v2c device', () => {
    const result = transformer.transform({
      snmpDevices: [
        { host: '10.0.0.1', version: 'v2c', community: 'public', metrics: ['ifInOctets'] },
      ],
    });
    expect(result.success).toBe(true);
    const ext = result.data!.snmpExtension!;
    expect(ext.schemaId).toBe('com.dynatrace.extension.snmp-generic');
    expect(ext.endpoints[0]!.host).toBe('10.0.0.1');
    expect(ext.endpoints[0]!.version).toBe('v2c');
    expect(ext.endpoints[0]!.port).toBe(161);
    expect(ext.endpoints[0]!.metrics).toEqual(['ifInOctets']);
  });

  it('should warn on v2c devices missing community', () => {
    const result = transformer.transform({
      snmpDevices: [{ host: '10.0.0.1' }],
    });
    expect(result.warnings.some((w) => w.includes('community'))).toBe(true);
  });

  it('should warn on v3 device missing user', () => {
    const result = transformer.transform({
      snmpDevices: [{ host: '10.0.0.1', version: 'v3' }],
    });
    expect(result.warnings.some((w) => w.includes('v3User'))).toBe(true);
  });

  it('should emit NetFlow collectors with default protocol + sampleRate', () => {
    const result = transformer.transform({
      netflowCollectors: [{ listenPort: 2055 }],
    });
    const c = result.data!.netflowCollectors[0]!;
    expect(c.schemaId).toBe('builtin:netflow.ingest');
    expect(c.listenPort).toBe(2055);
    expect(c.protocol).toBe('netflow_v9');
    expect(c.sampleRate).toBe(1);
  });

  it('should honor explicit sFlow protocol', () => {
    const result = transformer.transform({
      netflowCollectors: [{ listenPort: 6343, protocol: 'sflow', sampleRate: 1024 }],
    });
    expect(result.data!.netflowCollectors[0]!.protocol).toBe('sflow');
    expect(result.data!.netflowCollectors[0]!.sampleRate).toBe(1024);
  });

  it('should coexist SNMP + NetFlow when both are supplied', () => {
    const result = transformer.transform({
      snmpDevices: [{ host: '10.0.0.1', version: 'v2c', community: 'public' }],
      netflowCollectors: [{ listenPort: 2055 }],
    });
    expect(result.data!.snmpExtension).toBeDefined();
    expect(result.data!.netflowCollectors).toHaveLength(1);
  });

  it('should emit ActiveGate + credential vault manual steps', () => {
    const result = transformer.transform({
      netflowCollectors: [{ listenPort: 2055 }],
    });
    expect(result.warnings.some((w) => w.includes('ActiveGate'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('credentials vault'))).toBe(true);
  });
});
