/**
 * Network Performance Monitoring Transformer — Converts NR NPM / DDI
 * config to Dynatrace Network extensions (SNMP + NetFlow/IPFIX
 * ingestion via ActiveGate).
 *
 * NR NPM emits SNMP-polled device metrics and NetFlow-sampled traffic
 * flows. DT has distinct extensions per transport:
 *   - `com.dynatrace.extension.snmp-generic` for SNMP
 *   - NetFlow/IPFIX receiver on ActiveGate
 *
 * This transformer emits two envelopes: an SNMP extension config +
 * a NetFlow ingestion settings stub. Device credentials are never
 * transferable — flagged as manual.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRSnmpVersion = 'v1' | 'v2c' | 'v3';

export interface NRNpmSnmpDevice {
  readonly host: string;
  readonly port?: number;
  readonly version?: NRSnmpVersion;
  readonly community?: string;
  readonly v3User?: string;
  readonly pollingIntervalSeconds?: number;
  readonly metrics?: string[];
}

export interface NRNpmNetFlowCollector {
  readonly listenPort: number;
  readonly protocol?: 'netflow_v5' | 'netflow_v9' | 'ipfix' | 'sflow';
  readonly sampleRate?: number;
}

export interface NRNpmInput {
  readonly name?: string;
  readonly snmpDevices?: NRNpmSnmpDevice[];
  readonly netflowCollectors?: NRNpmNetFlowCollector[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTSnmpExtensionConfig {
  readonly schemaId: 'com.dynatrace.extension.snmp-generic';
  readonly displayName: string;
  readonly endpoints: Array<{
    readonly host: string;
    readonly port: number;
    readonly version: NRSnmpVersion;
    readonly authRef: string;
    readonly intervalSeconds: number;
    readonly metrics: string[];
  }>;
}

export interface DTNetflowIngestConfig {
  readonly schemaId: 'builtin:netflow.ingest';
  readonly displayName: string;
  readonly listenPort: number;
  readonly protocol: 'netflow_v5' | 'netflow_v9' | 'ipfix' | 'sflow';
  readonly sampleRate: number;
}

export interface NpmTransformData {
  readonly snmpExtension: DTSnmpExtensionConfig | undefined;
  readonly netflowCollectors: DTNetflowIngestConfig[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Deploy an ActiveGate with the Network extension enabled before applying SNMP or NetFlow configs.',
  'SNMP community strings and SNMPv3 credentials are never transferable; re-create them in the DT credentials vault and reference the authRef field.',
  'NetFlow/IPFIX collectors expect the ActiveGate network-receiver port to be reachable from routers/switches — coordinate firewall + routing changes with network ops.',
  'If NR NPM used automatic topology discovery (LLDP/CDP), note that DT relies on Smartscape auth via OneAgent + extension correlation — gaps may appear until both are in place.',
];

// ---------------------------------------------------------------------------
// NpmTransformer
// ---------------------------------------------------------------------------

export class NpmTransformer {
  transform(input: NRNpmInput): TransformResult<NpmTransformData> {
    try {
      const warnings: string[] = [];
      const name = input.name ?? 'nr-npm-migrated';

      const snmpDevices = input.snmpDevices ?? [];
      const netflowCollectors = input.netflowCollectors ?? [];

      if (snmpDevices.length === 0 && netflowCollectors.length === 0) {
        return failure([
          'At least one SNMP device or NetFlow collector is required',
        ]);
      }

      const snmpExtension: DTSnmpExtensionConfig | undefined =
        snmpDevices.length > 0
          ? {
              schemaId: 'com.dynatrace.extension.snmp-generic',
              displayName: `[Migrated] ${name}`,
              endpoints: snmpDevices.map((d, i) => {
                if (d.version === 'v3' && !d.v3User) {
                  warnings.push(
                    `SNMPv3 device #${i} (${d.host}) has no v3User — credential must be re-provisioned in DT credentials vault.`,
                  );
                }
                if (d.version !== 'v3' && !d.community) {
                  warnings.push(
                    `SNMP ${d.version ?? 'v2c'} device #${i} (${d.host}) has no community string — re-provision in DT credentials vault.`,
                  );
                }
                return {
                  host: d.host,
                  port: d.port ?? 161,
                  version: d.version ?? 'v2c',
                  authRef: 'CREDENTIALS_VAULT-<dt-ref>',
                  intervalSeconds: d.pollingIntervalSeconds ?? 60,
                  metrics: [...(d.metrics ?? [])],
                };
              }),
            }
          : undefined;

      const netflow: DTNetflowIngestConfig[] = netflowCollectors.map((c) => ({
        schemaId: 'builtin:netflow.ingest',
        displayName: `[Migrated] ${name} port ${c.listenPort}`,
        listenPort: c.listenPort,
        protocol: c.protocol ?? 'netflow_v9',
        sampleRate: c.sampleRate ?? 1,
      }));

      return success(
        {
          snmpExtension,
          netflowCollectors: netflow,
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(inputs: NRNpmInput[]): TransformResult<NpmTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
