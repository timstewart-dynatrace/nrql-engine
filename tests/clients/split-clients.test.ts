import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SettingsV2Client,
  DocumentClient,
  AutomationClient,
  type SplitClientOptions,
} from '../../src/clients/split-clients.js';
import type { HttpTransport } from '../../src/clients/http-transport.js';

function makeOptions(opts?: { oauth?: boolean }): SplitClientOptions {
  const transport = { request: vi.fn() } as unknown as HttpTransport;
  return {
    transport,
    apiTokenAuth: () => ({ Authorization: 'Api-Token T' }),
    oauthAuth: opts?.oauth ? () => ({ Authorization: 'Bearer B' }) : undefined,
    environmentUrl: 'https://abc12345.live.dynatrace.com',
  };
}

describe('SettingsV2Client', () => {
  it('lists settings objects with api-token auth by default', async () => {
    const options = makeOptions();
    const client = new SettingsV2Client(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { items: [] },
      headers: {},
      isSuccess: true,
    });
    await client.listObjects({ schemaIds: 'builtin:management-zones', pageSize: 5 });
    const call = requestMock.mock.calls[0]![0];
    expect(call.url).toContain('/api/v2/settings/objects');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (call.authProvider as any)()).toEqual({ Authorization: 'Api-Token T' });
  });

  it('routes via OAuth when preferOauth=true', async () => {
    const options = makeOptions({ oauth: true });
    const client = new SettingsV2Client(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { items: [] },
      headers: {},
      isSuccess: true,
    });
    await client.listObjects({ preferOauth: true });
    const call = requestMock.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (call.authProvider as any)()).toEqual({ Authorization: 'Bearer B' });
  });

  it('throws when preferOauth=true but oauthAuth missing', async () => {
    const options = makeOptions();
    const client = new SettingsV2Client(options);
    await expect(client.listObjects({ preferOauth: true })).rejects.toThrow(
      'OAuth2 auth provider required',
    );
  });

  it('paginates via nextPageKey when supplied', async () => {
    const options = makeOptions();
    const client = new SettingsV2Client(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.listObjects({ nextPageKey: 'page-2' });
    const call = requestMock.mock.calls[0]![0];
    expect(call.params).toEqual({ nextPageKey: 'page-2' });
  });

  it('createObject POSTs to /settings/objects', async () => {
    const options = makeOptions();
    const client = new SettingsV2Client(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.createObject([{ schemaId: 'x', value: {} }]);
    const call = requestMock.mock.calls[0]![0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v2/settings/objects');
  });
});

describe('DocumentClient', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rewrites .live. to .apps. for platform URL', async () => {
    const options = makeOptions({ oauth: true });
    const client = new DocumentClient(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.list();
    const call = requestMock.mock.calls[0]![0];
    expect(call.url).toContain('.apps.dynatrace.com');
    expect(call.url).toContain('/platform/document/v1/documents');
  });

  it('paginates via pageKey (not nextPageKey)', async () => {
    const options = makeOptions({ oauth: true });
    const client = new DocumentClient(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.list({ pageKey: 'xyz' });
    const call = requestMock.mock.calls[0]![0];
    expect(call.params).toEqual({ pageKey: 'xyz' });
  });

  it('create / update / delete go through OAuth auth by default', async () => {
    const options = makeOptions({ oauth: true });
    const client = new DocumentClient(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.create({ name: 'd1' });
    await client.update('doc-1', { name: 'd2' });
    await client.delete('doc-1');
    for (const call of requestMock.mock.calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authHeader = await (call[0].authProvider as any)();
      expect(authHeader['Authorization']).toBe('Bearer B');
    }
  });
});

describe('AutomationClient', () => {
  it('lists workflows via platform URL with OAuth by default', async () => {
    const options = makeOptions({ oauth: true });
    const client = new AutomationClient(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.listWorkflows();
    const call = requestMock.mock.calls[0]![0];
    expect(call.url).toContain('/platform/automation/v1/workflows');
  });

  it('create / update / delete all use OAuth', async () => {
    const options = makeOptions({ oauth: true });
    const client = new AutomationClient(options);
    const requestMock = vi.mocked(options.transport.request);
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: {},
      headers: {},
      isSuccess: true,
    });
    await client.createWorkflow({ title: 'wf' });
    await client.updateWorkflow('w1', { title: 'wf2' });
    await client.deleteWorkflow('w1');
    for (const call of requestMock.mock.calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authHeader = await (call[0].authProvider as any)();
      expect(authHeader['Authorization']).toBe('Bearer B');
    }
  });
});
