/**
 * Wire-level tests: capture what axios would actually send (adapter layer),
 * not what the client passes to a mocked transport.
 *
 * Mirrors Python `tests/unit/test_dynatrace_client.py` token-auth / Settings
 * base path tests, `TestDetectorActorWire` (D16) and
 * `TestDocumentDeleteLockingParamWire` / SLO locking-version tests (D22).
 */

import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentClient,
  DynatraceClient,
  HttpTransport,
  settingsV2Base,
  tokenAuthHeader,
} from '../../src/clients/index.js';
import { SLOAuditor } from '../../src/registry/slo-auditor.js';
import { AlertTransformer } from '../../src/transformers/index.js';
import type { DTAnomalyDetector } from '../../src/transformers/index.js';

interface Captured {
  method?: string;
  url?: string;
  params?: unknown;
  headers: Record<string, unknown>;
  body?: unknown;
}

let sent: Captured[] = [];
let responseData: unknown = {};
let originalAdapter: InternalAxiosRequestConfig['adapter'];

const captureAdapter: AxiosAdapter = async (config) => {
  sent.push({
    method: config.method?.toUpperCase(),
    url: config.url,
    params: config.params,
    headers: JSON.parse(JSON.stringify(config.headers ?? {})) as Record<string, unknown>,
    body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  });
  return { data: responseData, status: 200, statusText: 'OK', headers: {}, config };
};

beforeEach(() => {
  sent = [];
  responseData = {};
  originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = captureAdapter;
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
});

const ACTOR = '12345678-1234-1234-1234-123456789abc';

function detector(): DTAnomalyDetector {
  return new AlertTransformer().transform({
    name: 'p',
    conditions: [{ name: 'c', nrql: { query: 'SELECT count(*) FROM Transaction' } }],
  }).data!.anomalyDetectors[0]!;
}

describe('token auth scheme by prefix', () => {
  it.each([
    ['dt0c01.ABC', 'Api-Token dt0c01.ABC'],
    ['dt0s01.ABC', 'Bearer dt0s01.ABC'],
    ['dt0s16.ABC', 'Bearer dt0s16.ABC'],
  ])('%s -> %s', async (token, expected) => {
    expect(tokenAuthHeader(token)).toBe(expected);
    const client = new DynatraceClient({
      apiToken: token,
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      rateLimit: 0,
    });
    await client.getSettingsSchemas();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers['Authorization']).toBe(expected);
  });
});

describe('Settings 2.0 base path by tenant generation', () => {
  it('uses /platform/classic/environment-api/v2 on .apps. hosts', async () => {
    expect(settingsV2Base('https://abc12345.apps.dynatrace.com/')).toBe(
      'https://abc12345.apps.dynatrace.com/platform/classic/environment-api/v2',
    );
    const client = new DynatraceClient({
      apiToken: 'dt0s16.T',
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      rateLimit: 0,
    });
    await client.createSettingsObject('builtin:alerting.profile', { name: 'x' });
    expect(sent[0]!.method).toBe('POST');
    expect(sent[0]!.url).toBe(
      'https://abc12345.apps.dynatrace.com/platform/classic/environment-api/v2/settings/objects',
    );
  });

  it('keeps /api/v2 on .live. and Managed hosts', async () => {
    expect(settingsV2Base('https://abc12345.live.dynatrace.com')).toBe(
      'https://abc12345.live.dynatrace.com/api/v2',
    );
    expect(settingsV2Base('https://managed.example.com/e/env1')).toBe(
      'https://managed.example.com/e/env1/api/v2',
    );
    const client = new DynatraceClient({
      apiToken: 'dt0c01.T',
      environmentUrl: 'https://abc12345.live.dynatrace.com',
      rateLimit: 0,
    });
    await client.getSettingsSchemas();
    expect(sent[0]!.url).toBe('https://abc12345.live.dynatrace.com/api/v2/settings/schemas');
  });
});

describe('detector executionSettings.actor (D16)', () => {
  it('transformers emit no null executionSettings', () => {
    expect(detector().value.executionSettings).toEqual({});
  });

  it('injects the configured actor into the request body', async () => {
    responseData = [{ objectId: 'obj-1' }];
    const client = new DynatraceClient({
      apiToken: 'dt0s16.test',
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      rateLimit: 0,
      detectorActor: ACTOR,
    });
    const result = await client.createAnomalyDetector(detector());
    expect(result.success).toBe(true);
    expect(result.dynatraceId).toBe('obj-1');
    const body = sent[0]!.body as Array<Record<string, { executionSettings: unknown }>>;
    expect(body[0]!['value']!.executionSettings).toEqual({ actor: ACTOR });
    expect(body[0]!['schemaId']).toBe('builtin:davis.anomaly-detectors');
  });

  it('fails without an HTTP call when no actor is configured', async () => {
    const client = new DynatraceClient({
      apiToken: 'dt0s16.test',
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      rateLimit: 0,
    });
    const result = await client.createAnomalyDetector(detector());
    expect(sent).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('DYNATRACE_DETECTOR_ACTOR');
  });
});

describe('optimistic-locking-version query param (D22)', () => {
  it('Document API DELETE sends the kebab-case param', async () => {
    const transport = new HttpTransport({ rateLimitRps: Infinity });
    const client = new DocumentClient({
      transport,
      apiTokenAuth: () => ({ Authorization: tokenAuthHeader('dt0s16.test') }),
      oauthAuth: () => ({ Authorization: tokenAuthHeader('dt0s16.test') }),
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
    });
    await client.delete('doc-1', true, '3');
    expect(sent[0]!.method).toBe('DELETE');
    const uri = axios.getUri({ url: sent[0]!.url, params: sent[0]!.params });
    expect(uri.endsWith('/platform/document/v1/documents/doc-1?optimistic-locking-version=3')).toBe(
      true,
    );
  });

  it('SLOAuditor.updateSlo looks up and sends the locking version', async () => {
    const auditor = new SLOAuditor('https://abc12345.apps.dynatrace.com', 'dt0s16.oauth');
    const calls: Array<[string, string]> = [];
    vi.spyOn(auditor, 'platformRequest').mockImplementation(async (url, method = 'GET') => {
      calls.push([method, url]);
      return method === 'GET' ? { version: 'v9' } : {};
    });
    expect(await auditor.updateSlo('slo-1', { name: 'x' })).toBe(true);
    expect(calls.at(-1)).toEqual([
      'PUT',
      'https://abc12345.apps.dynatrace.com/platform/slo/v1/slos/slo-1?optimistic-locking-version=v9',
    ]);
  });
});
