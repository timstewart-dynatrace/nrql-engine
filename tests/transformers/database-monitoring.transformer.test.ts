import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseMonitoringTransformer } from '../../src/transformers/index.js';

describe('DatabaseMonitoringTransformer', () => {
  let transformer: DatabaseMonitoringTransformer;

  beforeEach(() => {
    transformer = new DatabaseMonitoringTransformer();
  });

  it('should fail without host', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({ engine: 'mysql', host: '' as any });
    expect(result.success).toBe(false);
  });

  it('should emit mysql extension with default port 3306', () => {
    const result = transformer.transform({ engine: 'mysql', host: 'db.local' });
    expect(result.success).toBe(true);
    expect(result.data!.extension.schemaId).toBe('com.dynatrace.extension.mysql');
    expect(result.data!.extension.endpoints[0]!.port).toBe(3306);
  });

  it('should emit postgres extension on port 5432', () => {
    const result = transformer.transform({ engine: 'postgres', host: 'pg.local' });
    expect(result.data!.extension.schemaId).toBe('com.dynatrace.extension.postgres');
    expect(result.data!.extension.endpoints[0]!.port).toBe(5432);
  });

  it('should cover all 10 supported engines', () => {
    const engines = [
      'mysql',
      'postgres',
      'mssql',
      'oracle',
      'mongodb',
      'redis',
      'cassandra',
      'mariadb',
      'db2',
      'hana',
    ] as const;
    for (const engine of engines) {
      const result = transformer.transform({ engine, host: 'x' });
      expect(result.success).toBe(true);
      expect(result.data!.extension.schemaId).toContain(engine);
    }
  });

  it('should emit a metric-key list per engine', () => {
    const result = transformer.transform({ engine: 'mysql', host: 'x' });
    expect(result.data!.metricKeys.length).toBeGreaterThan(0);
    expect(result.data!.metricKeys[0]!).toContain('dt.services.database.mysql');
  });

  it('should warn on missing credentialsRef', () => {
    const result = transformer.transform({ engine: 'mysql', host: 'x' });
    expect(result.warnings.some((w) => w.includes('credentialsRef'))).toBe(true);
  });

  it('should honor explicit port override + tags', () => {
    const result = transformer.transform({
      engine: 'mysql',
      host: 'db',
      port: 33061,
      credentialsRef: 'CRED-123',
      tags: { env: 'prod' },
    });
    const ep = result.data!.extension.endpoints[0]!;
    expect(ep.port).toBe(33061);
    expect(ep.credentialsRef).toBe('CRED-123');
    expect(ep.tags.env).toBe('prod');
    expect(ep.tags['nr-migrated']).toBe('true');
  });

  it('should respect slow-query defaults', () => {
    const result = transformer.transform({ engine: 'mysql', host: 'db' });
    const ep = result.data!.extension.endpoints[0]!;
    expect(ep.captureSlowQueries).toBe(true);
    expect(ep.topNSlowQueries).toBe(10);
    expect(ep.captureWaitEvents).toBe(false);
  });
});
