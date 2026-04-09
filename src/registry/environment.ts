/**
 * Dynatrace Environment Registry -- Live validation against the real environment.
 *
 * Central registry that lazy-loads live data from the Dynatrace environment.
 *
 * Provides:
 *   - Metric Registry:    Validate dt.* metric keys exist, fuzzy-find corrections
 *   - Entity Registry:    Resolve service/host/process names and IDs
 *   - Dashboard Registry: Check for existing dashboards before creating duplicates
 *   - Management Zone Registry: Map NR account/policy scope to DT zones
 *   - Synthetic Location Registry: Map NR locations to DT public/private locations
 *
 * All registries are lazy-loaded -- only fetched when first accessed.
 * Shared across SLOAuditor, NRQLtoDQLConverter, DashboardMigrator, etc.
 *
 * APIs used:
 *   Metrics v2:      GET /api/v2/metrics               (.live.)
 *   Entities v2:     GET /api/v2/entities               (.live.)
 *   Documents v1:    GET /platform/document/v1/documents (.apps.)
 *   Settings v2:     GET /api/v2/settings/objects        (.live.)
 *   Synthetic v2:    GET /api/v2/synthetic/locations      (.live.)
 */

import axios, { type AxiosRequestConfig } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'registry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Domain selector for API routing. */
type ApiDomain = 'live' | 'platform';

interface EntityRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
  readonly tags: Record<string, string | boolean>;
}

interface DashboardRecord {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly modificationInfo: Record<string, unknown>;
}

interface ManagementZoneRecord {
  readonly id: string;
  readonly name: string;
  readonly rules: unknown[];
}

interface SyntheticLocationRecord {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly type: string;
  readonly countryCode: string;
  readonly regionCode: string;
  readonly cloudPlatform: string;
  readonly status: string;
}

interface MetricInfo {
  readonly key: string;
  readonly displayName: string;
  readonly unit: string;
}

interface MetricValidationEntry {
  readonly target: string;
  readonly exists: boolean;
  readonly suggestion: string | undefined;
  readonly displayName: string;
}

interface DqlValidationResult {
  readonly isValid: boolean | undefined;
  readonly errorMessage: string;
  readonly errorDetails: Record<string, unknown> | undefined;
}

interface ParsedDqlError {
  errorType: 'syntax' | 'function' | 'column' | 'parameter' | 'unknown';
  badToken: string;
  position: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Synonyms constant
// ---------------------------------------------------------------------------

/** Semantic synonyms for fuzzy matching (metrics + entities). */
export const SYNONYMS: Readonly<Record<string, ReadonlySet<string>>> = {
  error: new Set(['failure', 'errors', 'failed']),
  failure: new Set(['error', 'errors', 'failed']),
  errors: new Set(['error', 'failure', 'failed']),
  failed: new Set(['error', 'failure', 'errors']),
  response: new Set(['response_time', 'responsetime', 'latency', 'duration']),
  latency: new Set(['response', 'response_time', 'duration']),
  time: new Set(['response_time', 'duration']),
  success: new Set(['successes', 'successcount']),
  successes: new Set(['success', 'successcount']),
  total: new Set(['count', 'all']),
  bytes: new Set(['bytes_rx', 'bytes_tx', 'bytesrx', 'bytestx']),
  rx: new Set(['bytes_rx', 'received']),
  tx: new Set(['bytes_tx', 'sent']),
  memory: new Set(['mem', 'ram']),
  mem: new Set(['memory', 'ram']),
  cpu: new Set(['processor', 'compute']),
  disk: new Set(['storage', 'volume']),
  net: new Set(['network', 'nic']),
  network: new Set(['net', 'nic']),
};

// ---------------------------------------------------------------------------
// DTEnvironmentRegistry
// ---------------------------------------------------------------------------

export class DTEnvironmentRegistry {
  readonly dtUrl: string;
  readonly platformUrl: string;
  readonly liveUrl: string;
  readonly oauthToken: string;
  readonly apiToken: string;

  // Lazy-loaded registries (null = not yet loaded)
  private _metrics: Set<string> | undefined;
  private _metricDisplayNames: Map<string, string> = new Map();
  private _metricUnits: Map<string, string> = new Map();
  private _metricSearchCache: Map<string, string | undefined> = new Map();

  private _entities: Map<string, EntityRecord> | undefined;
  private _entityNameIndex: Map<string, string[]> = new Map();
  private _entityTypeIndex: Map<string, string[]> = new Map();

  private _dashboards: Map<string, DashboardRecord> | undefined;
  private _dashboardNameIndex: Map<string, string[]> = new Map();

  private _mgmtZones: Map<string, ManagementZoneRecord> | undefined;
  private _mgmtZoneNameIndex: Map<string, string> = new Map();

