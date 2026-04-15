import { describe, it, expect } from 'vitest';
import {
  PROVENANCE_MARKER,
  PROVENANCE_PREFIX_REGEX,
  withProvenance,
  stampDescription,
  looksMigrated,
} from '../../src/utils/provenance.js';
import {
  AlertTransformer,
  BrowserRUMTransformer,
  CustomEntityTransformer,
  DatabaseMonitoringTransformer,
  DavisTuningTransformer,
  KeyTransactionTransformer,
  LambdaTransformer,
  MaintenanceWindowTransformer,
  TagTransformer,
  WorkloadTransformer,
} from '../../src/transformers/index.js';

describe('PROVENANCE_MARKER + withProvenance', () => {
  it('is `{ "migrated.from": "newrelic" }`', () => {
    expect(PROVENANCE_MARKER).toEqual({ 'migrated.from': 'newrelic' });
  });

  it('merges the marker into a base object', () => {
    const result = withProvenance({ foo: 'bar' });
    expect(result).toEqual({ foo: 'bar', 'migrated.from': 'newrelic' });
  });

  it('handles undefined input', () => {
    const result = withProvenance(undefined);
    expect(result).toEqual({ 'migrated.from': 'newrelic' });
  });
});

describe('PROVENANCE_PREFIX_REGEX', () => {
  it('matches any `[Migrated` prefix variant', () => {
    expect(PROVENANCE_PREFIX_REGEX.test('[Migrated] foo')).toBe(true);
    expect(PROVENANCE_PREFIX_REGEX.test('[Migrated Legacy] foo')).toBe(true);
    expect(PROVENANCE_PREFIX_REGEX.test('[Migrated AIOps] foo')).toBe(true);
    expect(PROVENANCE_PREFIX_REGEX.test('[Migrated SLv3] foo')).toBe(true);
    expect(PROVENANCE_PREFIX_REGEX.test('Ordinary name')).toBe(false);
  });
});

describe('stampDescription', () => {
  it('appends the migration tag when missing', () => {
    expect(stampDescription('A service')).toBe('A service · migrated from NR');
  });

  it('leaves description untouched when already stamped', () => {
    expect(stampDescription('Already migrated from New Relic')).toBe(
      'Already migrated from New Relic',
    );
  });

  it('handles empty / undefined input', () => {
    expect(stampDescription(undefined)).toBe('migrated from NR');
    expect(stampDescription('')).toBe('migrated from NR');
  });
});

describe('looksMigrated — core shapes', () => {
  it('returns true for `[Migrated]` name prefix', () => {
    expect(looksMigrated({ displayName: '[Migrated] Prod alerts' })).toBe(true);
    expect(looksMigrated({ name: '[Migrated Legacy] x' })).toBe(true);
  });

  it('returns true for properties.migrated.from=newrelic', () => {
    expect(
      looksMigrated({ properties: { 'migrated.from': 'newrelic' } }),
    ).toBe(true);
  });

  it('returns true for eventTemplate.properties.migrated.from=newrelic', () => {
    expect(
      looksMigrated({
        eventTemplate: { properties: { 'migrated.from': 'newrelic' } },
      }),
    ).toBe(true);
  });

  it('returns true for entityTags with nr-migrated key', () => {
    expect(looksMigrated({ entityTags: { 'nr-migrated': 'x' } })).toBe(true);
  });

  it('returns true for string "nr-migrated" tag', () => {
    expect(looksMigrated({ tags: ['prod', 'nr-migrated'] })).toBe(true);
  });

  it('returns true for object tag with nr-migrated key', () => {
    expect(looksMigrated({ tags: [{ key: 'nr-migrated', value: 'true' }] })).toBe(
      true,
    );
  });

  it('returns false for an organic DT entity', () => {
    expect(
      looksMigrated({ displayName: 'Prod alerts', properties: { env: 'prod' } }),
    ).toBe(false);
  });

  it('returns false for non-object inputs', () => {
    expect(looksMigrated(null)).toBe(false);
    expect(looksMigrated(42)).toBe(false);
    expect(looksMigrated('string')).toBe(false);
  });
});

describe('looksMigrated — detects real transformer outputs', () => {
  it('AlertTransformer Workflow + MetricEvent', () => {
    const result = new AlertTransformer().transform({
      name: 'Prod',
      conditions: [
        {
          name: 'Err',
          conditionType: 'NRQL',
          nrql: { query: 'SELECT count(*) FROM TransactionError' },
          terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 1 }],
        },
      ],
    });
    expect(looksMigrated(result.data!.workflow)).toBe(true);
    expect(looksMigrated(result.data!.metricEvents[0]!)).toBe(true);
  });

  it('BrowserRUMTransformer app detection', () => {
    const result = new BrowserRUMTransformer().transform({
      name: 'app',
      domain: 'acme.com',
    });
    expect(looksMigrated(result.data!.appDetection)).toBe(true);
  });

  it('CustomEntityTransformer payload', () => {
    const result = new CustomEntityTransformer().transform({
      name: 'Legacy mainframe',
      type: 'MAINFRAME',
    });
    expect(looksMigrated(result.data!.payload)).toBe(true);
  });

  it('DatabaseMonitoringTransformer extension', () => {
    const result = new DatabaseMonitoringTransformer().transform({
      engine: 'mysql',
      host: 'db.local',
    });
    expect(looksMigrated(result.data!.extension)).toBe(true);
  });

  it('DavisTuningTransformer setting', () => {
    const result = new DavisTuningTransformer().transform({
      rules: [
        {
          signal: 'cpu',
          sensitivity: 'MEDIUM',
          entityTags: { env: 'prod' },
        },
      ],
    });
    expect(looksMigrated(result.data!.settings[0]!)).toBe(true);
  });

  it('KeyTransactionTransformer SLO + Workflow', () => {
    const result = new KeyTransactionTransformer().transform({
      name: 'Checkout',
      applicationName: 'checkout',
    });
    expect(looksMigrated(result.data!.slo)).toBe(true);
    expect(looksMigrated(result.data!.workflow)).toBe(true);
  });

  it('LambdaTransformer function detection', () => {
    const result = new LambdaTransformer().transform({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:fn',
    });
    expect(looksMigrated(result.data!.functionDetection)).toBe(true);
  });

  it('MaintenanceWindowTransformer window', () => {
    const result = new MaintenanceWindowTransformer().transform({
      kind: 'SCHEDULED',
      name: 'Deploy',
    });
    expect(looksMigrated(result.data!.window)).toBe(true);
  });

  it('TagTransformer enrichment rule', () => {
    const result = new TagTransformer().transform({
      name: 'svc',
      type: 'APPLICATION',
      tags: [{ key: 'env', values: ['prod'] }],
    });
    expect(looksMigrated(result.data![0]!)).toBe(true);
  });

  it('WorkloadTransformer segment', () => {
    const result = new WorkloadTransformer().transform({
      name: 'ProdSvcs',
      collection: [{ name: 'x', type: 'APPLICATION' }],
    });
    expect(looksMigrated(result.data!)).toBe(true);
  });
});
