/**
 * SLO audit and migration for Dynatrace.
 *
 * Audits existing Dynatrace Gen3 Platform SLOs by evaluating their live status
 * and dynamically validating every metric in their DQL against the environment's
 * actual metric registry.
 *
 * Phase 1 - Evaluate: Fetch SLOs, check evaluation status (is it returning data?)
 * Phase 2 - Discover: Build metric registry from GET /api/v2/metrics (all dt.* metrics)
 * Phase 3 - Validate: Extract metric refs from DQL, check each against registry
 * Phase 4 - Fix: For invalid metrics, search for correct match and replace
 *
 * APIs used:
 *   Platform SLO API: /platform/slo/v1/slos on .apps. domain (Bearer OAuth)
 *   Metrics v2 API:   /api/v2/metrics on .live. domain (Bearer OAuth or Api-Token)
 */

import axios, { type AxiosRequestConfig } from 'axios';
import pino from 'pino';

import { DTEnvironmentRegistry } from './environment.js';

const logger = pino({ name: 'slo-auditor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SloAuditDetail {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly target: number;
  readonly evalStatus: string;
  readonly dql: string | undefined;
  readonly metrics: string[];
  readonly errors: string[];
  readonly warnings: string[];
  readonly fixedDql: string | undefined;
}

interface SloAuditResults {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  fixed: number;
  skipped: number;
  metricsChecked: number;
  metricsInvalid: number;
  details: SloAuditDetail[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Aggregations NOT valid in timeseries/makeTimeseries. */
const INVALID_TIMESERIES_AGGS = new Set(['takeLast', 'takeFirst', 'takeAny', 'collectArray', 'collectDistinct']);

/** Valid timeseries aggregations. */
const VALID_TIMESERIES_AGGS = new Set(['sum', 'avg', 'min', 'max', 'count', 'percentile', 'countDistinct', 'countIf']);

/** Semantic synonyms for fuzzy metric matching. */
const METRIC_SYNONYMS: Readonly<Record<string, ReadonlySet<string>>> = {
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
// SLOAuditor
// ---------------------------------------------------------------------------

export class SLOAuditor {
  readonly dtUrl: string;
  readonly platformUrl: string;
  readonly liveUrl: string;
  readonly oauthToken: string;
  readonly apiToken: string;
  readonly registry: DTEnvironmentRegistry;

  constructor(
    dtUrl: string,
    oauthToken: string,
    apiToken = '',
    registry?: DTEnvironmentRegistry,
  ) {
    this.dtUrl = dtUrl.replace(/\/+$/, '');
    this.platformUrl = this.dtUrl.replace('.live.', '.apps.');
    this.liveUrl = this.dtUrl.replace('.apps.', '.live.');
    this.oauthToken = oauthToken;
    this.apiToken = apiToken;
    this.registry = registry ?? new DTEnvironmentRegistry(dtUrl, oauthToken, apiToken);
  }

  // --- HTTP helpers --------------------------------------------------------

  async platformRequest(
    url: string,
    method: 'GET' | 'PUT' | 'POST' = 'GET',
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const config: AxiosRequestConfig = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.oauthToken}`,
        Accept: 'application/json',
      },
      timeout: 30_000,
      data: data ? data : undefined,
    };

    try {
      const resp = await axios(config);
      return resp.data as Record<string, unknown>;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const body = typeof err.response?.data === 'string'
          ? err.response.data.slice(0, 300)
          : JSON.stringify(err.response?.data ?? '').slice(0, 300);
        logger.warn({ statusCode: err.response?.status, body }, 'Platform API HTTP error');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ error: message }, 'Platform API error');
      }
      return undefined;
    }
  }

  // --- Delegate to shared registry -----------------------------------------

  async metricExists(metricKey: string): Promise<boolean> {
    return this.registry.metricExists(metricKey);
  }

  async findCorrectMetric(badMetric: string): Promise<string | undefined> {
    return this.registry.findMetric(badMetric);
  }

  // --- DQL parsing ---------------------------------------------------------

  extractMetricsFromDql(dql: string): string[] {
    const metrics: string[] = [];
    if (!dql) return metrics;

    // Pattern: agg(metric_key) or agg(metric_key, ...)
    const aggPattern =
      /(?:avg|sum|min|max|count|percentile|countIf|countDistinct)\s*\(\s*([a-zA-Z][a-zA-Z0-9._:]+)/g;
    let match: RegExpExecArray | null;
    while ((match = aggPattern.exec(dql)) !== null) {
      const key = (match[1] ?? '').trim();
      // Filter out DQL keywords and known non-metrics
      const nonMetrics = new Set(['duration', 'timestamp', 'start_time', 'true', 'false', 'null']);
      if (!nonMetrics.has(key) && !key.startsWith('dt.entity.') && key.includes('.')) {
        metrics.push(key);
      }
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const m of metrics) {
      if (!seen.has(m)) {
        seen.add(m);
        unique.push(m);
      }
    }

    return unique;
  }

  // --- SLO API -------------------------------------------------------------

  async fetchSlos(): Promise<Record<string, unknown>[]> {
    const slos: Record<string, unknown>[] = [];
    let url: string | undefined = `${this.platformUrl}/platform/slo/v1/slos?pageSize=500`;

    while (url) {
      const data = await this.platformRequest(url);
      if (!data) break;

      let items: unknown[];
      if (Array.isArray(data)) {
        items = data;
      } else {
        const sloList = data['slos'] ?? data['items'] ?? [];
        items = Array.isArray(sloList) ? sloList : [];
      }

      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          slos.push(item as Record<string, unknown>);
        }
      }

      const nextKey = data['nextPageKey'];
      url = typeof nextKey === 'string' && nextKey
        ? `${this.platformUrl}/platform/slo/v1/slos?nextPageKey=${nextKey}`
        : undefined;
    }

    return slos;
  }

  async fetchSloDetail(sloId: string): Promise<Record<string, unknown> | undefined> {
    const url = `${this.platformUrl}/platform/slo/v1/slos/${sloId}`;
    return this.platformRequest(url);
  }

  async updateSlo(sloId: string, payload: Record<string, unknown>): Promise<boolean> {
    const url = `${this.platformUrl}/platform/slo/v1/slos/${sloId}`;
    const result = await this.platformRequest(url, 'PUT', payload);
    return result !== undefined;
  }

  // --- Validation ----------------------------------------------------------

  async validateDql(dql: string): Promise<[string[], string[], string]> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let fixed = dql;

    if (!dql || !dql.trim()) {
      return [errors, warnings, fixed];
    }

    // --- Phase 1: Validate metric keys against live registry ---
    const metrics = this.extractMetricsFromDql(dql);

    for (const metricKey of metrics) {
      if (metricKey.startsWith('builtin:')) {
        // Classic metric selector in DQL -- definitely wrong
        const correct = await this.findCorrectMetric(metricKey);
        if (correct) {
          errors.push(`Classic metric '${metricKey}' -> Grail: '${correct}'`);
          fixed = fixed.replace(metricKey, correct);
        } else {
          errors.push(
            `Classic metric '${metricKey}' has no Grail equivalent -- check Built-in Metrics on Grail docs`,
          );
        }
      } else if (metricKey.startsWith('dt.')) {
        const exists = await this.metricExists(metricKey);
        if (!exists) {
          const correct = await this.findCorrectMetric(metricKey);
          if (correct) {
            const info = await this.registry.getMetricInfo(correct);
            const display = info?.displayName ?? '';
            errors.push(`Metric not found: '${metricKey}' -> suggested: '${correct}' (${display})`);
            fixed = fixed.replace(metricKey, correct);
          } else {
            errors.push(`Metric not found: '${metricKey}' -- no close match in environment`);
          }
        }
      } else if (
        metricKey.includes('.') &&
        !metricKey.startsWith('calc:') &&
        !metricKey.startsWith('ext:') &&
        !metricKey.startsWith('legacy.')
      ) {
        warnings.push(`Unknown metric prefix: '${metricKey}' -- expected dt.* for Grail metrics`);
      }
    }

    // --- Phase 2: DQL syntax checks ---
    const isTimeseries = /\btimeseries\b/i.test(dql);
    const isMakeTimeseries = /\bmakeTimeseries\b/i.test(dql);

    // Invalid aggregations in timeseries context
    if (isTimeseries || isMakeTimeseries) {
      for (const badAgg of INVALID_TIMESERIES_AGGS) {
        const pattern = new RegExp(`\\b${badAgg}\\s*\\(`, 'g');
        if (pattern.test(dql)) {
          errors.push(`'${badAgg}()' not valid in timeseries -- use avg(), sum(), or max()`);
          fixed = fixed.replace(new RegExp(`\\b${badAgg}\\s*\\(`, 'g'), 'avg(');
        }
      }
    }

    // NRQL syntax leftovers
    const nrChecks: [RegExp, string][] = [
      [/\bFROM\s+\w+\s+SELECT\b/i, 'Contains NRQL syntax (FROM ... SELECT)'],
      [/\bSELECT\s+/i, 'Contains NRQL SELECT keyword'],
      [/\bFACET\s+/i, "Contains NRQL FACET -- should be 'by:'"],
      [/\bSINCE\s+\d/i, "Contains NRQL SINCE -- should be 'from:'"],
    ];
    for (const [pattern, message] of nrChecks) {
      if (pattern.test(dql)) {
        errors.push(message);
      }
    }

    // Single quotes -> double quotes
    if (/==\s*'[^']*'/.test(dql)) {
      warnings.push('Single quotes for string comparison -- DQL uses double quotes');
      fixed = fixed.replace(/==\s*'([^']*)'/g, '== "$1"');
    }

    // fieldsRename after makeTimeseries
    if (isMakeTimeseries && dql.includes('fieldsRename')) {
      const mtPos = dql.toLowerCase().indexOf('maketimeseries');
      const frPos = dql.toLowerCase().indexOf('fieldsrename');
      if (frPos > mtPos) {
        errors.push('fieldsRename cannot follow makeTimeseries');
        fixed = fixed.replace(/\|\s*fieldsRename\s+[^\n]+/, '');
      }
    }

    // Gen3 SLOs should produce an 'sli' field
    if (!dql.includes('sli') && (isTimeseries || isMakeTimeseries)) {
      warnings.push("Gen3 SLO DQL should produce an 'sli' field");
    }

    // Double dots in metric keys
    const metricKeyMatches = dql.match(/dt\.[a-zA-Z0-9._]+/g) ?? [];
    for (const metric of metricKeyMatches) {
      if (metric.includes('..')) {
        errors.push(`Double dot in metric name: '${metric}'`);
      }
    }

    return [errors, warnings, fixed];
  }

  // --- Main audit flow -----------------------------------------------------

  async audit(fix = false): Promise<SloAuditResults> {
    logger.info({ phase: 'Gen3 Platform -- Live Metric Validation' }, 'SLO DQL audit starting');

    // --- Phase 1: Fetch SLOs ---
    logger.info({ platformUrl: this.platformUrl }, 'Fetching Platform SLOs');
    const slos = await this.fetchSlos();
    logger.info({ count: slos.length }, 'Found Gen3 Platform SLOs');

    if (slos.length === 0) {
      logger.warn(
        { hint: 'Check OAuth token has slo:slos:read scope and URL resolves to .apps.dynatrace.com' },
        'No SLOs found',
      );
      return { total: 0, valid: 0, warnings: 0, errors: 0, fixed: 0, skipped: 0, metricsChecked: 0, metricsInvalid: 0, details: [] };
    }

    // --- Phase 2: Build metric registry ---
    logger.info('Loading metric registry from environment');
    await this.registry.loadMetrics();

    const allMetrics = await this.registry.getAllMetrics('');
    if (allMetrics.size === 0) {
      logger.warn(
        { hint: 'Check Api-Token has metrics.read scope, or OAuth has metric read permissions' },
        'Could not load metric registry -- metric validation will be skipped',
      );
    } else {
      let grail = 0;
      let classic = 0;
      for (const k of allMetrics) {
        if (k.startsWith('dt.')) grail++;
        else if (k.startsWith('builtin:')) classic++;
      }
      logger.info({ total: allMetrics.size, grail, classic }, 'Registry loaded');
    }

    // --- Phase 3: Evaluate each SLO ---
    const results: SloAuditResults = {
      total: slos.length,
      valid: 0,
      warnings: 0,
      errors: 0,
      fixed: 0,
      skipped: 0,
      metricsChecked: 0,
      metricsInvalid: 0,
      details: [],
    };

    for (const slo of slos) {
      const sloId = String(slo['id'] ?? slo['objectId'] ?? 'unknown');
      const sloName = String(slo['name'] ?? 'Unnamed');

      const sloStatus = String(slo['status'] ?? slo['evaluationStatus'] ?? '');

      // Get full SLO detail
      const detail = await this.fetchSloDetail(sloId);
      if (!detail) {
        results.skipped += 1;
        results.details.push({
          id: sloId,
          name: sloName,
          status: 'SKIP',
          target: 0,
          evalStatus: '',
          dql: undefined,
          metrics: [],
          errors: ['Could not fetch SLO detail'],
          warnings: [],
          fixedDql: undefined,
        });
        continue;
      }

      // Extract DQL indicator
      const customSli = detail['customSli'];
      let dqlIndicator = '';
      if (typeof customSli === 'object' && customSli !== null && !Array.isArray(customSli)) {
        const indicator = (customSli as Record<string, unknown>)['indicator'];
        dqlIndicator = typeof indicator === 'string' ? indicator : '';
      }

      const templateSli = detail['templateSli'];

      // Get target from criteria
      const criteria = detail['criteria'];
      let target = 0;
      if (Array.isArray(criteria) && criteria.length > 0) {
        const firstCriteria = criteria[0] as Record<string, unknown> | undefined;
        target = typeof firstCriteria?.['target'] === 'number' ? firstCriteria['target'] : 0;
      }

      // Get evaluation info from detail
      const evalStatus = String(detail['status'] ?? detail['evaluationStatus'] ?? sloStatus);
      const evalError = detail['error'] ?? detail['evaluationError'];

      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      let fixedDql = dqlIndicator;

      // Flag if SLO evaluation is erroring
      if (evalError) {
        allErrors.push(`SLO evaluation error: ${String(evalError).slice(0, 200)}`);
      }

      if (evalStatus && ['ERROR', 'FAILURE', 'NO_DATA'].includes(evalStatus.toUpperCase())) {
        allErrors.push(`SLO evaluation status: ${evalStatus}`);
      }

      if (dqlIndicator) {
        // Full DQL validation with live metric checking
        const [errs, warns, fixed] = await this.validateDql(dqlIndicator);

        // Track metrics stats
        const metricsInSlo = this.extractMetricsFromDql(dqlIndicator);
        results.metricsChecked += metricsInSlo.length;
        for (const m of metricsInSlo) {
          if (m.startsWith('dt.') && !(await this.metricExists(m))) {
            results.metricsInvalid += 1;
          } else if (m.startsWith('builtin:')) {
            results.metricsInvalid += 1;
          }
        }

        allErrors.push(...errs);
        allWarnings.push(...warns);
        fixedDql = fixed;
      } else if (typeof templateSli === 'object' && templateSli !== null) {
        const tpl = templateSli as Record<string, unknown>;
        const templateId = String(tpl['templateId'] ?? tpl['id'] ?? 'unknown');
        allWarnings.push(`Template-based SLO (template: ${templateId})`);
      } else {
        allWarnings.push('No DQL indicator found');
      }

      // --- Determine status ---
      let status: string;
      if (allErrors.length > 0) {
        status = 'ERROR';
        results.errors += 1;
      } else if (allWarnings.length > 0) {
        status = 'WARNING';
        results.warnings += 1;
      } else {
        status = 'VALID';
        results.valid += 1;
      }

      // --- Log result ---
      if (status === 'ERROR') {
        logger.error({ sloId: sloId.slice(0, 30), name: sloName, target }, 'SLO audit error');
        for (const e of allErrors) {
          logger.error({ error: e }, 'SLO error detail');
        }
        for (const w of allWarnings) {
          logger.warn({ warning: w }, 'SLO warning detail');
        }

        // Show which metrics were found in DQL
        if (dqlIndicator) {
          const metricsFound = this.extractMetricsFromDql(dqlIndicator);
          if (metricsFound.length > 0) {
            for (const m of metricsFound) {
              const exists = m.startsWith('dt.') ? await this.metricExists(m) : false;
              const info = await this.registry.getMetricInfo(m);
              const display = info?.displayName ?? '';
              const suffix = display ? ` (${display})` : '';
              logger.info(
                { status: exists ? 'OK' : 'MISSING', metric: m, displayName: suffix },
                'Metric status',
              );
            }
          }
        }

        // Auto-fix
        if (fix && fixedDql !== dqlIndicator && dqlIndicator) {
          logger.info({ sloId }, 'Auto-fixing DQL indicator');

          const updatePayload: Record<string, unknown> = {
            name: detail['name'] ?? sloName,
            customSli: { indicator: fixedDql },
          };
          if (detail['criteria']) updatePayload['criteria'] = detail['criteria'];
          if (detail['description']) updatePayload['description'] = detail['description'];
          if (detail['tags']) updatePayload['tags'] = detail['tags'];
          if (detail['segments']) updatePayload['segments'] = detail['segments'];

          const updated = await this.updateSlo(sloId, updatePayload);
          if (updated) {
            logger.info({ sloId }, 'SLO fixed');
            results.fixed += 1;

            // Show what changed
            const oldMetrics = new Set(this.extractMetricsFromDql(dqlIndicator));
            const newMetrics = new Set(this.extractMetricsFromDql(fixedDql));
            for (const oldM of oldMetrics) {
              if (newMetrics.has(oldM)) continue;
              const replacement = [...newMetrics]
                .filter((n) => !oldMetrics.has(n))
                .find((n) => n.split('.').slice(0, 2).join('.') === oldM.split('.').slice(0, 2).join('.'));
              if (replacement) {
                logger.info({ old: oldM, new: replacement }, 'Metric replaced');
              }
            }
          } else {
            logger.error(
              { sloId },
              'SLO fix failed -- update manually in Service-Level Objectives app',
            );
          }
        }
      } else if (status === 'WARNING') {
        logger.warn({ sloId: sloId.slice(0, 30), name: sloName }, 'SLO audit warning');
        for (const w of allWarnings) {
          logger.warn({ warning: w }, 'SLO warning detail');
        }
      }

      results.details.push({
        id: sloId,
        name: sloName,
        status,
        target,
        evalStatus,
        dql: dqlIndicator ? dqlIndicator.slice(0, 300) : undefined,
        metrics: dqlIndicator ? this.extractMetricsFromDql(dqlIndicator) : [],
        errors: allErrors,
        warnings: allWarnings,
        fixedDql: fixedDql !== dqlIndicator ? fixedDql.slice(0, 300) : undefined,
      });
    }

    // --- Summary ---
    logger.info(
      { total: results.total, valid: results.valid, warnings: results.warnings, errors: results.errors },
      'SLO audit complete',
    );
    if (results.skipped) {
      logger.info({ count: results.skipped }, 'SLOs skipped');
    }
    logger.info({ checked: results.metricsChecked, invalid: results.metricsInvalid }, 'Metrics summary');
    if (fix) {
      logger.info({ count: results.fixed }, 'SLOs fixed');
    }

    if (results.errors > 0 && !fix) {
      logger.info({ fixable: results.errors }, 'Run with --fix-slos to auto-fix broken SLOs');
    }

    return results;
  }
}

export { INVALID_TIMESERIES_AGGS, VALID_TIMESERIES_AGGS, METRIC_SYNONYMS };
export type { SloAuditDetail, SloAuditResults };