  private _synthLocations: Map<string, SyntheticLocationRecord> | undefined;
  private _synthLocationNameIndex: Map<string, string> = new Map();

  private _loadErrors: string[] = [];

  // DQL live validation cache
  private _dqlValidationCache: Map<number, DqlValidationResult> = new Map();

  constructor(dtUrl: string, oauthToken = '', apiToken = '') {
    this.dtUrl = dtUrl.replace(/\/+$/, '');
    this.platformUrl = this.dtUrl.replace('.live.', '.apps.');
    this.liveUrl = this.dtUrl.replace('.apps.', '.live.');
    this.oauthToken = oauthToken;
    this.apiToken = apiToken;
  }

  // --- HTTP helpers --------------------------------------------------------

  async apiGet(url: string, domain: ApiDomain = 'live'): Promise<Record<string, unknown> | undefined> {
    let auth: string;
    if (domain === 'platform') {
      if (!this.oauthToken) return undefined;
      auth = `Bearer ${this.oauthToken}`;
    } else if (this.apiToken) {
      auth = `Api-Token ${this.apiToken}`;
    } else if (this.oauthToken) {
      auth = `Bearer ${this.oauthToken}`;
    } else {
      return undefined;
    }

    const config: AxiosRequestConfig = {
      headers: { Authorization: auth, Accept: 'application/json' },
      timeout: 30_000,
    };

    try {
      const resp = await axios.get<Record<string, unknown>>(url, config);
      return resp.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const body = typeof err.response?.data === 'string'
          ? err.response.data.slice(0, 200)
          : JSON.stringify(err.response?.data ?? '').slice(0, 200);
        this._loadErrors.push(`HTTP ${status ?? 0} on ${url.slice(0, 80)}: ${body}`);

        // Retry with OAuth if Api-Token failed
        if (domain === 'live' && this.apiToken && this.oauthToken && (status === 401 || status === 403)) {
          try {
            config.headers = { Authorization: `Bearer ${this.oauthToken}`, Accept: 'application/json' };
            const resp = await axios.get<Record<string, unknown>>(url, config);
            return resp.data;
          } catch {
            // Fall through to return undefined
          }
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this._loadErrors.push(`Error on ${url.slice(0, 80)}: ${message.slice(0, 100)}`);
      }
      return undefined;
    }
  }

  async apiPost(
    url: string,
    payload: Record<string, unknown>,
    domain: ApiDomain = 'platform',
  ): Promise<[Record<string, unknown> | undefined, number]> {
    let auth: string;
    if (domain === 'platform') {
      if (!this.oauthToken) return [undefined, 0];
      auth = `Bearer ${this.oauthToken}`;
    } else if (this.apiToken) {
      auth = `Api-Token ${this.apiToken}`;
    } else if (this.oauthToken) {
      auth = `Bearer ${this.oauthToken}`;
    } else {
      return [undefined, 0];
    }

    const config: AxiosRequestConfig = {
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15_000,
      // Don't throw on non-2xx so we can read error bodies
      validateStatus: () => true,
    };

    try {
      const resp = await axios.post<Record<string, unknown>>(url, payload, config);
      return [resp.data, resp.status];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{ error: { message } }, 0];
    }
  }

  // --- DQL Live Validation -------------------------------------------------

  async validateDqlSyntax(dql: string): Promise<DqlValidationResult> {
    if (!this.oauthToken) {
      return { isValid: undefined, errorMessage: 'No OAuth token -- live validation unavailable', errorDetails: undefined };
    }

    // Strip comments
    const dqlClean = dql
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('//'))
      .join('\n')
      .trim();

    if (!dqlClean) {
      return { isValid: undefined, errorMessage: 'Empty DQL after stripping comments', errorDetails: undefined };
    }

    // Check cache
    const cacheKey = simpleHash(dqlClean);
    const cached = this._dqlValidationCache.get(cacheKey);
    if (cached) return cached;

    // Submit to Grail query API
    const url = `${this.platformUrl}/platform/storage/query/v1/query:execute`;
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const payload = {
      query: dqlClean,
      defaultTimeframeStart: twoHoursAgo.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
      defaultTimeframeEnd: now.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
      maxResultRecords: 1,
      requestTimeoutMilliseconds: 5000,
      locale: 'en_US',
    };

    const [response, status] = await this.apiPost(url, payload, 'platform');

    if (response === undefined) {
      const result: DqlValidationResult = { isValid: undefined, errorMessage: 'API unreachable', errorDetails: undefined };
      this._dqlValidationCache.set(cacheKey, result);
      return result;
    }

    // Query executed successfully
    if (status === 200) {
      const result: DqlValidationResult = { isValid: true, errorMessage: '', errorDetails: undefined };
      this._dqlValidationCache.set(cacheKey, result);
      return result;
    }

