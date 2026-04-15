/**
 * Database Monitoring Transformer — Converts NR Database Monitoring
 * (NRDM / query performance) config to Dynatrace DB extensions + a
 * compiler metric map for `dt.services.database.*`.
 *
 * Coverage:
 *   - MySQL, PostgreSQL, MSSQL, Oracle, MongoDB, Redis, Cassandra,
 *     MariaDB, DB2, SAP HANA — mapped to the matching DT extension id
 *   - Query-sample config (top-N slow queries, wait events)
 *   - Per-host `dt.services.database.*` metric selection
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRDbEngine =
  | 'mysql'
  | 'postgres'
  | 'mssql'
  | 'oracle'
  | 'mongodb'
  | 'redis'
  | 'cassandra'
  | 'mariadb'
  | 'db2'
  | 'hana';

export interface NRDatabaseMonitorInput {
  readonly name?: string;
  readonly engine: NRDbEngine;
  readonly host: string;
  readonly port?: number;
  /** Reference to NR-side credentials. Never transferable. */
  readonly credentialsRef?: string;
  readonly captureSlowQueries?: boolean;
  readonly topNSlowQueries?: number;
  readonly captureWaitEvents?: boolean;
  readonly tags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTDbExtensionConfig {
  readonly schemaId: string;
  readonly displayName: string;
  readonly endpoints: Array<{
    readonly host: string;
    readonly port: number;
    readonly credentialsRef: string;
    readonly captureSlowQueries: boolean;
    readonly topNSlowQueries: number;
    readonly captureWaitEvents: boolean;
    readonly tags: Record<string, string>;
  }>;
}

export interface DatabaseMonitoringTransformData {
  readonly extension: DTDbExtensionConfig;
  readonly metricKeys: string[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Engine → extension schema + default port
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<
  NRDbEngine,
  { schemaId: string; defaultPort: number; metricPrefix: string }
> = {
  mysql: {
    schemaId: 'com.dynatrace.extension.mysql',
    defaultPort: 3306,
    metricPrefix: 'dt.services.database.mysql',
  },
  postgres: {
    schemaId: 'com.dynatrace.extension.postgres',
    defaultPort: 5432,
    metricPrefix: 'dt.services.database.postgres',
  },
  mssql: {
    schemaId: 'com.dynatrace.extension.mssql',
    defaultPort: 1433,
    metricPrefix: 'dt.services.database.mssql',
  },
  oracle: {
    schemaId: 'com.dynatrace.extension.oracle',
    defaultPort: 1521,
    metricPrefix: 'dt.services.database.oracle',
  },
  mongodb: {
    schemaId: 'com.dynatrace.extension.mongodb',
    defaultPort: 27017,
    metricPrefix: 'dt.services.database.mongodb',
  },
  redis: {
    schemaId: 'com.dynatrace.extension.redis',
    defaultPort: 6379,
    metricPrefix: 'dt.services.database.redis',
  },
  cassandra: {
    schemaId: 'com.dynatrace.extension.cassandra',
    defaultPort: 9042,
    metricPrefix: 'dt.services.database.cassandra',
  },
  mariadb: {
    schemaId: 'com.dynatrace.extension.mariadb',
    defaultPort: 3306,
    metricPrefix: 'dt.services.database.mariadb',
  },
  db2: {
    schemaId: 'com.dynatrace.extension.db2',
    defaultPort: 50000,
    metricPrefix: 'dt.services.database.db2',
  },
  hana: {
    schemaId: 'com.dynatrace.extension.hana',
    defaultPort: 30015,
    metricPrefix: 'dt.services.database.hana',
  },
};

const MANUAL_STEPS: string[] = [
  'Deploy an ActiveGate with the matching DB extension enabled before applying this config.',
  'DB credentials are never transferable — re-provision in the DT credentials vault and point credentialsRef at the new vault id.',
  'If NRDM captured query samples tagged with PII, configure an OpenPipeline masking stage against the captured query text before promoting to production.',
];

// ---------------------------------------------------------------------------
// DatabaseMonitoringTransformer
// ---------------------------------------------------------------------------

export class DatabaseMonitoringTransformer {
  transform(
    input: NRDatabaseMonitorInput,
  ): TransformResult<DatabaseMonitoringTransformData> {
    try {
      const cfg = EXTENSION_MAP[input.engine];
      if (!cfg) {
        return failure([`Unknown database engine '${input.engine as string}'`]);
      }
      if (!input.host?.trim()) {
        return failure(['host is required']);
      }
      const warnings: string[] = [];
      const name = input.name ?? `nr-${input.engine}-${input.host}`;

      const extension: DTDbExtensionConfig = {
        schemaId: cfg.schemaId,
        displayName: `[Migrated] ${name}`,
        endpoints: [
          {
            host: input.host,
            port: input.port ?? cfg.defaultPort,
            credentialsRef: input.credentialsRef ?? 'CREDENTIALS_VAULT-<dt-ref>',
            captureSlowQueries: input.captureSlowQueries ?? true,
            topNSlowQueries: input.topNSlowQueries ?? 10,
            captureWaitEvents: input.captureWaitEvents ?? false,
            tags: { 'nr-migrated': 'true', ...(input.tags ?? {}) },
          },
        ],
      };

      if (!input.credentialsRef) {
        warnings.push(
          `No credentialsRef supplied for ${input.engine} ${input.host} — re-provision the DT vault entry before applying.`,
        );
      }

      // Seed the compiler metric map with a representative subset so
      // consumer NRQL queries compile against the right DT metric names.
      const metricKeys = [
        `${cfg.metricPrefix}.connections.active`,
        `${cfg.metricPrefix}.queries.duration.avg`,
        `${cfg.metricPrefix}.queries.slowcount`,
        `${cfg.metricPrefix}.locks.waits`,
        `${cfg.metricPrefix}.cache.hitratio`,
      ];

      return success(
        { extension, metricKeys, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRDatabaseMonitorInput[],
  ): TransformResult<DatabaseMonitoringTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
