/**
 * Tests for config/settings -- config schemas, endpoints, components.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  getSettings,
  resetSettings,
  getGraphqlEndpoint,
  getRestApiBase,
  getApiV2Base,
  getConfigApiBase,
  getSettingsApi,
  AVAILABLE_COMPONENTS,
  COMPONENT_DEPENDENCIES,
  NewRelicConfigSchema,
  DynatraceConfigSchema,
  MigrationConfigSchema,
} from '../../src/config/index.js';
import type { NewRelicConfig, DynatraceConfig, MigrationConfig } from '../../src/config/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewRelicConfig', () => {
  it('should set US graphql endpoint', () => {
    const c = NewRelicConfigSchema.parse({
      apiKey: 'NRAK-TEST',
      accountId: '123',
      region: 'US',
    });
    expect(getGraphqlEndpoint(c)).toBe('https://api.newrelic.com/graphql');
  });

  it('should set EU graphql endpoint', () => {
    const c = NewRelicConfigSchema.parse({
      apiKey: 'NRAK-TEST',
      accountId: '123',
      region: 'EU',
    });
    expect(getGraphqlEndpoint(c)).toBe('https://api.eu.newrelic.com/graphql');
  });

  it('should set US rest API base', () => {
    const c = NewRelicConfigSchema.parse({
      apiKey: 'NRAK-TEST',
      accountId: '123',
    });
    expect(getRestApiBase(c)).toBe('https://api.newrelic.com/v2');
  });

  it('should set EU rest API base', () => {
    const c = NewRelicConfigSchema.parse({
      apiKey: 'NRAK-TEST',
      accountId: '123',
      region: 'EU',
    });
    expect(getRestApiBase(c)).toBe('https://api.eu.newrelic.com/v2');
  });

  it('should default region to US', () => {
    const c = NewRelicConfigSchema.parse({
      apiKey: 'NRAK-TEST',
      accountId: '123',
    });
    expect(c.region).toBe('US');
  });
});

describe('DynatraceConfig', () => {
  it('should set API v2 base', () => {
    const c = DynatraceConfigSchema.parse({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com',
    });
    expect(getApiV2Base(c)).toBe('https://abc.live.dynatrace.com/api/v2');
  });

  it('should set config API base', () => {
    const c = DynatraceConfigSchema.parse({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com',
    });
    expect(getConfigApiBase(c)).toBe('https://abc.live.dynatrace.com/api/config/v1');
  });

  it('should set settings API', () => {
    const c = DynatraceConfigSchema.parse({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com',
    });
    expect(getSettingsApi(c)).toBe('https://abc.live.dynatrace.com/api/v2/settings');
  });

  it('should strip trailing slash', () => {
    const c = DynatraceConfigSchema.parse({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com/',
    });
    expect(c.environmentUrl).toBe('https://abc.live.dynatrace.com');
  });
});

describe('MigrationConfig', () => {
  it('should have default components', () => {
    const c = MigrationConfigSchema.parse({});
    expect(c.components).toContain('dashboards');
    expect(c.components).toContain('alerts');
  });

  it('should default dry run to false', () => {
    const c = MigrationConfigSchema.parse({});
    expect(c.dryRun).toBe(false);
  });

  it('should default batch size to 50', () => {
    const c = MigrationConfigSchema.parse({});
    expect(c.batchSize).toBe(50);
  });

  it('should default rate limit', () => {
    const c = MigrationConfigSchema.parse({});
    expect(c.rateLimit).toBe(5.0);
  });

  it('should default continue on error', () => {
    const c = MigrationConfigSchema.parse({});
    expect(c.continueOnError).toBe(true);
  });
});

describe('Settings singleton', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetSettings();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetSettings();
    process.env = originalEnv;
  });

  it('should be singleton', () => {
    process.env['NEW_RELIC_API_KEY'] = 'NRAK-TEST';
    process.env['NEW_RELIC_ACCOUNT_ID'] = '123';
    process.env['DYNATRACE_API_TOKEN'] = 'dt0c01.TEST';
    process.env['DYNATRACE_ENVIRONMENT_URL'] = 'https://abc.live.dynatrace.com';

    const s1 = getSettings();
    const s2 = getSettings();
    expect(s1).toBe(s2);
  });

  it('should reset and clear instance', () => {
    process.env['NEW_RELIC_API_KEY'] = 'NRAK-TEST';
    process.env['NEW_RELIC_ACCOUNT_ID'] = '123';
    process.env['DYNATRACE_API_TOKEN'] = 'dt0c01.TEST';
    process.env['DYNATRACE_ENVIRONMENT_URL'] = 'https://abc.live.dynatrace.com';

    const s1 = getSettings();
    resetSettings();
    const s2 = getSettings();
    // After reset, a new instance is created
    expect(s1).not.toBe(s2);
  });
});

describe('getSettings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetSettings();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetSettings();
    process.env = originalEnv;
  });

  it('should return settings instance', () => {
    process.env['NEW_RELIC_API_KEY'] = 'NRAK-TEST';
    process.env['NEW_RELIC_ACCOUNT_ID'] = '123';
    process.env['DYNATRACE_API_TOKEN'] = 'dt0c01.TEST';
    process.env['DYNATRACE_ENVIRONMENT_URL'] = 'https://abc.live.dynatrace.com';

    const s = getSettings();
    expect(s.newrelic).toBeDefined();
    expect(s.dynatrace).toBeDefined();
    expect(s.migration).toBeDefined();
  });
});

describe('AVAILABLE_COMPONENTS', () => {
  it('should include core components', () => {
    expect(AVAILABLE_COMPONENTS).toContain('dashboards');
    expect(AVAILABLE_COMPONENTS).toContain('alerts');
    expect(AVAILABLE_COMPONENTS).toContain('synthetics');
    expect(AVAILABLE_COMPONENTS).toContain('slos');
    expect(AVAILABLE_COMPONENTS).toContain('workloads');
    expect(AVAILABLE_COMPONENTS).toContain('notification_channels');
  });

  it('should have dependencies', () => {
    expect(COMPONENT_DEPENDENCIES['alerts']).toContain('notification_channels');
    expect(COMPONENT_DEPENDENCIES['slos']).toContain('alerts');
  });
});