    // Extract error details
    let errorMsg = '';
    let errorDetails: Record<string, unknown> | undefined;

    const errorField = response['error'];
    if (typeof errorField === 'object' && errorField !== null && !Array.isArray(errorField)) {
      const errorObj = errorField as Record<string, unknown>;
      errorMsg = typeof errorObj['message'] === 'string' ? errorObj['message'] : '';
      errorDetails = errorObj;

      const violations = errorObj['constraintViolations'];
      if (Array.isArray(violations) && violations.length > 0) {
        errorMsg = violations
          .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
          .map((v) => (typeof v['message'] === 'string' ? v['message'] : ''))
          .filter(Boolean)
          .join('; ');
      }
    } else if (typeof errorField === 'string') {
      errorMsg = errorField;
    }

    if (!errorMsg) {
      errorMsg =
        (typeof response['errorMessage'] === 'string' ? response['errorMessage'] : '') ||
        (typeof response['message'] === 'string' ? response['message'] : '') ||
        JSON.stringify(response).slice(0, 200);
    }

    // Auth / permissions errors -- DQL parsed OK but token lacks table access
    const authErrorPatterns = [
      'not_authorized_for_table',
      'not authorized',
      'permission',
      'scope',
      'access denied',
      'forbidden',
    ];
    const errorLower = errorMsg.toLowerCase();
    const isAuthError = authErrorPatterns.some((p) => errorLower.includes(p));

    if (status === 403 || (status === 400 && isAuthError)) {
      const result: DqlValidationResult = { isValid: true, errorMessage: `[AUTH] ${errorMsg}`, errorDetails: undefined };
      this._dqlValidationCache.set(cacheKey, result);
      return result;
    }

    if (status === 429) {
      return { isValid: undefined, errorMessage: 'Rate limited -- skipping validation', errorDetails: undefined };
    }

