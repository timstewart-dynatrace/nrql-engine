import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynatraceClient } from '../../src/clients/dynatrace-client.js';
import { NewRelicClient } from '../../src/clients/newrelic-client.js';

// ─── DynatraceClient.preflightGen3 ──────────────────────────────────────────

describe('DynatraceClient.preflightGen3', () => {
  let client: DynatraceClient;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.fake',
      environmentUrl: 'https://abc12345.live.dynatrace.com',
    });
  });

  it('should return all-true when every probe succeeds', async () => {
    vi.spyOn(
      client as unknown as { get: (...args: unknown[]) => unknown },
      'get',
    ).mockResolvedValue({
      data: { items: [] },
      statusCode: 200,
      isSuccess: true,
    });

    const r = await client.preflightGen3();
    expect(r.settingsV2).toBe(true);
    expect(r.documentApi).toBe(true);
    expect(r.automationApi).toBe(true);
    expect(r.slov2).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it('should surface failed probes via diagnostics', async () => {
    const mock = vi.spyOn(
      client as unknown as { get: (...args: unknown[]) => unknown },
      'get',
    );
    // settings v2 fails; others succeed
    mock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/v2/settings/objects')) {
        return {
          data: { message: 'forbidden' },
          statusCode: 403,
          error: 'forbidden',
          isSuccess: false,
        };
      }
      return { data: {}, statusCode: 200, isSuccess: true };
    });

    const r = await client.preflightGen3();
    expect(r.settingsV2).toBe(false);
    expect(r.documentApi).toBe(true);
    expect(r.diagnostics[0]).toContain('settings v2');
  });

  it('should rewrite .live. to .apps. for platform API probes', async () => {
    const calls: string[] = [];
    vi.spyOn(
      client as unknown as { get: (...args: unknown[]) => unknown },
      'get',
    ).mockImplementation(async (url: unknown) => {
      calls.push(String(url));
      return { data: {}, statusCode: 200, isSuccess: true };
    });
    await client.preflightGen3();
    expect(calls.some((u) => u.includes('.apps.'))).toBe(true);
    expect(calls.some((u) => u.includes('/platform/document/v1'))).toBe(true);
    expect(calls.some((u) => u.includes('/platform/automation/v1'))).toBe(true);
  });
});

// ─── NewRelicClient.preflightNewRelic ───────────────────────────────────────

describe('NewRelicClient.preflightNewRelic', () => {
  let client: NewRelicClient;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-fake',
      accountId: 1234567,
      region: 'US',
    });
  });

  it('should return success + user email + entity count', async () => {
    const mock = vi.spyOn(
      client as unknown as { executeQuery: (...args: unknown[]) => unknown },
      'executeQuery',
    );
    mock.mockImplementation(async (q: unknown) => {
      if (String(q).includes('user { email }')) {
        return {
          data: { actor: { user: { email: 'alice@example.com' } } },
          isSuccess: true,
        };
      }
      return {
        data: { actor: { entitySearch: { count: 42 } } },
        isSuccess: true,
      };
    });

    const r = await client.preflightNewRelic();
    expect(r.apiKeyValid).toBe(true);
    expect(r.userEmail).toBe('alice@example.com');
    expect(r.accountReachable).toBe(true);
    expect(r.entityCount).toBe(42);
    expect(r.diagnostics).toEqual([]);
  });

  it('should surface api-key failure', async () => {
    vi.spyOn(
      client as unknown as { executeQuery: (...args: unknown[]) => unknown },
      'executeQuery',
    ).mockResolvedValue({
      data: undefined,
      errors: [{ message: 'Invalid API key' }],
      isSuccess: false,
    });

    const r = await client.preflightNewRelic();
    expect(r.apiKeyValid).toBe(false);
    expect(r.diagnostics.some((d) => d.includes('api key'))).toBe(true);
  });

  it('should surface account-unreachable failure while preserving api-key status', async () => {
    vi.spyOn(
      client as unknown as { executeQuery: (...args: unknown[]) => unknown },
      'executeQuery',
    ).mockImplementation(async (q: unknown) => {
      if (String(q).includes('user { email }')) {
        return {
          data: { actor: { user: { email: 'alice@example.com' } } },
          isSuccess: true,
        };
      }
      return {
        data: undefined,
        errors: [{ message: 'account not found' }],
        isSuccess: false,
      };
    });

    const r = await client.preflightNewRelic();
    expect(r.apiKeyValid).toBe(true);
    expect(r.accountReachable).toBe(false);
    expect(r.diagnostics.some((d) => d.includes('account'))).toBe(true);
  });

  it('should return undefined entityCount when the nested path is missing', async () => {
    vi.spyOn(
      client as unknown as { executeQuery: (...args: unknown[]) => unknown },
      'executeQuery',
    ).mockResolvedValue({ data: { actor: {} }, isSuccess: true });

    const r = await client.preflightNewRelic();
    expect(r.entityCount).toBeUndefined();
    expect(r.userEmail).toBeUndefined();
  });
});
