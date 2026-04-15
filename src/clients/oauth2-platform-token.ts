/**
 * OAuth2 platform-token provider (P15-06).
 *
 * Back-port of the Python `OAuth2PlatformTokenProvider`
 * (`clients/_http.py`). Handles the client-credentials exchange
 * against the Dynatrace SSO token endpoint, caches the access token
 * with a 60-second refresh margin, and serializes concurrent
 * callers via a single in-flight promise (mutex equivalent).
 *
 * Usable as an `AuthHeaderProvider` for `HttpTransport` directly,
 * or composed into the `DynatraceClient`'s `preferOauth` routing.
 */

import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'oauth2-platform-token' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuth2PlatformTokenOptions {
  readonly tokenUrl: string; // e.g. https://sso.dynatrace.com/sso/oauth2/token
  readonly clientId: string;
  readonly clientSecret: string;
  /** Space-separated scope list, e.g. `"storage:buckets:read storage:logs:read"`. */
  readonly scope: string;
  /** DT account URN this token is authorised for, e.g. `urn:dtaccount:abc123`. */
  readonly accountUrn?: string;
  /** Seconds-before-expiry we refresh at. Default 60. */
  readonly refreshMarginSeconds?: number;
  /** Network timeout in ms. Default 10000. */
  readonly timeoutMs?: number;
}

interface TokenRecord {
  readonly accessToken: string;
  readonly expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// OAuth2PlatformTokenProvider
// ---------------------------------------------------------------------------

export class OAuth2PlatformTokenProvider {
  private readonly options: OAuth2PlatformTokenOptions;
  private cached: TokenRecord | undefined;
  private inFlight: Promise<TokenRecord> | undefined;

  constructor(options: OAuth2PlatformTokenOptions) {
    this.options = {
      refreshMarginSeconds: 60,
      timeoutMs: 10_000,
      ...options,
    };
  }

  /**
   * `AuthHeaderProvider` shape — returns `{ Authorization: "Bearer ..." }`.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Return a usable access token, refreshing if within the margin.
   * Concurrent callers share the same refresh promise.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.cached &&
      this.cached.expiresAt - now > (this.options.refreshMarginSeconds ?? 60) * 1000
    ) {
      return this.cached.accessToken;
    }
    if (this.inFlight) {
      const record = await this.inFlight;
      return record.accessToken;
    }
    this.inFlight = this.refresh();
    try {
      const record = await this.inFlight;
      this.cached = record;
      return record.accessToken;
    } finally {
      this.inFlight = undefined;
    }
  }

  /** Force a refresh on next access. */
  invalidate(): void {
    this.cached = undefined;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async refresh(): Promise<TokenRecord> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', this.options.clientId);
    body.set('client_secret', this.options.clientSecret);
    body.set('scope', this.options.scope);
    if (this.options.accountUrn) {
      body.set('resource', this.options.accountUrn);
    }

    logger.debug({ tokenUrl: this.options.tokenUrl }, 'oauth2_refresh_start');
    const response = await axios.post<{ access_token: string; expires_in: number }>(
      this.options.tokenUrl,
      body.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: this.options.timeoutMs,
        validateStatus: () => true,
      },
    );
    if (response.status >= 400) {
      const msg = typeof response.data === 'object' && response.data
        ? JSON.stringify(response.data)
        : response.statusText;
      throw new Error(`OAuth2 token exchange failed (status ${response.status}): ${msg}`);
    }
    const data = response.data;
    if (!data?.access_token) {
      throw new Error('OAuth2 token exchange returned no access_token');
    }
    const expiresIn = data.expires_in ?? 300;
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }
}

/**
 * Convenience: build an `AuthHeaderProvider` function bound to a
 * provider instance. Useful when composing `HttpTransport`.
 */
export function oauthAuthProvider(
  provider: OAuth2PlatformTokenProvider,
): () => Promise<Record<string, string>> {
  return () => provider.getAuthHeaders();
}

/**
 * Convenience: an Api-Token auth provider with the classic DT header.
 */
export function apiTokenAuthProvider(token: string): () => Record<string, string> {
  return () => ({ Authorization: `Api-Token ${token}` });
}