    const result: DqlValidationResult = { isValid: false, errorMessage: errorMsg, errorDetails };
    this._dqlValidationCache.set(cacheKey, result);
    return result;
  }

  parseDqlError(errorMsg: string): ParsedDqlError {
    const result: ParsedDqlError = { errorType: 'unknown', badToken: '', position: '', suggestion: '' };

    // "isn't allowed here"
    let m = /[`'"](.*?)[`'"].*?isn't allowed here/i.exec(errorMsg);
    if (m) {
      result.errorType = 'syntax';
      result.badToken = m[1] ?? '';
      if (result.badToken.toLowerCase() === 'as') {
        result.suggestion = "Use 'alias=expr' instead of 'expr as alias'";
      } else if (result.badToken === '(') {
        result.suggestion = 'Check for NRQL subqueries or function syntax';
      }
      return result;
    }

    // "Too many positional parameters"
    if (/positional parameter/i.test(errorMsg)) {
      result.errorType = 'parameter';
      result.suggestion = 'Name aggregation parameters (e.g., p99=percentile(duration, 99))';
      return result;
    }

    // "Unknown function"
    m = /[Uu]nknown function\s+[`'"]?(\w+)[`'"]?/.exec(errorMsg);
    if (m) {
      result.errorType = 'function';
      result.badToken = m[1] ?? '';
      return result;
    }

    // "Column does not exist"
    m = /[Cc]olumn\s+[`'"]?(.+?)[`'"]?\s+does not exist/.exec(errorMsg);
    if (m) {
      result.errorType = 'column';
      result.badToken = m[1] ?? '';
      return result;
    }

    // Line/column position
    m = /line\s+(\d+).*?column\s+(\d+)/i.exec(errorMsg);
    if (m) {
      result.position = `${m[1]}:${m[2]}`;
    }

    return result;
  }

  async paginate(
    baseUrl: string,
    itemsKey: string,
    domain: ApiDomain = 'live',
    maxPages = 20,
  ): Promise<Record<string, unknown>[]> {
    const allItems: Record<string, unknown>[] = [];
    let url: string | undefined = baseUrl;
    let pages = 0;

    while (url && pages < maxPages) {
      const data = await this.apiGet(url, domain);
      if (!data) break;

      let items: unknown[];
      if (Array.isArray(data)) {
        items = data as unknown[];
      } else {
        const fetched = data[itemsKey];
        items = Array.isArray(fetched) ? fetched : [];
      }

      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          allItems.push(item as Record<string, unknown>);
        }
      }

      const nextKey = data['nextPageKey'];
      if (typeof nextKey === 'string' && nextKey) {
        const sep = baseUrl.includes('?') ? '&' : '?';
        url = `${baseUrl}${sep}nextPageKey=${encodeURIComponent(nextKey)}`;
      } else {
        url = undefined;
      }
      pages += 1;
    }

    return allItems;
  }

  // --- Metric Registry -----------------------------------------------------

  async loadMetrics(): Promise<void> {
    if (this._metrics !== undefined) return;

    this._metrics = new Set();
    this._metricDisplayNames = new Map();
    this._metricUnits = new Map();

    for (const selector of ['dt.*', 'builtin:*']) {
      const encoded = encodeURIComponent(selector).replace(/%2A/g, '*');
      let url: string | undefined =
        `${this.liveUrl}/api/v2/metrics?metricSelector=${encoded}&fields=displayName,unit&pageSize=500`;
      let page = 0;

      while (url && page < 20) {
        const data = await this.apiGet(url);
        if (!data) break;

        const metrics = data['metrics'];
        if (Array.isArray(metrics)) {
          for (const m of metrics) {
            if (typeof m !== 'object' || m === null) continue;
            const rec = m as Record<string, unknown>;
            const key = typeof rec['metricId'] === 'string' ? rec['metricId'] : '';
            if (key) {
              this._metrics.add(key);
              if (typeof rec['displayName'] === 'string' && rec['displayName']) {
                this._metricDisplayNames.set(key, rec['displayName']);
              }
              if (typeof rec['unit'] === 'string' && rec['unit']) {
                this._metricUnits.set(key, rec['unit']);
              }
            }
          }
        }

        const nextKey = data['nextPageKey'];
        if (typeof nextKey === 'string' && nextKey) {
          url = `${this.liveUrl}/api/v2/metrics?nextPageKey=${encodeURIComponent(nextKey)}`;
        } else {
          url = undefined;
        }
        page += 1;
      }
    }
  }

  async metricExists(key: string): Promise<boolean> {
    await this.loadMetrics();
    return this._metrics !== undefined && this._metrics.has(key);
  }

  async getMetricInfo(key: string): Promise<MetricInfo | undefined> {
    await this.loadMetrics();
    if (!this._metrics || !this._metrics.has(key)) return undefined;
    return {
      key,
      displayName: this._metricDisplayNames.get(key) ?? '',
      unit: this._metricUnits.get(key) ?? '',
    };
  }

  async findMetric(badKey: string): Promise<string | undefined> {
    const cached = this._metricSearchCache.get(badKey);
    if (cached !== undefined) return cached;
    // Distinguish "cached as undefined" from "not in cache"
    if (this._metricSearchCache.has(badKey)) return undefined;

    await this.loadMetrics();
    if (!this._metrics) return undefined;

    const badTokens = DTEnvironmentRegistry.tokenize(badKey);
    let bestMatch: string | undefined;
    let bestScore = 0;

    for (const candidate of this._metrics) {
      if (!candidate.startsWith('dt.')) continue;
      const candTokens = DTEnvironmentRegistry.tokenize(candidate);
      let score = this.tokenSimilarity(badTokens, candTokens);

      // Prefix bonus
      const badPrefix = badKey.split('.').slice(0, 2).join('.');
      const candPrefix = candidate.split('.').slice(0, 2).join('.');
      if (badPrefix === candPrefix) {
        score += 0.3;
      }

      // Length similarity bonus
      const lenRatio = Math.min(badKey.length, candidate.length) / Math.max(badKey.length, candidate.length);
      score += lenRatio * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    // DT text search fallback
    if (bestScore < 0.5) {
      const searchTerms = [...badTokens].filter((t) => t !== 'dt' && t !== 'builtin').join(' ');
      if (searchTerms) {
        const encoded = encodeURIComponent(searchTerms);
        const url = `${this.liveUrl}/api/v2/metrics?text=${encoded}&fields=displayName&pageSize=5`;
        const data = await this.apiGet(url);
        if (data) {
          const metrics = data['metrics'];
          if (Array.isArray(metrics)) {
            for (const m of metrics) {
              if (typeof m !== 'object' || m === null) continue;
              const rec = m as Record<string, unknown>;
              const key = typeof rec['metricId'] === 'string' ? rec['metricId'] : '';
              if (key && key.startsWith('dt.')) {
                const candTokens = DTEnvironmentRegistry.tokenize(key);
                let score = this.tokenSimilarity(badTokens, candTokens);
                const badPrefix = badKey.split('.').slice(0, 2).join('.');
                const candPrefix = key.split('.').slice(0, 2).join('.');
                if (badPrefix === candPrefix) {
                  score += 0.3;
                }
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = key;
                }
              }
            }
          }
        }
      }
    }

    const result = bestScore >= 0.4 ? bestMatch : undefined;
    this._metricSearchCache.set(badKey, result);
    return result;
  }

  async validateMetricMap(metricMap: Record<string, string>): Promise<Record<string, MetricValidationEntry>> {
    await this.loadMetrics();
    const invalid: Record<string, MetricValidationEntry> = {};

    for (const [nrKey, dtTarget] of Object.entries(metricMap)) {
      if (!dtTarget.startsWith('dt.')) continue;
      if (this._metrics && !this._metrics.has(dtTarget)) {
        const suggestion = await this.findMetric(dtTarget);
        invalid[nrKey] = {
          target: dtTarget,
          exists: false,
          suggestion,
          displayName: suggestion ? (this._metricDisplayNames.get(suggestion) ?? '') : '',
        };
      }
    }

    return invalid;
  }

  async getAllMetrics(prefix = 'dt.'): Promise<Set<string>> {
    await this.loadMetrics();
    const result = new Set<string>();
    if (this._metrics) {
      for (const k of this._metrics) {
        if (k.startsWith(prefix)) result.add(k);
      }
    }
    return result;
  }

  // --- Entity Registry -----------------------------------------------------

  async loadEntities(entityType?: string): Promise<void> {
    if (this._entities !== undefined && entityType === undefined) return;
    if (entityType && this._entityTypeIndex.has(entityType)) return;

    if (this._entities === undefined) {
      this._entities = new Map();
      this._entityNameIndex = new Map();
      this._entityTypeIndex = new Map();
    }

    const typesToFetch = entityType
      ? [entityType]
      : ['SERVICE', 'HOST', 'PROCESS_GROUP', 'APPLICATION', 'SYNTHETIC_TEST', 'HTTP_CHECK'];

    for (const etype of typesToFetch) {
      if (this._entityTypeIndex.has(etype)) continue;

      const selector = encodeURIComponent(`type("${etype}")`);
      const url = `${this.liveUrl}/api/v2/entities?entitySelector=${selector}&fields=properties,tags&pageSize=500`;

      const entities = await this.paginate(url, 'entities');
      this._entityTypeIndex.set(etype, []);

      for (const e of entities) {
        const eid = typeof e['entityId'] === 'string' ? e['entityId'] : '';
        const name = typeof e['displayName'] === 'string' ? e['displayName'] : '';
        const tags: Record<string, string | boolean> = {};
        const rawTags = e['tags'];
        if (Array.isArray(rawTags)) {
          for (const t of rawTags) {
            if (typeof t !== 'object' || t === null) continue;
            const tag = t as Record<string, unknown>;
            const key = typeof tag['key'] === 'string' ? tag['key'] : '';
            if (!key) continue;
            const value = tag['value'];
            tags[key] = typeof value === 'string' ? value : true;
          }
        }

        const record: EntityRecord = {
          id: eid,
          name,
          type: etype,
          properties: (typeof e['properties'] === 'object' && e['properties'] !== null
            ? e['properties'] as Record<string, unknown>
            : {}),
          tags,
        };

        this._entities.set(eid, record);
        const typeIds = this._entityTypeIndex.get(etype) ?? [];
        typeIds.push(eid);
        this._entityTypeIndex.set(etype, typeIds);

        // Name index (lowercase, multiple entities can share names)
        const lowerName = name.toLowerCase();
        const nameIds = this._entityNameIndex.get(lowerName) ?? [];
        nameIds.push(eid);
        this._entityNameIndex.set(lowerName, nameIds);
      }
    }
  }

  async findEntity(name: string, entityType?: string): Promise<EntityRecord | undefined> {
    await this.loadEntities(entityType);
    if (!this._entities) return undefined;

    const lower = name.toLowerCase();

    // Exact match
    const exactIds = this._entityNameIndex.get(lower);
    if (exactIds) {
      let ids = exactIds;
      if (entityType) {
        ids = ids.filter((id) => this._entities?.get(id)?.type === entityType);
      }
      if (ids.length > 0) {
        return this._entities.get(ids[0]!);
      }
    }

    // Contains / fuzzy match
    let best: EntityRecord | undefined;
    let bestScore = 0;

    for (const [idxName, ids] of this._entityNameIndex) {
      let filteredIds = ids;
      if (entityType) {
        filteredIds = ids.filter((id) => this._entities?.get(id)?.type === entityType);
      }
      if (filteredIds.length === 0) continue;

      let score: number;
      if (lower.includes(idxName) || idxName.includes(lower)) {
        score = 0.8;
      } else {
        const nameTokens = DTEnvironmentRegistry.tokenize(lower);
        const idxTokens = DTEnvironmentRegistry.tokenize(idxName);
        score = this.tokenSimilarity(nameTokens, idxTokens);
      }

      if (score > bestScore) {
        bestScore = score;
        best = this._entities.get(filteredIds[0]!);
      }
    }

    return bestScore >= 0.5 ? best : undefined;
  }

  async findEntitiesByType(entityType: string): Promise<EntityRecord[]> {
    await this.loadEntities(entityType);
    const ids = this._entityTypeIndex.get(entityType) ?? [];
    return ids.map((eid) => this._entities?.get(eid)).filter((e): e is EntityRecord => e !== undefined);
  }

  async entityExists(name: string, entityType?: string): Promise<boolean> {
    const entity = await this.findEntity(name, entityType);
    return entity !== undefined;
  }

  async resolveServiceName(nrName: string): Promise<[string | undefined, number]> {
    const entity = await this.findEntity(nrName, 'SERVICE');
    if (entity) {
      const lowerNr = nrName.toLowerCase();
      const lowerDt = entity.name.toLowerCase();
      if (lowerNr === lowerDt) {
        return [entity.id, 1.0];
      } else if (lowerNr.includes(lowerDt) || lowerDt.includes(lowerNr)) {
        return [entity.id, 0.8];
      } else {
        return [entity.id, 0.5];
      }
    }
    return [undefined, 0.0];
  }

  // --- Dashboard Registry --------------------------------------------------

  async loadDashboards(): Promise<void> {
    if (this._dashboards !== undefined) return;

    this._dashboards = new Map();
    this._dashboardNameIndex = new Map();

    const url = `${this.platformUrl}/platform/document/v1/documents?filter=type%3D%3D'dashboard'&page-size=500`;
    let data = await this.apiGet(url, 'platform');
    if (!data) return;

    const indexDocuments = (documents: unknown[]): void => {
      for (const doc of documents) {
        if (typeof doc !== 'object' || doc === null) continue;
        const d = doc as Record<string, unknown>;
        const docId = typeof d['id'] === 'string' ? d['id'] : '';
        const docName = typeof d['name'] === 'string' ? d['name'] : '';
        const record: DashboardRecord = {
          id: docId,
          name: docName,
          owner: typeof d['owner'] === 'string' ? d['owner'] : '',
          modificationInfo: (typeof d['modificationInfo'] === 'object' && d['modificationInfo'] !== null
            ? d['modificationInfo'] as Record<string, unknown>
            : {}),
        };
        this._dashboards!.set(docId, record);
        const lower = docName.toLowerCase();
        const nameIds = this._dashboardNameIndex.get(lower) ?? [];
        nameIds.push(docId);
        this._dashboardNameIndex.set(lower, nameIds);
      }
    };

    const docs = data['documents'];
    if (Array.isArray(docs)) indexDocuments(docs);

    // Handle pagination
    while (typeof data['nextPageKey'] === 'string' && data['nextPageKey']) {
      const nextKey = data['nextPageKey'] as string;
      const nextUrl = `${this.platformUrl}/platform/document/v1/documents?nextPageKey=${encodeURIComponent(nextKey)}`;
      data = await this.apiGet(nextUrl, 'platform');
      if (!data) break;
      const moreDocs = data['documents'];
      if (Array.isArray(moreDocs)) indexDocuments(moreDocs);
    }
  }

  async dashboardExists(name: string): Promise<string | undefined> {
    await this.loadDashboards();
    const lower = name.toLowerCase();
    const ids = this._dashboardNameIndex.get(lower);
    return ids && ids.length > 0 ? ids[0] : undefined;
  }

  async findDashboard(name: string): Promise<DashboardRecord | undefined> {
    await this.loadDashboards();
    if (!this._dashboards) return undefined;

    const lower = name.toLowerCase();

    // Exact
    const exactIds = this._dashboardNameIndex.get(lower);
    if (exactIds && exactIds.length > 0) {
      return this._dashboards.get(exactIds[0]!);
    }

    // Fuzzy
    let best: DashboardRecord | undefined;
    let bestScore = 0;
    for (const [dashName, ids] of this._dashboardNameIndex) {
      let score: number;
      if (lower.includes(dashName) || dashName.includes(lower)) {
        score = 0.8;
      } else {
        score = this.tokenSimilarity(DTEnvironmentRegistry.tokenize(lower), DTEnvironmentRegistry.tokenize(dashName));
      }
      if (score > bestScore) {
        bestScore = score;
        best = this._dashboards.get(ids[0]!);
      }
    }

    return bestScore >= 0.6 ? best : undefined;
  }

  async listDashboards(): Promise<DashboardRecord[]> {
    await this.loadDashboards();
    return this._dashboards ? [...this._dashboards.values()] : [];
  }

  // --- Management Zone Registry --------------------------------------------

  async loadManagementZones(): Promise<void> {
    if (this._mgmtZones !== undefined) return;

    this._mgmtZones = new Map();
    this._mgmtZoneNameIndex = new Map();

    const url = `${this.liveUrl}/api/v2/settings/objects?schemaIds=builtin:management-zones&pageSize=500`;
    const items = await this.paginate(url, 'items');

    for (const item of items) {
      const objId = typeof item['objectId'] === 'string' ? item['objectId'] : '';
      const value = typeof item['value'] === 'object' && item['value'] !== null
        ? item['value'] as Record<string, unknown>
        : {};
      const mzName = typeof value['name'] === 'string' ? value['name'] : '';
      const rules = Array.isArray(value['rules']) ? value['rules'] : [];

      const record: ManagementZoneRecord = { id: objId, name: mzName, rules };
      this._mgmtZones.set(objId, record);
      this._mgmtZoneNameIndex.set(mzName.toLowerCase(), objId);
    }
  }

  async findManagementZone(name: string): Promise<ManagementZoneRecord | undefined> {
    await this.loadManagementZones();
    if (!this._mgmtZones) return undefined;

    const lower = name.toLowerCase();

    const exactId = this._mgmtZoneNameIndex.get(lower);
    if (exactId) return this._mgmtZones.get(exactId);

    // Fuzzy
    let best: ManagementZoneRecord | undefined;
    let bestScore = 0;
    for (const [mzName, mzId] of this._mgmtZoneNameIndex) {
      let score: number;
      if (lower.includes(mzName) || mzName.includes(lower)) {
        score = 0.8;
      } else {
        score = this.tokenSimilarity(DTEnvironmentRegistry.tokenize(lower), DTEnvironmentRegistry.tokenize(mzName));
      }
      if (score > bestScore) {
        bestScore = score;
        best = this._mgmtZones.get(mzId);
      }
    }

    return bestScore >= 0.5 ? best : undefined;
  }

  async listManagementZones(): Promise<ManagementZoneRecord[]> {
    await this.loadManagementZones();
    return this._mgmtZones ? [...this._mgmtZones.values()] : [];
  }

  // --- Synthetic Location Registry -----------------------------------------

  async loadSyntheticLocations(): Promise<void> {
    if (this._synthLocations !== undefined) return;

    this._synthLocations = new Map();
    this._synthLocationNameIndex = new Map();

    for (const locType of ['PUBLIC', 'PRIVATE']) {
      const url = `${this.liveUrl}/api/v2/synthetic/locations?type=${locType}`;
      const data = await this.apiGet(url);
      if (data) {
        const locations = data['locations'];
        if (Array.isArray(locations)) {
          for (const loc of locations) {
            if (typeof loc === 'object' && loc !== null) {
              this.indexSynthLocation(loc as Record<string, unknown>);
            }
          }
        }
      }
    }
  }

  private indexSynthLocation(loc: Record<string, unknown>): void {
    const locId = typeof loc['entityId'] === 'string' ? loc['entityId'] : '';
    const name = typeof loc['name'] === 'string' ? loc['name'] : '';
    const city = typeof loc['city'] === 'string' ? loc['city'] : '';
    const locType = typeof loc['type'] === 'string' ? loc['type'] : '';

    const record: SyntheticLocationRecord = {
      id: locId,
      name,
      city,
      type: locType,
      countryCode: typeof loc['countryCode'] === 'string' ? loc['countryCode'] : '',
      regionCode: typeof loc['regionCode'] === 'string' ? loc['regionCode'] : '',
      cloudPlatform: typeof loc['cloudPlatform'] === 'string' ? loc['cloudPlatform'] : '',
      status: typeof loc['status'] === 'string' ? loc['status'] : '',
    };

    this._synthLocations!.set(locId, record);

    // Index by name and city
    for (const key of [name.toLowerCase(), city.toLowerCase()]) {
      if (key && !this._synthLocationNameIndex.has(key)) {
        this._synthLocationNameIndex.set(key, locId);
      }
    }
  }

  async findSyntheticLocation(nrLocation: string): Promise<SyntheticLocationRecord | undefined> {
    await this.loadSyntheticLocations();
    if (!this._synthLocations) return undefined;

    const lower = nrLocation.toLowerCase();

    // Direct match
    const directId = this._synthLocationNameIndex.get(lower);
    if (directId) return this._synthLocations.get(directId);

    // Extract city from NR format: "Columbus, OH, USA" -> "columbus"
    const cityPart = lower.split(',')[0]?.trim() ?? '';
    if (cityPart) {
      const cityId = this._synthLocationNameIndex.get(cityPart);
      if (cityId) return this._synthLocations.get(cityId);
    }

    // AWS region -> DT location
    const awsToCity: Record<string, string> = {
      us_east_1: 'n. virginia',
      us_east_2: 'ohio',
      us_west_1: 'n. california',
      us_west_2: 'oregon',
      eu_west_1: 'ireland',
      eu_west_2: 'london',
      eu_central_1: 'frankfurt',
      ap_southeast_1: 'singapore',
      ap_southeast_2: 'sydney',
      ap_northeast_1: 'tokyo',
      ap_south_1: 'mumbai',
      sa_east_1: 'sao paulo',
    };
    const nrClean = lower.replace(/^(aws_|azure_|gcp_)/, '');
    const mappedCity = awsToCity[nrClean];
    if (mappedCity) {
      const mappedId = this._synthLocationNameIndex.get(mappedCity);
      if (mappedId) return this._synthLocations.get(mappedId);
    }

    // Fuzzy token match
    let best: SyntheticLocationRecord | undefined;
    let bestScore = 0;
    const nrTokens = DTEnvironmentRegistry.tokenize(lower);
    for (const [locName, locId] of this._synthLocationNameIndex) {
      const locTokens = DTEnvironmentRegistry.tokenize(locName);
      const score = this.tokenSimilarity(nrTokens, locTokens);
      if (score > bestScore) {
        bestScore = score;
        best = this._synthLocations.get(locId);
      }
    }

    return bestScore >= 0.5 ? best : undefined;
  }

  async listSyntheticLocations(locType?: string): Promise<SyntheticLocationRecord[]> {
    await this.loadSyntheticLocations();
    if (!this._synthLocations) return [];
    const locs = [...this._synthLocations.values()];
    if (locType) return locs.filter((l) => l.type === locType);
    return locs;
  }

  // --- Shared utilities ----------------------------------------------------

  static tokenize(s: string): Set<string> {
    const tokens = new Set<string>();
    for (const part of s.split(/[._\s:]+/)) {
      if (part) tokens.add(part.toLowerCase());
    }
    return tokens;
  }

  tokenSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    const directOverlap = new Set([...tokensA].filter((t) => tokensB.has(t)));

    const synonymOverlap = new Set<string>();
    for (const ta of tokensA) {
      if (directOverlap.has(ta)) continue;
      const synonyms = SYNONYMS[ta];
      if (synonyms) {
        for (const tb of tokensB) {
          if (synonyms.has(tb)) {
            synonymOverlap.add(ta);
            break;
          }
        }
        if (synonymOverlap.has(ta)) continue;
      }
      // Also check reverse synonyms
      for (const tb of tokensB) {
        const tbSynonyms = SYNONYMS[tb];
        if (tbSynonyms && tbSynonyms.has(ta)) {
          synonymOverlap.add(ta);
          break;
        }
      }
    }

    const total = directOverlap.size + synonymOverlap.size * 0.8;
    const union = new Set([...tokensA, ...tokensB]);
    return union.size > 0 ? total / union.size : 0;
  }

  // --- Reporting -----------------------------------------------------------

  summary(): Record<string, number> {
    const s: Record<string, number> = {};
    if (this._metrics !== undefined) {
      s['metrics'] = this._metrics.size;
      let grail = 0;
      let classic = 0;
      for (const k of this._metrics) {
        if (k.startsWith('dt.')) grail++;
        else if (k.startsWith('builtin:')) classic++;
      }
      s['metrics_grail'] = grail;
      s['metrics_classic'] = classic;
    }
    if (this._entities !== undefined) {
      s['entities'] = this._entities.size;
      for (const [etype, ids] of this._entityTypeIndex) {
        s[`entities_${etype.toLowerCase()}`] = ids.length;
      }
    }
    if (this._dashboards !== undefined) {
      s['dashboards'] = this._dashboards.size;
    }
    if (this._mgmtZones !== undefined) {
      s['management_zones'] = this._mgmtZones.size;
    }
    if (this._synthLocations !== undefined) {
      s['synthetic_locations'] = this._synthLocations.size;
    }
    if (this._loadErrors.length > 0) {
      s['load_errors'] = this._loadErrors.length;
    }
    return s;
  }

  printSummary(): void {
    const s = this.summary();
    if (Object.keys(s).length === 0) {
      logger.info('Registry: nothing loaded yet');
      return;
    }

    logger.info('DT Environment Registry:');
    if (s['metrics'] !== undefined) {
      logger.info({ metrics: s['metrics'], grail: s['metrics_grail'], classic: s['metrics_classic'] }, 'Metrics');
    }
    if (s['entities'] !== undefined) {
      const typeEntries: string[] = [];
      for (const [key, val] of Object.entries(s)) {
        if (key.startsWith('entities_')) {
          typeEntries.push(`${val} ${key.replace('entities_', '')}`);
        }
      }
      logger.info({ entities: s['entities'], types: typeEntries.join(', ') }, 'Entities');
    }
    if (s['dashboards'] !== undefined) {
      logger.info({ dashboards: s['dashboards'] }, 'Dashboards');
    }
    if (s['management_zones'] !== undefined) {
      logger.info({ management_zones: s['management_zones'] }, 'Management Zones');
    }
    if (s['synthetic_locations'] !== undefined) {
      logger.info({ synthetic_locations: s['synthetic_locations'] }, 'Synthetic Locations');
    }
    if (s['load_errors'] !== undefined) {
      logger.warn({ load_errors: s['load_errors'] }, 'Load errors');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple hash for DQL validation cache keys. */
function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}
