import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { HttpTransport } from '../../src/clients/http-transport.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);

describe('HttpTransport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset `axios.create` mock to return an object with a `request` method.
    mockedAxios.create.mockReturnValue({
      request: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('composes auth headers from defaultAuthProvider', async () => {
    const t = new HttpTransport({
      defaultAuthProvider: () => ({ Authorization: 'Api-Token T' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;
    mockedRequest.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
    const res = await t.request({ method: 'GET', url: 'https://x/y' });
    expect(res.isSuccess).toBe(true);
    const config = mockedRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(config.headers['Authorization']).toBe('Api-Token T');
  });

  it('prefers request-supplied authProvider over default', async () => {
    const t = new HttpTransport({
      defaultAuthProvider: () => ({ Authorization: 'Default' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;
    mockedRequest.mockResolvedValue({ status: 200, data: {}, headers: {} });
    await t.request({
      method: 'GET',
      url: 'https://x',
      authProvider: () => ({ Authorization: 'Per-Req' }),
    });
    const config = mockedRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(config.headers['Authorization']).toBe('Per-Req');
  });

  it('returns HttpResponse.isSuccess=false on 4xx', async () => {
    const t = new HttpTransport({ retryPolicy: { total: 0, backoffFactor: 1 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;
    mockedRequest.mockResolvedValue({
      status: 403,
      data: { message: 'forbidden' },
      statusText: 'Forbidden',
      headers: {},
    });
    const res = await t.request({ method: 'GET', url: 'https://x' });
    expect(res.isSuccess).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toContain('forbidden');
  });

  it('retries on 429 then succeeds', async () => {
    const t = new HttpTransport({
      retryPolicy: { total: 3, backoffFactor: 1, maxDelayMs: 10 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;
    let count = 0;
    mockedRequest.mockImplementation(async () => {
      count++;
      if (count < 3) return { status: 429, data: {}, headers: {} };
      return { status: 200, data: { ok: true }, headers: {} };
    });
    const res = await t.request({ method: 'GET', url: 'https://x' });
    expect(res.isSuccess).toBe(true);
    expect(count).toBe(3);
  });

  it('respects baseUrl when url is relative', async () => {
    const t = new HttpTransport({ baseUrl: 'https://api.example.com' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;
    mockedRequest.mockResolvedValue({ status: 200, data: {}, headers: {} });
    await t.request({ method: 'GET', url: '/v1/things' });
    const config = mockedRequest.mock.calls[0]![0] as { url: string };
    expect(config.url).toBe('https://api.example.com/v1/things');
  });

  it('extracts error from various payload shapes', async () => {
    const t = new HttpTransport({ retryPolicy: { total: 0, backoffFactor: 1 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockedRequest = (t as any).http.request as ReturnType<typeof vi.fn>;

    mockedRequest.mockResolvedValueOnce({
      status: 400,
      data: { error: { message: 'bad format' } },
      statusText: 'Bad Request',
      headers: {},
    });
    const r1 = await t.request({ method: 'GET', url: 'https://x' });
    expect(r1.error).toBe('bad format');

    mockedRequest.mockResolvedValueOnce({
      status: 400,
      data: 'raw-string-error',
      statusText: 'Bad Request',
      headers: {},
    });
    const r2 = await t.request({ method: 'GET', url: 'https://x' });
    expect(r2.error).toBe('raw-string-error');
  });
});
