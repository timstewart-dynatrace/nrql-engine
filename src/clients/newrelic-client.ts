/**
 * New Relic NerdGraph API Client.
 *
 * Provides methods to export all configuration entities from New Relic
 * using the NerdGraph GraphQL API.
 */

import axios, { type AxiosInstance } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'newrelic-client' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NerdGraphResponse {
  readonly data: Record<string, unknown> | undefined;
  readonly errors: ReadonlyArray<Record<string, unknown>> | undefined;
  readonly isSuccess: boolean;
}

export interface ExportData {
  readonly metadata: {
    readonly accountId: string;
    readonly region: string;
    readonly exportTimestamp: string;
    readonly toolVersion: string;
  };
  readonly dashboards: Record<string, unknown>[];
  readonly alertPolicies: Record<string, unknown>[];
  readonly notificationChannels: Record<string, unknown>[];
  readonly syntheticMonitors: Record<string, unknown>[];
  readonly slos: Record<string, unknown>[];
  readonly workloads: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely navigate a nested object by an array of keys.
 * Returns `undefined` when any intermediate value is nullish.
 */
function getNestedValue(obj: unknown, keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class NewRelicClient {
  private readonly apiKey: string;
  private readonly accountId: string;
  private readonly region: string;
  private readonly rateLimit: number;
  private lastRequestTime = 0;
  private readonly graphqlEndpoint: string;
  private readonly http: AxiosInstance;

  constructor(options: {
    apiKey: string;
    accountId: string;
    region?: string;
    rateLimit?: number;
  }) {
    this.apiKey = options.apiKey;
    this.accountId = options.accountId;
    this.region = (options.region ?? 'US').toUpperCase();
    this.rateLimit = options.rateLimit ?? 5.0;

    this.graphqlEndpoint =
      this.region === 'EU'
        ? 'https://api.eu.newrelic.com/graphql'
        : 'https://api.newrelic.com/graphql';

    this.http = axios.create({
      baseURL: this.graphqlEndpoint,
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        'API-Key': this.apiKey,
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
  // Core query execution
  // -------------------------------------------------------------------------

  async executeQuery(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<NerdGraphResponse> {
    await this.rateLimitWait();

    const payload: Record<string, unknown> = { query };
    if (variables) {
      payload['variables'] = variables;
    }

    try {
      const response = await this.http.post<{
        data?: Record<string, unknown>;
        errors?: Record<string, unknown>[];
      }>('', payload);

      const result = response.data;
      const errors = result.errors;
      return {
        data: result.data,
        errors,
        isSuccess: !errors || errors.length === 0,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'NerdGraph API error');
      return {
        data: undefined,
        errors: [{ message }],
        isSuccess: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Pagination helper
  // -------------------------------------------------------------------------

  async *paginateQuery(
    query: string,
    pathToCursor: string[],
    pathToResults: string[],
    variables?: Record<string, unknown>,
  ): AsyncGenerator<Record<string, unknown>> {
    let cursor: string | undefined;
    const vars = { ...(variables ?? {}) };

    while (true) {
      vars['cursor'] = cursor ?? null;
      const response = await this.executeQuery(query, vars);

      if (!response.isSuccess) {
        logger.error({ errors: response.errors }, 'Pagination query failed');
        break;
      }

      const results = getNestedValue(response.data, pathToResults);
      if (Array.isArray(results)) {
        for (const item of results) {
          yield item as Record<string, unknown>;
        }
      }

      const nextCursor = getNestedValue(response.data, pathToCursor);
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }
  }

  // =========================================================================
  // Dashboard Export Methods
  // =========================================================================

  async getAllDashboards(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          entitySearch(
            query: "accountId = $accountId AND type = 'DASHBOARD'"
            options: { limit: 200 }
          ) {
            results(cursor: $cursor) {
              entities {
                guid
                name
                ... on DashboardEntityOutline {
                  dashboardParentGuid
                }
              }
              nextCursor
            }
          }
        }
      }
    `;

    const dashboards: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        logger.error({ errors: response.errors }, 'Failed to fetch dashboards');
        break;
      }

      const results = getNestedValue(response.data, [
        'actor',
        'entitySearch',
        'results',
      ]) as Record<string, unknown> | undefined;

      const entities = (results?.['entities'] ?? []) as Record<string, unknown>[];

      for (const entity of entities) {
        const guid = entity['guid'] as string;
        const fullDashboard = await this.getDashboardDefinition(guid);
        if (fullDashboard) {
          dashboards.push(fullDashboard);
        }
      }

      const nextCursor = results?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info({ count: dashboards.length }, `Exported ${dashboards.length} dashboards`);
    return dashboards;
  }

  async getDashboardDefinition(guid: string): Promise<Record<string, unknown> | undefined> {
    const query = `
      query($guid: EntityGuid!) {
        actor {
          entity(guid: $guid) {
            ... on DashboardEntity {
              guid
              name
              description
              permissions
              pages {
                guid
                name
                description
                widgets {
                  id
                  title
                  layout {
                    column
                    row
                    width
                    height
                  }
                  visualization {
                    id
                  }
                  rawConfiguration
                }
              }
              variables {
                name
                type
                defaultValues
                isMultiSelection
                items {
                  title
                  value
                }
                nrqlQuery {
                  accountIds
                  query
                }
                replacementStrategy
              }
            }
          }
        }
      }
    `;

    const response = await this.executeQuery(query, { guid });
    if (response.isSuccess && response.data) {
      return getNestedValue(response.data, ['actor', 'entity']) as
        | Record<string, unknown>
        | undefined;
    }
    return undefined;
  }

  // =========================================================================
  // Alert Export Methods
  // =========================================================================

  async getAllAlertPolicies(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          account(id: $accountId) {
            alerts {
              policiesSearch(cursor: $cursor) {
                policies {
                  id
                  name
                  incidentPreference
                }
                nextCursor
              }
            }
          }
        }
      }
    `;

    const policies: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        logger.error({ errors: response.errors }, 'Failed to fetch alert policies');
        break;
      }

      const searchResult = getNestedValue(response.data, [
        'actor',
        'account',
        'alerts',
        'policiesSearch',
      ]) as Record<string, unknown> | undefined;

      const policyList = (searchResult?.['policies'] ?? []) as Record<string, unknown>[];

      for (const policy of policyList) {
        const conditions = await this.getAlertConditions(policy['id'] as string);
        policy['conditions'] = conditions;
        policies.push(policy);
      }

      const nextCursor = searchResult?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info({ count: policies.length }, `Exported ${policies.length} alert policies`);
    return policies;
  }

  async getAlertConditions(policyId: string): Promise<Record<string, unknown>[]> {
    const nrqlQuery = `
      query($accountId: Int!, $policyId: ID!, $cursor: String) {
        actor {
          account(id: $accountId) {
            alerts {
              nrqlConditionsSearch(
                searchCriteria: { policyId: $policyId }
                cursor: $cursor
              ) {
                nrqlConditions {
                  id
                  name
                  type
                  enabled
                  nrql {
                    query
                  }
                  signal {
                    aggregationWindow
                    aggregationMethod
                    aggregationDelay
                    fillOption
                    fillValue
                  }
                  terms {
                    threshold
                    thresholdDuration
                    thresholdOccurrences
                    operator
                    priority
                  }
                  expiration {
                    closeViolationsOnExpiration
                    expirationDuration
                    openViolationOnExpiration
                  }
                  runbookUrl
                  description
                }
                nextCursor
              }
            }
          }
        }
      }
    `;

    const conditions: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(nrqlQuery, {
        accountId: Number(this.accountId),
        policyId,
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        break;
      }

      const searchResult = getNestedValue(response.data, [
        'actor',
        'account',
        'alerts',
        'nrqlConditionsSearch',
      ]) as Record<string, unknown> | undefined;

      const nrqlConditions = (searchResult?.['nrqlConditions'] ?? []) as Record<
        string,
        unknown
      >[];

      for (const condition of nrqlConditions) {
        condition['conditionType'] = 'NRQL';
        conditions.push(condition);
      }

      const nextCursor = searchResult?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    return conditions;
  }

  async getNotificationChannels(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          account(id: $accountId) {
            aiNotifications {
              destinations(cursor: $cursor) {
                entities {
                  id
                  name
                  type
                  active
                  properties {
                    key
                    value
                  }
                }
                nextCursor
              }
            }
          }
        }
      }
    `;

    const channels: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        logger.error({ errors: response.errors }, 'Failed to fetch notification channels');
        break;
      }

      const result = getNestedValue(response.data, [
        'actor',
        'account',
        'aiNotifications',
        'destinations',
      ]) as Record<string, unknown> | undefined;

      const entities = (result?.['entities'] ?? []) as Record<string, unknown>[];
      channels.push(...entities);

      const nextCursor = result?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info(
      { count: channels.length },
      `Exported ${channels.length} notification channels`,
    );
    return channels;
  }

  // =========================================================================
  // Synthetic Monitor Export Methods
  // =========================================================================

  async getAllSyntheticMonitors(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          entitySearch(
            query: "accountId = $accountId AND type = 'SYNTHETIC_MONITOR'"
            options: { limit: 200 }
          ) {
            results(cursor: $cursor) {
              entities {
                guid
                name
                ... on SyntheticMonitorEntityOutline {
                  monitorType
                  monitoredUrl
                  period
                }
              }
              nextCursor
            }
          }
        }
      }
    `;

    const monitors: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        break;
      }

      const results = getNestedValue(response.data, [
        'actor',
        'entitySearch',
        'results',
      ]) as Record<string, unknown> | undefined;

      const entities = (results?.['entities'] ?? []) as Record<string, unknown>[];

      for (const entity of entities) {
        const guid = entity['guid'] as string;
        const fullMonitor = await this.getSyntheticMonitorDetails(guid);
        if (fullMonitor) {
          monitors.push(fullMonitor);
        }
      }

      const nextCursor = results?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info(
      { count: monitors.length },
      `Exported ${monitors.length} synthetic monitors`,
    );
    return monitors;
  }

  async getSyntheticMonitorDetails(
    guid: string,
  ): Promise<Record<string, unknown> | undefined> {
    const query = `
      query($guid: EntityGuid!) {
        actor {
          entity(guid: $guid) {
            ... on SyntheticMonitorEntity {
              guid
              name
              monitorType
              monitoredUrl
              period
              status
              monitorSummary {
                status
                successRate
              }
              tags {
                key
                values
              }
            }
          }
        }
      }
    `;

    const response = await this.executeQuery(query, { guid });
    if (response.isSuccess && response.data) {
      return getNestedValue(response.data, ['actor', 'entity']) as
        | Record<string, unknown>
        | undefined;
    }
    return undefined;
  }

  async getSyntheticMonitorScript(monitorGuid: string): Promise<string | undefined> {
    const query = `
      query($accountId: Int!, $monitorGuid: EntityGuid!) {
        actor {
          account(id: $accountId) {
            synthetics {
              script(monitorGuid: $monitorGuid) {
                text
              }
            }
          }
        }
      }
    `;

    const response = await this.executeQuery(query, {
      accountId: Number(this.accountId),
      monitorGuid,
    });

    if (response.isSuccess && response.data) {
      const scriptData = getNestedValue(response.data, [
        'actor',
        'account',
        'synthetics',
        'script',
      ]) as Record<string, unknown> | undefined;
      if (scriptData) {
        const text = scriptData['text'];
        return typeof text === 'string' ? text : undefined;
      }
    }
    return undefined;
  }

  // =========================================================================
  // SLO Export Methods
  // =========================================================================

  async getAllSlos(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          account(id: $accountId) {
            serviceLevel {
              indicators(cursor: $cursor) {
                entities {
                  guid
                  name
                  description
                  objectives {
                    target
                    timeWindow {
                      rolling {
                        count
                        unit
                      }
                    }
                  }
                  events {
                    validEvents {
                      from
                      where
                    }
                    goodEvents {
                      from
                      where
                    }
                    badEvents {
                      from
                      where
                    }
                  }
                }
                nextCursor
              }
            }
          }
        }
      }
    `;

    const slos: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        break;
      }

      const result = getNestedValue(response.data, [
        'actor',
        'account',
        'serviceLevel',
        'indicators',
      ]) as Record<string, unknown> | undefined;

      const entities = (result?.['entities'] ?? []) as Record<string, unknown>[];
      slos.push(...entities);

      const nextCursor = result?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info({ count: slos.length }, `Exported ${slos.length} SLOs`);
    return slos;
  }

  // =========================================================================
  // Workload Export Methods
  // =========================================================================

  async getAllWorkloads(): Promise<Record<string, unknown>[]> {
    const query = `
      query($accountId: Int!, $cursor: String) {
        actor {
          entitySearch(
            query: "accountId = $accountId AND type = 'WORKLOAD'"
            options: { limit: 200 }
          ) {
            results(cursor: $cursor) {
              entities {
                guid
                name
                ... on WorkloadEntityOutline {
                  workloadStatus {
                    statusValue
                  }
                }
              }
              nextCursor
            }
          }
        }
      }
    `;

    const workloads: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.executeQuery(query, {
        accountId: Number(this.accountId),
        cursor: cursor ?? null,
      });

      if (!response.isSuccess) {
        break;
      }

      const results = getNestedValue(response.data, [
        'actor',
        'entitySearch',
        'results',
      ]) as Record<string, unknown> | undefined;

      const entities = (results?.['entities'] ?? []) as Record<string, unknown>[];

      for (const entity of entities) {
        const guid = entity['guid'] as string;
        const fullWorkload = await this.getWorkloadDetails(guid);
        if (fullWorkload) {
          workloads.push(fullWorkload);
        }
      }

      const nextCursor = results?.['nextCursor'];
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        break;
      }
    }

    logger.info({ count: workloads.length }, `Exported ${workloads.length} workloads`);
    return workloads;
  }

  async getWorkloadDetails(guid: string): Promise<Record<string, unknown> | undefined> {
    const query = `
      query($guid: EntityGuid!) {
        actor {
          entity(guid: $guid) {
            ... on WorkloadEntity {
              guid
              name
              collection {
                guid
                name
                type
              }
              entitySearchQueries {
                query
              }
            }
          }
        }
      }
    `;

    const response = await this.executeQuery(query, { guid });
    if (response.isSuccess && response.data) {
      return getNestedValue(response.data, ['actor', 'entity']) as
        | Record<string, unknown>
        | undefined;
    }
    return undefined;
  }

  // =========================================================================
  // Preflight readiness probe
  // =========================================================================

  /**
   * Probe that the NR API key + account are usable before a migration
   * starts. Uses the cheap `actor { user { email }}` NerdGraph query
   * plus an account-scoped entity count so the operator gets a sense
   * of migration size before kick-off.
   */
  async preflightNewRelic(): Promise<{
    readonly apiKeyValid: boolean;
    readonly accountReachable: boolean;
    readonly userEmail: string | undefined;
    readonly entityCount: number | undefined;
    readonly diagnostics: string[];
  }> {
    const diagnostics: string[] = [];

    const userProbe = await this.executeQuery('{ actor { user { email } } }');
    const apiKeyValid = userProbe.isSuccess;
    let userEmail: string | undefined;
    if (userProbe.isSuccess) {
      const actor = (userProbe.data as { actor?: { user?: { email?: string } } })
        ?.actor;
      userEmail = actor?.user?.email;
    } else {
      diagnostics.push(
        `api key: ${userProbe.errors?.map((e) => e['message']).join(', ') ?? 'unknown error'}`,
      );
    }

    const entityProbe = await this.executeQuery(
      `{ actor { account(id: ${this.accountId}) { id name } entitySearch(query: "accountId = ${this.accountId}") { count } } }`,
    );
    const accountReachable = entityProbe.isSuccess;
    let entityCount: number | undefined;
    if (entityProbe.isSuccess) {
      const entitySearch = (
        entityProbe.data as { actor?: { entitySearch?: { count?: number } } }
      )?.actor?.entitySearch;
      entityCount = entitySearch?.count;
    } else {
      diagnostics.push(
        `account ${this.accountId}: ${entityProbe.errors?.map((e) => e['message']).join(', ') ?? 'unknown error'}`,
      );
    }

    return {
      apiKeyValid,
      accountReachable,
      userEmail,
      entityCount,
      diagnostics,
    };
  }

  // =========================================================================
  // Full Export Method
  // =========================================================================

  async exportAll(): Promise<ExportData> {
    logger.info({ accountId: this.accountId }, 'Starting full New Relic export');

    const exportData: ExportData = {
      metadata: {
        accountId: this.accountId,
        region: this.region,
        exportTimestamp: new Date().toISOString(),
        toolVersion: '1.0.0',
      },
      dashboards: await this.getAllDashboards(),
      alertPolicies: await this.getAllAlertPolicies(),
      notificationChannels: await this.getNotificationChannels(),
      syntheticMonitors: await this.getAllSyntheticMonitors(),
      slos: await this.getAllSlos(),
      workloads: await this.getAllWorkloads(),
    };

    logger.info(
      {
        dashboards: exportData.dashboards.length,
        alertPolicies: exportData.alertPolicies.length,
        syntheticMonitors: exportData.syntheticMonitors.length,
        slos: exportData.slos.length,
        workloads: exportData.workloads.length,
      },
      'Export complete',
    );

    return exportData;
  }
}
