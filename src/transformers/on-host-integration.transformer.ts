/**
 * On-Host Integration Transformer — Converts NR Infrastructure "on-host"
 * integrations (MySQL/Postgres/Redis/NGINX/Kafka/RabbitMQ/…) to the
 * corresponding Dynatrace extension config.
 *
 * Distinct from DatabaseMonitoringTransformer: this covers the
 * broader set of infrastructure integrations (HAProxy, NGINX, Kafka,
 * RabbitMQ, Elasticsearch, Memcached, etc.) that NR historically
 * shipped under `newrelic-infra`'s integration framework.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NROnHostIntegrationKind =
  | 'nginx'
  | 'haproxy'
  | 'kafka'
  | 'rabbitmq'
  | 'elasticsearch'
  | 'memcached'
  | 'couchbase'
  | 'consul'
  | 'apache'
  | 'etcd';

export interface NROnHostIntegrationInput {
  readonly kind: NROnHostIntegrationKind;
  readonly name?: string;
  readonly endpoints: Array<{
    readonly host: string;
    readonly port?: number;
    readonly credentialsRef?: string;
    readonly attributes?: Record<string, string>;
  }>;
  readonly intervalSeconds?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTOnHostExtensionConfig {
  readonly schemaId: string;
  readonly displayName: string;
  readonly intervalSeconds: number;
  readonly endpoints: Array<{
    readonly host: string;
    readonly port: number;
    readonly credentialsRef: string;
    readonly attributes: Record<string, string>;
  }>;
}

export interface OnHostIntegrationTransformData {
  readonly extension: DTOnHostExtensionConfig;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Integration → extension schema + default port
// ---------------------------------------------------------------------------

const INTEGRATION_MAP: Record<
  NROnHostIntegrationKind,
  { schemaId: string; defaultPort: number }
> = {
  nginx: { schemaId: 'com.dynatrace.extension.nginx', defaultPort: 80 },
  haproxy: { schemaId: 'com.dynatrace.extension.haproxy', defaultPort: 1936 },
  kafka: { schemaId: 'com.dynatrace.extension.kafka', defaultPort: 9092 },
  rabbitmq: {
    schemaId: 'com.dynatrace.extension.rabbitmq',
    defaultPort: 15672,
  },
  elasticsearch: {
    schemaId: 'com.dynatrace.extension.elasticsearch',
    defaultPort: 9200,
  },
  memcached: {
    schemaId: 'com.dynatrace.extension.memcached',
    defaultPort: 11211,
  },
  couchbase: {
    schemaId: 'com.dynatrace.extension.couchbase',
    defaultPort: 8091,
  },
  consul: { schemaId: 'com.dynatrace.extension.consul', defaultPort: 8500 },
  apache: { schemaId: 'com.dynatrace.extension.apache', defaultPort: 80 },
  etcd: { schemaId: 'com.dynatrace.extension.etcd', defaultPort: 2379 },
};

const MANUAL_STEPS: string[] = [
  'Deploy the matching DT extension on an ActiveGate or OneAgent-monitored host before applying.',
  'Credentials are never transferable — re-provision in the DT credentials vault and point credentialsRef at the new vault id.',
  'If the NR integration used custom CLI arguments beyond host/port/credentials, port them to the DT extension configuration file per the extension documentation.',
];

// ---------------------------------------------------------------------------
// OnHostIntegrationTransformer
// ---------------------------------------------------------------------------

export class OnHostIntegrationTransformer {
  transform(
    input: NROnHostIntegrationInput,
  ): TransformResult<OnHostIntegrationTransformData> {
    try {
      const cfg = INTEGRATION_MAP[input.kind];
      if (!cfg) {
        return failure([
          `Unknown on-host integration '${input.kind as string}'`,
        ]);
      }
      if (!input.endpoints?.length) {
        return failure(['At least one endpoint is required']);
      }
      const warnings: string[] = [];
      const name = input.name ?? `nr-${input.kind}`;

      const extension: DTOnHostExtensionConfig = {
        schemaId: cfg.schemaId,
        displayName: `[Migrated] ${name}`,
        intervalSeconds: input.intervalSeconds ?? 60,
        endpoints: input.endpoints.map((e, i) => {
          if (!e.host?.trim()) {
            warnings.push(`endpoint #${i} has no host — skipping would drop data; review manually.`);
          }
          return {
            host: e.host,
            port: e.port ?? cfg.defaultPort,
            credentialsRef: e.credentialsRef ?? 'CREDENTIALS_VAULT-<dt-ref>',
            attributes: { 'nr-migrated': 'true', ...(e.attributes ?? {}) },
          };
        }),
      };

      return success(
        { extension, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NROnHostIntegrationInput[],
  ): TransformResult<OnHostIntegrationTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
