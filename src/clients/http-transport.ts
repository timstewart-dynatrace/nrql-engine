/**
 * Shared HTTP transport for DT + NR clients (P15-06).
 *
 * Centralises: auth-header injection, rate limiting, automatic retry
 * on 429 / 5xx (via `withRetry` from P15-07), JSON envelope parsing.
 * The clients layered on top (`SettingsV2Client`, `DocumentClient`,
 * `AutomationClient`, plus the existing `NewRelicClient`) are now
 * thin wrappers that declare their auth strategy and call into
 * `HttpTransport.request()`.
 *
 * Back-port of the Python `clients/_http.py` with TypeScript idioms
 * and an axios backbone.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import pino from 'pino';

import { withRetry, type RetryPolicy } from '../utils/http-retry.js';

const logger = pino({ name: 'http-transport' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthHeaderProvider = () => Promise<Record<string, string>> | Record<string, string>;

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly params?: Record<string, unknown>;
  readonly data?: unknown;
  readonly headers?: Record<string, string>;
  readonly authProvider?: AuthHeaderProvider;
}

export interface HttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly data: T | undefined;
  readonly headers: Record<string, string | undefined>;
  readonly isSuccess: boolean;
  readonly error?: string;
}

export interface HttpTransportOptions {
  readonly timeoutMs?: number;
  /** Requests per second ceiling. Defaults to 5 rps. Set to `Infinity` to disable. */
  readonly rateLimitRps?: number;
  readonly retryPolicy?: RetryPolicy;
  /** Default auth provider used when a request omits its own. */
  readonly defaultAuthProvider?: AuthHeaderProvider;
  /** Base URL prepended to every relative request URL. */
  readonly baseUrl?: string;
}

// ---------------------------------------------------------------------------
// HttpTransport
// ---------------------------------------------------------------------------

export class HttpTransport {
  private readonly http: AxiosInstance;
  private readonly rateLimitRps: number;
  private readonly retryPolicy: RetryPolicy | undefined;
  private readonly defaultAuthProvider: AuthHeaderProvider | undefined;
  private readonly baseUrl: string;
  private lastRequestAt = 0;

  constructor(options?: HttpTransportOptions) {
    this.http = axios.create({
      timeout: options?.timeoutMs ?? 60_000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.rateLimitRps = options?.rateLimitRps ?? 5;
    this.retryPolicy = options?.retryPolicy;
    this.defaultAuthProvider = options?.defaultAuthProvider;
    this.baseUrl = (options?.baseUrl ?? '').replace(/\/+$/, '');
  }

  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const resolvedUrl = /^https?:/.test(req.url)
      ? req.url
      : `${this.baseUrl}${req.url.startsWith('/') ? '' : '/'}${req.url}`;

    const authProvider = req.authProvider ?? this.defaultAuthProvider;
    const authHeaders = authProvider ? await authProvider() : {};

    const config: AxiosRequestConfig = {
      method: req.method,
      url: resolvedUrl,
      params: req.params,
      data: req.data,
      headers: { ...(req.headers ?? {}), ...authHeaders },
      validateStatus: () => true,
    };

    const execute = async (): Promise<HttpResponse<T>> => {
      await this.rateLimitWait();
      try {
        const response = await this.http.request<T>(config);
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(response.headers ?? {})) {
          headers[k.toLowerCase()] = typeof v === 'string' ? v : undefined;
        }
        const isSuccess = response.status < 400;
        return {
          statusCode: response.status,
          data: response.data,
          headers,
          isSuccess,
          ...(isSuccess ? {} : { error: this.extractError(response.data, response.statusText) }),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ url: resolvedUrl, message }, 'http_transport_error');
        return {
          statusCode: 0,
          data: undefined,
          headers: {},
          isSuccess: false,
          error: `Network error: ${message}`,
        };
      }
    };

    // Retry wrapper — only retries when the response carries a
    // retryable status. Network errors (statusCode: 0) are NOT retried
    // because we don't know whether the request reached the server.
    return withRetry<HttpResponse<T>>(async () => execute(), this.retryPolicy);
  }

  private async rateLimitWait(): Promise<void> {
    if (!Number.isFinite(this.rateLimitRps) || this.rateLimitRps <= 0) return;
    const minInterval = 1000 / this.rateLimitRps;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < minInterval) {
      await new Promise((r) => setTimeout(r, minInterval - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private extractError(data: unknown, statusText: string): string {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj['error'] === 'string') return obj['error'];
      if (obj['error'] && typeof obj['error'] === 'object') {
        const inner = obj['error'] as Record<string, unknown>;
        if (typeof inner['message'] === 'string') return inner['message'];
      }
      if (typeof obj['message'] === 'string') return obj['message'];
    }
    return statusText || 'Unknown error';
  }
}
