/**
 * Dynatrace API Client.
 *
 * Provides methods to import configuration entities to Dynatrace
 * using the Settings API v2 and Configuration API.
 */

import axios, { type AxiosInstance } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'dynatrace-client' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DynatraceResponse {
  readonly data: unknown;
  readonly statusCode: number;
  readonly error?: string;
  readonly isSuccess: boolean;
}

export interface ImportResult {
  readonly entityType: string;
  readonly entityName: string;
  readonly success: boolean;
  readonly dynatraceId?: string;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map notification integration types to Dynatrace Settings 2.0 schema IDs. */
export const NOTIFICATION_INTEGRATION_SCHEMA: Readonly<Record<string, string>> = {
  email: 'builtin:problem.notifications.email',
  slack: 'builtin:problem.notifications.slack',
  pagerduty: 'builtin:problem.notifications.pager-duty',
  webhook: 'builtin:problem.notifications.webhook',
  jira: 'builtin:problem.notifications.jira',
  servicenow: 'builtin:problem.notifications.service-now',
  opsgenie: 'builtin:problem.notifications.ops-genie',
  victorops: 'builtin:problem.notifications.victor-ops',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DynatraceClient {
  private readonly apiToken: string;
  private readonly environmentUrl: string;
  private readonly rateLimit: number;
  private lastRequestTime = 0;
  private readonly apiV2: string;
  private readonly configApi: string;
  private readonly http: AxiosInstance;

  constructor(options: {
    apiToken: string;
    environmentUrl: string;
    rateLimit?: number;
  }) {
    this.apiToken = options.apiToken;
    this.environmentUrl = options.environmentUrl.replace(/\/+$/, '');
    this.rateLimit = options.rateLimit ?? 5.0;

    this.apiV2 = `${this.environmentUrl}/api/v2`;
    this.configApi = `${this.environmentUrl}/api/config/v1`;

    this.http = axios.create({
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Token ${this.apiToken}`,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  private async rateLimitWait(): Promise<void> {
    if (this.rateLimit > 0) {
      const elapsed = Date.now() - this.lastRequestTime;
      const minInterval = 1000 / this.rateLimit;
      if (elapsed < minInterval) {
        await sleep(minInterval - elapsed);
      }
    }
    this.lastRequestTime = Date.now();
  }

  // -------------------------------------------------------------------------
  // Core HTTP methods
  // -------------------------------------------------------------------------

  private async request(
    method: string,
    url: string,
    data?: unknown,
    params?: Record<string, unknown>,
  ): Promise<DynatraceResponse> {
    await this.rateLimitWait();

    try {
      const response = await this.http.request({
        method,
        url,
        data: data ?? undefined,
        params: params ?? undefined,
        // Prevent axios from throwing on 4xx/5xx so we handle it ourselves
        validateStatus: () => true,
      });

      let responseData: unknown;
      if (response.data !== undefined && response.data !== '') {
        responseData = response.data;
      }

      if (response.status >= 400) {
        const errorMsg =
          responseData !== undefined ? String(responseData) : response.statusText;
        return {
          data: responseData,
          statusCode: response.status,
          error: errorMsg,
          isSuccess: false,
        };
      }

      return {
        data: responseData,
        statusCode: response.status,
        isSuccess: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Dynatrace API error');
      return {
        data: undefined,
        statusCode: 0,
        error: message,
        isSuccess: false,
      };
    }
  }

  async get(
    url: string,
    params?: Record<string, unknown>,
  ): Promise<DynatraceResponse> {
    return this.request('GET', url, undefined, params);
  }

  async post(url: string, data: unknown): Promise<DynatraceResponse> {
    return this.request('POST', url, data);
  }

  async put(url: string, data: unknown): Promise<DynatraceResponse> {
    return this.request('PUT', url, data);
  }

  async delete(url: string): Promise<DynatraceResponse> {
    return this.request('DELETE', url);
  }

  // =========================================================================
  // Settings API v2 Methods
  // =========================================================================

  async getSettingsSchemas(): Promise<Record<string, unknown>[]> {
    const url = `${this.apiV2}/settings/schemas`;
    const response = await this.get(url);

    if (response.isSuccess && response.data && typeof response.data === 'object') {
      return ((response.data as Record<string, unknown>)['items'] ??
        []) as Record<string, unknown>[];
    }
    return [];
  }

  async getSettingsObjects(
    schemaId: string,
    scope?: string,
  ): Promise<Record<string, unknown>[]> {
    const url = `${this.apiV2}/settings/objects`;
    const params: Record<string, unknown> = { schemaIds: schemaId };
    if (scope) {
      params['scopes'] = scope;
    }

    const allObjects: Record<string, unknown>[] = [];
    let nextPageKey: string | undefined;

    while (true) {
      if (nextPageKey) {
        params['nextPageKey'] = nextPageKey;
      }

      const response = await this.get(url, params);

      if (!response.isSuccess) {
        break;
      }

      const data = response.data as Record<string, unknown> | undefined;
      const items = (data?.['items'] ?? []) as Record<string, unknown>[];
      allObjects.push(...items);

      const key = data?.['nextPageKey'];
      if (typeof key === 'string' && key.length > 0) {
        nextPageKey = key;
      } else {
        break;
      }
    }

    return allObjects;
  }

  async createSettingsObject(
    schemaId: string,
    value: Record<string, unknown>,
    scope = 'environment',
  ): Promise<DynatraceResponse> {
    const url = `${this.apiV2}/settings/objects`;
    const payload = [
      {
        schemaId,
        scope,
        value,
      },
    ];

    return this.post(url, payload);
  }

  async updateSettingsObject(
    objectId: string,
    value: Record<string, unknown>,
  ): Promise<DynatraceResponse> {
    const url = `${this.apiV2}/settings/objects/${objectId}`;
    return this.put(url, { value });
  }

  // =========================================================================
  // Dashboard Methods
  // =========================================================================

  async createDashboard(dashboard: Record<string, unknown>): Promise<ImportResult> {
    const metadata = (dashboard['dashboardMetadata'] ?? {}) as Record<string, unknown>;
    const name = (metadata['name'] ?? 'Unknown') as string;

    // Try Documents API first (newer, supports Grail dashboards)
    const v2Result = await this.createDashboardV2(dashboard);
    if (v2Result.success) {
      return v2Result;
    }

    // Fallback to Config API v1
    const url = `${this.configApi}/dashboards`;
    const response = await this.post(url, dashboard);

    if (response.isSuccess) {
      const data = response.data as Record<string, unknown> | undefined;
      const dashboardId = data?.['id'] as string | undefined;
      return {
        entityType: 'dashboard',
        entityName: name,
        success: true,
        dynatraceId: dashboardId,
      };
    }

    return {
      entityType: 'dashboard',
      entityName: name,
      success: false,
      errorMessage: response.error,
    };
  }

  async createDashboardV2(dashboard: Record<string, unknown>): Promise<ImportResult> {
    const metadata = (dashboard['dashboardMetadata'] ?? {}) as Record<string, unknown>;
    const name = (metadata['name'] ?? 'Unknown') as string;
    const platformUrl = this.environmentUrl.replace('.live.', '.apps.');
    const url = `${platformUrl}/platform/document/v1/documents`;

    const docPayload = {
      name,
      type: 'dashboard',
      content: JSON.stringify(dashboard),
      isPrivate: !(metadata['shared'] ?? false),
    };

    const response = await this.post(url, docPayload);

    if (response.isSuccess) {
      const data = response.data as Record<string, unknown> | undefined;
      const docId = data?.['id'] as string | undefined;
      return {
        entityType: 'dashboard',
        entityName: name,
        success: true,
        dynatraceId: docId,
      };
    }

    return {
      entityType: 'dashboard',
      entityName: name,
      success: false,
      errorMessage: response.error,
    };
  }

  async updateDashboardV2(
    docId: string,
    dashboard: Record<string, unknown>,
  ): Promise<ImportResult> {
    const metadata = (dashboard['dashboardMetadata'] ?? {}) as Record<string, unknown>;
    const name = (metadata['name'] ?? 'Unknown') as string;
    const platformUrl = this.environmentUrl.replace('.live.', '.apps.');
    const url = `${platformUrl}/platform/document/v1/documents/${docId}`;

    const docPayload = {
      name,
      content: JSON.stringify(dashboard),
      isPrivate: !(metadata['shared'] ?? false),
    };

    const response = await this.put(url, docPayload);

    if (response.isSuccess) {
      return {
        entityType: 'dashboard',
        entityName: name,
        success: true,
        dynatraceId: docId,
      };
    }

    return {
      entityType: 'dashboard',
      entityName: name,
      success: false,
      errorMessage: response.error,
    };
  }

  async getAllDashboards(): Promise<Record<string, unknown>[]> {
    const url = `${this.configApi}/dashboards`;
    const response = await this.get(url);

    if (response.isSuccess && response.data && typeof response.data === 'object') {
      const data = response.data as Record<string, unknown>;
      const dashboardList = (data['dashboards'] ?? []) as Record<string, unknown>[];
      const dashboards: Record<string, unknown>[] = [];

      for (const item of dashboardList) {
        const fullUrl = `${this.configApi}/dashboards/${item['id'] as string}`;
        const fullResponse = await this.get(fullUrl);
        if (fullResponse.isSuccess && fullResponse.data) {
          dashboards.push(fullResponse.data as Record<string, unknown>);
        }
      }

      return dashboards;
    }

    return [];
  }

  // =========================================================================
  // Alerting / Metric Events Methods
  // =========================================================================

  async createMetricEvent(metricEvent: Record<string, unknown>): Promise<ImportResult> {
    const schemaId = 'builtin:anomaly-detection.metric-events';

    const response = await this.createSettingsObject(schemaId, metricEvent);

    if (response.isSuccess) {
      const createdItems = response.data as Record<string, unknown>[] | undefined;
      if (createdItems && createdItems.length > 0) {
        return {
          entityType: 'metric_event',
          entityName: (metricEvent['summary'] as string) ?? 'Unknown',
          success: true,
          dynatraceId: createdItems[0]?.['objectId'] as string | undefined,
        };
      }
    }

    return {
      entityType: 'metric_event',
      entityName: (metricEvent['summary'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  async createAlertingProfile(profile: Record<string, unknown>): Promise<ImportResult> {
    const schemaId = 'builtin:alerting.profile';

    const response = await this.createSettingsObject(schemaId, profile);

    if (response.isSuccess) {
      const createdItems = response.data as Record<string, unknown>[] | undefined;
      if (createdItems && createdItems.length > 0) {
        return {
          entityType: 'alerting_profile',
          entityName: (profile['name'] as string) ?? 'Unknown',
          success: true,
          dynatraceId: createdItems[0]?.['objectId'] as string | undefined,
        };
      }
    }

    return {
      entityType: 'alerting_profile',
      entityName: (profile['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  // =========================================================================
  // Synthetic Monitor Methods
  // =========================================================================

  async createHttpMonitor(monitor: Record<string, unknown>): Promise<ImportResult> {
    const url = `${this.environmentUrl}/api/v1/synthetic/monitors`;
    const response = await this.post(url, monitor);

    if (response.isSuccess) {
      const data = response.data as Record<string, unknown> | undefined;
      return {
        entityType: 'http_monitor',
        entityName: (monitor['name'] as string) ?? 'Unknown',
        success: true,
        dynatraceId: data?.['entityId'] as string | undefined,
      };
    }

    return {
      entityType: 'http_monitor',
      entityName: (monitor['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  async createBrowserMonitor(monitor: Record<string, unknown>): Promise<ImportResult> {
    const url = `${this.environmentUrl}/api/v1/synthetic/monitors`;
    const response = await this.post(url, monitor);

    if (response.isSuccess) {
      const data = response.data as Record<string, unknown> | undefined;
      return {
        entityType: 'browser_monitor',
        entityName: (monitor['name'] as string) ?? 'Unknown',
        success: true,
        dynatraceId: data?.['entityId'] as string | undefined,
      };
    }

    return {
      entityType: 'browser_monitor',
      entityName: (monitor['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  async getSyntheticLocations(): Promise<Record<string, unknown>[]> {
    const url = `${this.environmentUrl}/api/v1/synthetic/locations`;
    const response = await this.get(url);

    if (response.isSuccess && response.data && typeof response.data === 'object') {
      return ((response.data as Record<string, unknown>)['locations'] ??
        []) as Record<string, unknown>[];
    }
    return [];
  }

  // =========================================================================
  // SLO Methods
  // =========================================================================

  async createSlo(slo: Record<string, unknown>): Promise<ImportResult> {
    const url = `${this.apiV2}/slo`;
    const response = await this.post(url, slo);

    if (response.isSuccess) {
      const data = response.data as Record<string, unknown> | undefined;
      return {
        entityType: 'slo',
        entityName: (slo['name'] as string) ?? 'Unknown',
        success: true,
        dynatraceId: data?.['id'] as string | undefined,
      };
    }

    return {
      entityType: 'slo',
      entityName: (slo['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  async getAllSlos(): Promise<Record<string, unknown>[]> {
    const url = `${this.apiV2}/slo`;
    const allSlos: Record<string, unknown>[] = [];
    let nextPageKey: string | undefined;

    while (true) {
      const params: Record<string, unknown> = {};
      if (nextPageKey) {
        params['nextPageKey'] = nextPageKey;
      }

      const response = await this.get(url, params);

      if (!response.isSuccess) {
        break;
      }

      const data = response.data as Record<string, unknown> | undefined;
      const slos = (data?.['slo'] ?? []) as Record<string, unknown>[];
      allSlos.push(...slos);

      const key = data?.['nextPageKey'];
      if (typeof key === 'string' && key.length > 0) {
        nextPageKey = key;
      } else {
        break;
      }
    }

    return allSlos;
  }

  // =========================================================================
  // Management Zone Methods
  // =========================================================================

  async createManagementZone(mz: Record<string, unknown>): Promise<ImportResult> {
    const schemaId = 'builtin:management-zones';

    const response = await this.createSettingsObject(schemaId, mz);

    if (response.isSuccess) {
      const createdItems = response.data as Record<string, unknown>[] | undefined;
      if (createdItems && createdItems.length > 0) {
        return {
          entityType: 'management_zone',
          entityName: (mz['name'] as string) ?? 'Unknown',
          success: true,
          dynatraceId: createdItems[0]?.['objectId'] as string | undefined,
        };
      }
    }

    return {
      entityType: 'management_zone',
      entityName: (mz['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  // =========================================================================
  // Notification / Integration Methods
  // =========================================================================

  async createNotificationIntegration(
    integrationType: string,
    config: Record<string, unknown>,
  ): Promise<ImportResult> {
    const schemaId = NOTIFICATION_INTEGRATION_SCHEMA[integrationType.toLowerCase()];

    if (!schemaId) {
      return {
        entityType: 'notification',
        entityName: (config['name'] as string) ?? 'Unknown',
        success: false,
        errorMessage: `Unknown integration type: ${integrationType}`,
      };
    }

    const response = await this.createSettingsObject(schemaId, config);

    if (response.isSuccess) {
      const createdItems = response.data as Record<string, unknown>[] | undefined;
      if (createdItems && createdItems.length > 0) {
        return {
          entityType: 'notification',
          entityName: (config['name'] as string) ?? 'Unknown',
          success: true,
          dynatraceId: createdItems[0]?.['objectId'] as string | undefined,
        };
      }
    }

    return {
      entityType: 'notification',
      entityName: (config['name'] as string) ?? 'Unknown',
      success: false,
      errorMessage: response.error,
    };
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  async validateConnection(): Promise<boolean> {
    const url = `${this.apiV2}/settings/schemas`;
    const response = await this.get(url, { pageSize: 1 });
    return response.isSuccess;
  }

  /**
   * Gen3 readiness probe — returns a boolean map telling the caller
   * whether each DT Gen3 surface the engine relies on is reachable.
   * Mirrors the Python CLI's `preflight_gen3` capability check.
   *
   * Probes are intentionally cheap (pageSize 1 / HEAD-equivalent GET)
   * so preflight is safe to run from a CI pre-merge gate.
   */
  async preflightGen3(): Promise<{
    readonly settingsV2: boolean;
    readonly documentApi: boolean;
    readonly automationApi: boolean;
    readonly slov2: boolean;
    readonly diagnostics: string[];
  }> {
    const diagnostics: string[] = [];

    const platformUrl = this.environmentUrl.replace('.live.', '.apps.');

    const settingsProbe = await this.get(`${this.apiV2}/settings/objects`, {
      pageSize: 1,
      schemaIds: 'builtin:alerting.profile',
    });
    if (!settingsProbe.isSuccess) {
      diagnostics.push(`settings v2: ${settingsProbe.error ?? settingsProbe.statusCode}`);
    }

    const documentProbe = await this.get(
      `${platformUrl}/platform/document/v1/documents`,
      { 'page-size': 1 },
    );
    if (!documentProbe.isSuccess) {
      diagnostics.push(
        `document API: ${documentProbe.error ?? documentProbe.statusCode}`,
      );
    }

    const automationProbe = await this.get(
      `${platformUrl}/platform/automation/v1/workflows`,
      { 'page-size': 1 },
    );
    if (!automationProbe.isSuccess) {
      diagnostics.push(
        `automation API: ${automationProbe.error ?? automationProbe.statusCode}`,
      );
    }

    const sloProbe = await this.get(`${this.apiV2}/slo`, { pageSize: 1 });
    if (!sloProbe.isSuccess) {
      diagnostics.push(`SLO v2: ${sloProbe.error ?? sloProbe.statusCode}`);
    }

    return {
      settingsV2: settingsProbe.isSuccess,
      documentApi: documentProbe.isSuccess,
      automationApi: automationProbe.isSuccess,
      slov2: sloProbe.isSuccess,
      diagnostics,
    };
  }

  async backupAll(): Promise<Record<string, unknown>> {
    logger.info('Starting Dynatrace backup');

    const backupData: Record<string, unknown> = {
      metadata: {
        environmentUrl: this.environmentUrl,
        backupTimestamp: new Date().toISOString(),
        toolVersion: '1.0.0',
      },
      dashboards: await this.getAllDashboards(),
      slos: await this.getAllSlos(),
      alertingProfiles: await this.getSettingsObjects('builtin:alerting.profile'),
      metricEvents: await this.getSettingsObjects(
        'builtin:anomaly-detection.metric-events',
      ),
      managementZones: await this.getSettingsObjects('builtin:management-zones'),
    };

    const dashboards = backupData['dashboards'] as unknown[];
    const slos = backupData['slos'] as unknown[];
    logger.info(
      { dashboards: dashboards.length, slos: slos.length },
      'Backup complete',
    );

    return backupData;
  }
}
