import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  OAuth2PlatformTokenProvider,
  oauthAuthProvider,
  apiTokenAuthProvider,
} from '../../src/clients/oauth2-platform-token.js';

vi.mock('axios');

describe('OAuth2PlatformTokenProvider', () => {
  const baseOptions = {
    tokenUrl: 'https://sso.dynatrace.com/sso/oauth2/token',
    clientId: 'id',
    clientSecret: 'secret',
    scope: 'storage:logs:read',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches and caches an access token', async () => {
    const mocked = vi.mocked(axios.post);
    mocked.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'tok-1', expires_in: 300 },
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    const t1 = await provider.getAccessToken();
    const t2 = await provider.getAccessToken();
    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after invalidation', async () => {
    const mocked = vi.mocked(axios.post);
    mocked.mockResolvedValue({
      status: 200,
      data: { access_token: 'tok-A', expires_in: 300 },
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    await provider.getAccessToken();
    mocked.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'tok-B', expires_in: 300 },
    });
    provider.invalidate();
    const t = await provider.getAccessToken();
    expect(t).toBe('tok-B');
  });

  it('getAuthHeaders returns Bearer header', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { access_token: 'tok', expires_in: 300 },
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    const headers = await provider.getAuthHeaders();
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('throws on 4xx from token endpoint', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 401,
      data: { error: 'invalid_client' },
      statusText: 'Unauthorized',
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    await expect(provider.getAccessToken()).rejects.toThrow();
  });

  it('throws when response has no access_token', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: {},
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    await expect(provider.getAccessToken()).rejects.toThrow('no access_token');
  });

  it('concurrent callers share a single refresh', async () => {
    let callCount = 0;
    vi.mocked(axios.post).mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return {
        status: 200,
        data: { access_token: 'tok', expires_in: 300 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    const [a, b, c] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);
    expect([a, b, c]).toEqual(['tok', 'tok', 'tok']);
    expect(callCount).toBe(1);
  });

  it('oauthAuthProvider helper wraps getAuthHeaders', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { access_token: 'tok', expires_in: 300 },
    });
    const provider = new OAuth2PlatformTokenProvider(baseOptions);
    const fn = oauthAuthProvider(provider);
    expect(await fn()).toEqual({ Authorization: 'Bearer tok' });
  });

  it('apiTokenAuthProvider returns Api-Token header', () => {
    const fn = apiTokenAuthProvider('dt0c01.FAKE');
    expect(fn()).toEqual({ Authorization: 'Api-Token dt0c01.FAKE' });
  });
});
