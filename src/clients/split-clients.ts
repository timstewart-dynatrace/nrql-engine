/**
 * Split DT clients — focused wrappers on top of `HttpTransport` (P15-06).
 *
 * Three subclients, one per DT API family:
 *   - `SettingsV2Client` — `/api/v2/settings/*` (Api-Token by default)
 *   - `DocumentClient` — `/platform/document/v1/*` (OAuth2 preferred)
 *   - `AutomationClient` — `/platform/automation/v1/*` (OAuth2 preferred)
 *
 * Each client carries a `preferOauth` option that decides which auth
 * provider to use for its requests, so a single `DynatraceClient`
 * composition can mix Api-Token and OAuth2 based on endpoint family.
 */

import type {
  AuthHeaderProvider,
  HttpResponse,
  HttpTransport,
} from './http-transport.js';

// ---------------------------------------------------------------------------
// Shared settings
// ---------------------------------------------------------------------------

export interface SplitClientOptions {
  readonly transport: HttpTransport;
  /** Auth provider used when `preferOauth` is false. */
  readonly apiTokenAuth: AuthHeaderProvider;
  /** Auth provider used when `preferOauth` is true. Required for Document / Automation. */
  readonly oauthAuth?: AuthHeaderProvider;
  /** Base environment URL (e.g. https://abc12345.live.dynatrace.com). */
  readonly environmentUrl: string;
}

function pickAuth(
  opts: SplitClientOptions,
  preferOauth: boolean,
): AuthHeaderProvider {
  if (preferOauth) {
    if (!opts.oauthAuth) {
      throw new Error(
        'OAuth2 auth provider required when preferOauth=true. Supply oauthAuth on the client options.',
      );
    }
    return opts.oauthAuth;
  }
  return opts.apiTokenAuth;
}

// ---------------------------------------------------------------------------
// SettingsV2Client
// ---------------------------------------------------------------------------

export class SettingsV2Client {
  constructor(private readonly options: SplitClientOptions) {}

  async listObjects(params: {
    schemaIds?: string;
    filter?: string;
    pageSize?: number;
    nextPageKey?: string;
    adminAccess?: boolean;
    preferOauth?: boolean;
  }): Promise<HttpResponse<{ items?: unknown[]; nextPageKey?: string; totalCount?: number }>> {
    const auth = pickAuth(this.options, params.preferOauth ?? false);
    return this.options.transport.request({
      method: 'GET',
      url: `${this.options.environmentUrl}/api/v2/settings/objects`,
      params: params.nextPageKey
        ? { nextPageKey: params.nextPageKey }
        : {
            schemaIds: params.schemaIds,
            filter: params.filter,
            pageSize: params.pageSize,
            adminAccess: params.adminAccess,
          },
      authProvider: auth,
    });
  }

  async createObject(
    body: Array<Record<string, unknown>>,
    preferOauth = false,
  ): Promise<HttpResponse> {
    const auth = pickAuth(this.options, preferOauth);
    return this.options.transport.request({
      method: 'POST',
      url: `${this.options.environmentUrl}/api/v2/settings/objects`,
      data: body,
      authProvider: auth,
    });
  }

  async updateObject(
    objectId: string,
    body: Record<string, unknown>,
    preferOauth = false,
  ): Promise<HttpResponse> {
    const auth = pickAuth(this.options, preferOauth);
    return this.options.transport.request({
      method: 'PUT',
      url: `${this.options.environmentUrl}/api/v2/settings/objects/${objectId}`,
      data: body,
      authProvider: auth,
    });
  }

  async listSchemas(preferOauth = false): Promise<HttpResponse<{ items?: unknown[] }>> {
    return this.options.transport.request({
      method: 'GET',
      url: `${this.options.environmentUrl}/api/v2/settings/schemas`,
      params: { pageSize: 1 },
      authProvider: pickAuth(this.options, preferOauth),
    });
  }
}

// ---------------------------------------------------------------------------
// DocumentClient
// ---------------------------------------------------------------------------

export class DocumentClient {
  constructor(private readonly options: SplitClientOptions) {}

  private platformUrl(): string {
    return this.options.environmentUrl.replace('.live.', '.apps.');
  }

  async list(params?: {
    pageSize?: number;
    pageKey?: string;
    filter?: string;
    preferOauth?: boolean;
  }): Promise<HttpResponse<{ documents?: unknown[]; nextPageKey?: string }>> {
    const auth = pickAuth(this.options, params?.preferOauth ?? true);
    return this.options.transport.request({
      method: 'GET',
      url: `${this.platformUrl()}/platform/document/v1/documents`,
      params: params?.pageKey
        ? { pageKey: params.pageKey }
        : { 'page-size': params?.pageSize ?? 1000, filter: params?.filter },
      authProvider: auth,
    });
  }

  async create(
    body: Record<string, unknown>,
    preferOauth = true,
  ): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'POST',
      url: `${this.platformUrl()}/platform/document/v1/documents`,
      data: body,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }

  async update(
    id: string,
    body: Record<string, unknown>,
    preferOauth = true,
  ): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'PATCH',
      url: `${this.platformUrl()}/platform/document/v1/documents/${id}`,
      data: body,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }

  async delete(id: string, preferOauth = true): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'DELETE',
      url: `${this.platformUrl()}/platform/document/v1/documents/${id}`,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }
}

// ---------------------------------------------------------------------------
// AutomationClient
// ---------------------------------------------------------------------------

export class AutomationClient {
  constructor(private readonly options: SplitClientOptions) {}

  private platformUrl(): string {
    return this.options.environmentUrl.replace('.live.', '.apps.');
  }

  async listWorkflows(params?: {
    pageSize?: number;
    pageKey?: string;
    preferOauth?: boolean;
  }): Promise<HttpResponse<{ workflows?: unknown[]; nextPageKey?: string }>> {
    return this.options.transport.request({
      method: 'GET',
      url: `${this.platformUrl()}/platform/automation/v1/workflows`,
      params: params?.pageKey
        ? { pageKey: params.pageKey }
        : { 'page-size': params?.pageSize ?? 100 },
      authProvider: pickAuth(this.options, params?.preferOauth ?? true),
    });
  }

  async createWorkflow(
    body: Record<string, unknown>,
    preferOauth = true,
  ): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'POST',
      url: `${this.platformUrl()}/platform/automation/v1/workflows`,
      data: body,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }

  async updateWorkflow(
    id: string,
    body: Record<string, unknown>,
    preferOauth = true,
  ): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'PUT',
      url: `${this.platformUrl()}/platform/automation/v1/workflows/${id}`,
      data: body,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }

  async deleteWorkflow(id: string, preferOauth = true): Promise<HttpResponse> {
    return this.options.transport.request({
      method: 'DELETE',
      url: `${this.platformUrl()}/platform/automation/v1/workflows/${id}`,
      authProvider: pickAuth(this.options, preferOauth),
    });
  }
}
