/**
 * Tests for validators/utils-validators.ts — config and structure validation.
 *
 * Ported from Python: tests/unit/test_utils_validators.py (35 tests)
 */

import { describe, expect, it } from 'vitest';

import {
  validateDashboard,
  validateDynatraceConfig,
  validateMetricEvent,
  validateNewRelicConfig,
  validateSyntheticMonitor,
} from '../../src/validators/utils-validators.js';

// ─── validateNewRelicConfig ─────────────────────────────────────────────────

describe('validateNewRelicConfig', () => {
  it('should pass valid config', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: '1234567',
      region: 'US',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should pass EU region', () => {
    const [valid] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: '1234567',
      region: 'EU',
    });
    expect(valid).toBe(true);
  });

  it('should fail when API key missing', () => {
    const [valid, errors] = validateNewRelicConfig({
      account_id: '1234567',
      region: 'US',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('API_KEY'))).toBe(true);
  });

  it('should fail when API key empty', () => {
    const [valid] = validateNewRelicConfig({
      api_key: '',
      account_id: '1234567',
    });
    expect(valid).toBe(false);
  });

  it('should fail when API key wrong prefix', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: 'WRONG-ABC123',
      account_id: '1234567',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('NRAK-'))).toBe(true);
  });

  it('should fail when account ID missing', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      region: 'US',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('ACCOUNT_ID'))).toBe(true);
  });

  it('should fail when account ID empty', () => {
    const [valid] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: '',
    });
    expect(valid).toBe(false);
  });

  it('should fail when account ID non-numeric', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: 'abc',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('numeric'))).toBe(true);
  });

  it('should fail when region invalid', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: '123',
      region: 'APAC',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('US') && e.includes('EU'))).toBe(true);
  });

  it('should default region to US', () => {
    const [valid] = validateNewRelicConfig({
      api_key: 'NRAK-ABC123',
      account_id: '123',
    });
    expect(valid).toBe(true);
  });

  it('should collect multiple errors', () => {
    const [valid, errors] = validateNewRelicConfig({
      api_key: '',
      account_id: 'abc',
      region: 'APAC',
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── validateDynatraceConfig ───────────────────────────────────────────────

describe('validateDynatraceConfig', () => {
  it('should pass valid config', () => {
    const [valid, errors] = validateDynatraceConfig({
      api_token: 'dt0c01.ABCDEF',
      environment_url: 'https://abc12345.live.dynatrace.com',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should pass apps domain', () => {
    const [valid] = validateDynatraceConfig({
      api_token: 'dt0c01.TOKEN',
      environment_url: 'https://abc12345.apps.dynatrace.com',
    });
    expect(valid).toBe(true);
  });

  it('should fail when API token missing', () => {
    const [valid, errors] = validateDynatraceConfig({
      environment_url: 'https://abc.live.dynatrace.com',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('API_TOKEN'))).toBe(true);
  });

  it('should fail when API token empty', () => {
    const [valid] = validateDynatraceConfig({
      api_token: '',
      environment_url: 'https://abc.live.dynatrace.com',
    });
    expect(valid).toBe(false);
  });

  it('should fail when API token wrong prefix', () => {
    const [valid, errors] = validateDynatraceConfig({
      api_token: 'wrong.prefix',
      environment_url: 'https://abc.live.dynatrace.com',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('dt0c01.'))).toBe(true);
  });

  it('should fail when environment URL missing', () => {
    const [valid, errors] = validateDynatraceConfig({
      api_token: 'dt0c01.TOKEN',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('ENVIRONMENT_URL'))).toBe(true);
  });

  it('should fail when environment URL empty', () => {
    const [valid] = validateDynatraceConfig({
      api_token: 'dt0c01.TOKEN',
      environment_url: '',
    });
    expect(valid).toBe(false);
  });

  it('should fail when environment URL wrong format', () => {
    const [valid] = validateDynatraceConfig({
      api_token: 'dt0c01.TOKEN',
      environment_url: 'http://abc.live.dynatrace.com',
    });
    expect(valid).toBe(false);
  });

  it('should fail when environment URL has wrong domain', () => {
    const [valid] = validateDynatraceConfig({
      api_token: 'dt0c01.TOKEN',
      environment_url: 'https://abc.example.com',
    });
    expect(valid).toBe(false);
  });
});

// ─── validateDashboard ──────────────────────────────────────────────────────

describe('validateDashboard', () => {
  it('should pass valid dashboard', () => {
    const [valid, errors] = validateDashboard({
      dashboardMetadata: { name: 'Test' },
      tiles: [],
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should fail missing metadata', () => {
    const [valid, errors] = validateDashboard({ tiles: [] });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('dashboardMetadata'))).toBe(true);
  });

  it('should fail missing name in metadata', () => {
    const [valid, errors] = validateDashboard({
      dashboardMetadata: {},
      tiles: [],
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should fail missing tiles', () => {
    const [valid, errors] = validateDashboard({
      dashboardMetadata: { name: 'Test' },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('tiles'))).toBe(true);
  });
});

// ─── validateMetricEvent ───────────────────────────────────────────────────

describe('validateMetricEvent', () => {
  it('should pass valid event', () => {
    const [valid] = validateMetricEvent({
      summary: 'Alert',
      monitoringStrategy: { type: 'STATIC' },
    });
    expect(valid).toBe(true);
  });

  it('should fail missing summary', () => {
    const [valid, errors] = validateMetricEvent({
      monitoringStrategy: { type: 'STATIC' },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('summary'))).toBe(true);
  });

  it('should fail missing monitoring strategy', () => {
    const [valid, errors] = validateMetricEvent({ summary: 'Alert' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('monitoringStrategy'))).toBe(true);
  });
});

// ─── validateSyntheticMonitor ──────────────────────────────────────────────

describe('validateSyntheticMonitor', () => {
  it('should pass valid HTTP monitor', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'HTTP',
      frequencyMin: 15,
      locations: ['LOC1'],
    });
    expect(valid).toBe(true);
  });

  it('should pass valid BROWSER monitor', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'BROWSER',
      frequencyMin: 15,
      locations: ['LOC1'],
    });
    expect(valid).toBe(true);
  });

  it('should fail missing name', () => {
    const [valid] = validateSyntheticMonitor({
      type: 'HTTP',
      frequencyMin: 15,
      locations: ['LOC1'],
    });
    expect(valid).toBe(false);
  });

  it('should fail missing type', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      frequencyMin: 15,
      locations: ['LOC1'],
    });
    expect(valid).toBe(false);
  });

  it('should fail invalid type', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'INVALID',
      frequencyMin: 15,
      locations: ['LOC1'],
    });
    expect(valid).toBe(false);
  });

  it('should fail missing frequency', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'HTTP',
      locations: ['LOC1'],
    });
    expect(valid).toBe(false);
  });

  it('should fail missing locations', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'HTTP',
      frequencyMin: 15,
    });
    expect(valid).toBe(false);
  });

  it('should fail empty locations', () => {
    const [valid] = validateSyntheticMonitor({
      name: 'Test',
      type: 'HTTP',
      frequencyMin: 15,
      locations: [],
    });
    expect(valid).toBe(false);
  });
});
