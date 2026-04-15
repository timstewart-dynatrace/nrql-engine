/**
 * Tests for all transformer classes:
 * - DashboardTransformer
 * - AlertTransformer + NotificationTransformer
 * - SyntheticTransformer + SyntheticScriptConverter
 * - SLOTransformer
 * - WorkloadTransformer
 *
 * Ported from Python: tests/unit/test_transformers.py
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DashboardTransformer,
  AlertTransformer,
  NotificationTransformer,
  LegacyNotificationTransformer,
  SyntheticTransformer,
  SyntheticScriptConverter,
  SLOTransformer,
  WorkloadTransformer,
} from '../../src/transformers/index.js';

// ═════════════════════════════════════════════════════════════════════════════
// DashboardTransformer
// ═════════════════════════════════════════════════════════════════════════════

describe('DashboardTransformer', () => {
  let dashboardTransformer: DashboardTransformer;

  beforeEach(() => {
    dashboardTransformer = new DashboardTransformer();
  });

  describe('DashboardTransformResult', () => {
    it('should default warnings and errors', () => {
      const nr = { name: 'Test', pages: [{ name: 'P', widgets: [] }] };
      const result = dashboardTransformer.transform(nr);
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('empty dashboard', () => {
    it('should fail with no pages', () => {
      const nr = { name: 'Test', pages: [] };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('no pages'))).toBe(true);
    });

    it('should fail with missing pages', () => {
      const nr = { name: 'Test' };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(false);
    });
  });

  describe('single page', () => {
    it('should transform single page dashboard', () => {
      const nr = {
        name: 'My Dashboard',
        permissions: 'PUBLIC_READ_ONLY',
        pages: [
          {
            name: 'Page 1',
            widgets: [],
          },
        ],
      };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      const dt = result.data![0]!;
      expect(dt.dashboardMetadata.name).toBe('My Dashboard');
      expect(dt.dashboardMetadata.shared).toBe(true);
      expect(dt.tiles).toBeDefined();
    });
  });

  describe('multi page', () => {
    it('should create separate dashboards per page', () => {
      const nr = {
        name: 'Multi',
        pages: [
          { name: 'Overview', widgets: [] },
          { name: 'Details', widgets: [] },
        ],
      };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]!.dashboardMetadata.name).toContain('Overview');
      expect(result.data![1]!.dashboardMetadata.name).toContain('Details');
    });
  });

  describe('widgets', () => {
    it('should transform markdown widget', () => {
      const nr = {
        name: 'Test',
        pages: [
          {
            name: 'Page',
            widgets: [
              {
                title: 'Notes',
                visualization: { id: 'viz.markdown' },
                rawConfiguration: { text: '# Hello' },
                layout: { column: 1, row: 1, width: 4, height: 3 },
              },
            ],
          },
        ],
      };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(true);
      const tiles = result.data![0]!.tiles;
      expect(tiles).toHaveLength(1);
      expect(tiles[0]!.tileType).toBe('MARKDOWN');
      expect(tiles[0]!.markdown).toBe('# Hello');
    });

    it('should transform chart widget with nrql', () => {
      const nr = {
        name: 'Test',
        pages: [
          {
            name: 'Page',
            widgets: [
              {
                title: 'Requests',
                visualization: { id: 'viz.line' },
                rawConfiguration: {
                  nrqlQueries: [
                    { query: 'SELECT count(*) FROM Transaction' },
                  ],
                },
                layout: { column: 1, row: 1, width: 6, height: 4 },
              },
            ],
          },
        ],
      };
      const result = dashboardTransformer.transform(nr);
      expect(result.success).toBe(true);
      const tiles = result.data![0]!.tiles;
      expect(tiles).toHaveLength(1);
      expect(tiles[0]!.tileType).toBe('DATA_EXPLORER');
      expect(tiles[0]!.queries![0]!.freeText).toBeTruthy(); // Has DQL
    });

    it('should transform billboard widget', () => {
      const nr = {
        name: 'Test',
        pages: [
          {
            name: 'Page',
            widgets: [
              {
                title: 'Total',
                visualization: { id: 'viz.billboard' },
                rawConfiguration: {
                  nrqlQueries: [
                    { query: 'SELECT count(*) FROM Transaction' },
                  ],
                },
                layout: { column: 1, row: 1, width: 3, height: 3 },
              },
            ],
          },
        ],
      };
      const result = dashboardTransformer.transform(nr);
      const tiles = result.data![0]!.tiles;
      expect(tiles[0]!.tileType).toBe('DATA_EXPLORER');
    });
  });

  describe('layout', () => {
    it('should convert layout to pixel bounds', () => {
      // Access private method for testing
      const layout = { column: 1, row: 1, width: 6, height: 4 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bounds = (dashboardTransformer as any).transformLayout(layout);
      expect(bounds.top).toBe(0);
      expect(bounds.left).toBe(0);
      expect(bounds.width).toBe(6 * 38 * 2);
      expect(bounds.height).toBe(4 * 38 * 2);
    });

    it('should handle offset position', () => {
      const layout = { column: 7, row: 3, width: 6, height: 4 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bounds = (dashboardTransformer as any).transformLayout(layout);
      expect(bounds.left).toBe(6 * 38 * 2); // column 7 is index 6
      expect(bounds.top).toBe(2 * 38 * 2); // row 3 is index 2
    });
  });

  describe('permissions', () => {
    it('should map public read only', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dashboardTransformer as any).mapPermissions('PUBLIC_READ_ONLY')).toBe(true);
    });

    it('should map public read write', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dashboardTransformer as any).mapPermissions('PUBLIC_READ_WRITE')).toBe(true);
    });

    it('should map private', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dashboardTransformer as any).mapPermissions('PRIVATE')).toBe(false);
    });

    it('should default none to false', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dashboardTransformer as any).mapPermissions(undefined)).toBe(false);
    });
  });

  describe('variables', () => {
    it('should transform variables to filters', () => {
      const variables = [{ name: 'env', type: 'string' }, { name: 'app', type: 'nrql' }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (dashboardTransformer as any).transformVariables(variables);
      expect(result.genericTagFilters).toHaveLength(2);
      expect(result.genericTagFilters[0].name).toBe('env');
    });
  });

  describe('transform all', () => {
    it('should transform multiple dashboards', () => {
      const dashboards = [
        { name: 'D1', pages: [{ name: 'P1', widgets: [] }] },
        { name: 'D2', pages: [{ name: 'P1', widgets: [] }] },
      ];
      const results = dashboardTransformer.transformAll(dashboards);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AlertTransformer
// ═════════════════════════════════════════════════════════════════════════════

describe('AlertTransformer', () => {
  let alertTransformer: AlertTransformer;

  beforeEach(() => {
    alertTransformer = new AlertTransformer();
  });

  describe('AlertTransformResult', () => {
    it('should default lists', () => {
      const policy = { name: 'Test Policy', conditions: [] };
      const result = alertTransformer.transform(policy);
      expect(result.success).toBe(true);
      expect(result.data!.metricEvents).toEqual([]);
      expect(result.warnings).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('policy transform', () => {
    it('should transform empty policy', () => {
      const policy = { name: 'Test Policy', id: '123', conditions: [] };
      const result = alertTransformer.transform(policy);
      expect(result.success).toBe(true);
      expect(result.data!.alertingProfile).toBeDefined();
      expect((result.data!.alertingProfile as Record<string, unknown>).name).toContain('[Migrated]');
      expect(result.data!.metricEvents).toEqual([]);
    });

    it('should transform with nrql condition', () => {
      const policy = {
        name: 'Test Policy',
        id: '123',
        conditions: [
          {
            name: 'High Error Rate',
            conditionType: 'NRQL',
            nrql: { query: 'SELECT count(*) FROM TransactionError' },
            signal: { aggregationWindow: 60 },
            terms: [
              {
                priority: 'critical',
                operator: 'ABOVE',
                threshold: 10,
                thresholdDuration: 300,
              },
            ],
            enabled: true,
          },
        ],
      };
      const result = alertTransformer.transform(policy);
      expect(result.success).toBe(true);
      expect(result.data!.metricEvents).toHaveLength(1);
      const event = result.data!.metricEvents[0]!;
      expect((event.summary as string).startsWith('[Migrated]')).toBe(true);
      expect(event.enabled).toBe(true);
      expect((event.monitoringStrategy as Record<string, unknown>).threshold).toBe(10);
      expect((event.monitoringStrategy as Record<string, unknown>).alertCondition).toBe('ABOVE');
    });

    it('should create placeholder for non nrql condition', () => {
      const policy = {
        name: 'Test',
        conditions: [
          { name: 'APM Cond', conditionType: 'APM' },
        ],
      };
      const result = alertTransformer.transform(policy);
      expect(result.success).toBe(true);
      expect(result.data!.metricEvents).toHaveLength(1);
      expect(result.data!.metricEvents[0]!.enabled).toBe(false);
    });
  });

  describe('monitoring strategy', () => {
    it('should build default strategy', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const strategy = (alertTransformer as any).buildMonitoringStrategy([], 60, '', []);
      expect(strategy.type).toBe('STATIC_THRESHOLD');
      expect(strategy.alertCondition).toBe('ABOVE');
    });

    it('should use critical term', () => {
      const terms = [
        { priority: 'warning', operator: 'ABOVE', threshold: 5 },
        { priority: 'critical', operator: 'BELOW', threshold: 100 },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const strategy = (alertTransformer as any).buildMonitoringStrategy(terms, 60, '', []);
      expect(strategy.alertCondition).toBe('BELOW');
      expect(strategy.threshold).toBe(100);
    });

    it('should handle at least once occurrences', () => {
      const terms = [
        {
          priority: 'critical',
          operator: 'ABOVE',
          threshold: 10,
          thresholdDuration: 300,
          thresholdOccurrences: 'AT_LEAST_ONCE',
        },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const strategy = (alertTransformer as any).buildMonitoringStrategy(terms, 60, '', []);
      expect(strategy.violatingSamples).toBe(1);
    });
  });

  describe('extract metric', () => {
    it('should extract duration metric', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metric = (alertTransformer as any).extractMetricFromNrql(
        'SELECT average(duration) FROM Transaction',
      );
      expect(metric).toBe('builtin:service.response.time');
    });

    it('should extract error metric', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metric = (alertTransformer as any).extractMetricFromNrql(
        'SELECT count(*) FROM TransactionError',
      );
      expect(metric).toBe('builtin:service.errors.total.rate');
    });

    it('should extract cpu metric', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metric = (alertTransformer as any).extractMetricFromNrql(
        'SELECT average(cpuPercent) FROM SystemSample',
      );
      expect(metric).toBe('builtin:host.cpu.usage');
    });

    it('should return undefined for unknown', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metric = (alertTransformer as any).extractMetricFromNrql(
        'SELECT count(*) FROM CustomEvent',
      );
      expect(metric).toBeUndefined();
    });
  });

  describe('transform all', () => {
    it('should transform multiple policies', () => {
      const policies = [
        { name: 'P1', conditions: [] },
        { name: 'P2', conditions: [] },
      ];
      const results = alertTransformer.transformAll(policies);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

// ─── NotificationTransformer ────────────────────────────────────────────────

describe('NotificationTransformer (Gen3 Workflow tasks)', () => {
  let notifTransformer: NotificationTransformer;

  beforeEach(() => {
    notifTransformer = new NotificationTransformer();
  });

  it('should emit email workflow task', () => {
    const result = notifTransformer.transform({
      name: 'Team Email',
      type: 'EMAIL',
      active: true,
      properties: [{ key: 'recipients', value: 'a@b.com,c@d.com' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.email:email-action');
    expect(result.data!.name).toBe('team_email');
    expect((result.data!.input.to as string[])).toContain('a@b.com');
    expect((result.data!.input.to as string[])).toContain('c@d.com');
  });

  it('should emit slack workflow task with channel and connection', () => {
    const result = notifTransformer.transform({
      name: 'Slack Alert',
      type: 'SLACK',
      properties: [
        { key: 'url', value: 'https://hooks.slack.com/xxx' },
        { key: 'channel', value: '#alerts' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.slack:slack-action');
    expect(result.data!.input.channel).toBe('#alerts');
    expect(result.data!.input.connection).toBe('https://hooks.slack.com/xxx');
  });

  it('should emit pagerduty workflow task', () => {
    const result = notifTransformer.transform({
      name: 'PD',
      type: 'PAGERDUTY',
      properties: [{ key: 'service_key', value: 'abc123' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.pagerduty:pagerduty-action');
    expect(result.data!.input.integrationKey).toBe('abc123');
  });

  it('should emit webhook via http action', () => {
    const result = notifTransformer.transform({
      name: 'Hook',
      type: 'WEBHOOK',
      properties: [{ key: 'base_url', value: 'https://example.com/hook' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.http:http-action');
    expect(result.data!.input.url).toBe('https://example.com/hook');
    expect(result.data!.input.method).toBe('POST');
  });

  it('should emit opsgenie via http action with GenieKey header', () => {
    const result = notifTransformer.transform({
      name: 'OG',
      type: 'OPSGENIE',
      properties: [{ key: 'api_key', value: 'ogkey' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.http:http-action');
    expect((result.data!.input.headers as Record<string, string>).Authorization).toBe(
      'GenieKey ogkey',
    );
  });

  it('should emit xmatters via http action', () => {
    const result = notifTransformer.transform({
      name: 'XM',
      type: 'XMATTERS',
      properties: [{ key: 'url', value: 'https://xm.example.com/inbound' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.http:http-action');
    expect(result.data!.input.url).toBe('https://xm.example.com/inbound');
  });

  it('should emit jira create-issue action', () => {
    const result = notifTransformer.transform({
      name: 'Jira',
      type: 'JIRA',
      properties: [
        { key: 'project', value: 'OPS' },
        { key: 'issue_type', value: 'Bug' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.jira:create-issue-action');
    expect(result.data!.input.projectKey).toBe('OPS');
    expect(result.data!.input.issueType).toBe('Bug');
  });

  it('should emit servicenow incident action', () => {
    const result = notifTransformer.transform({
      name: 'SNOW',
      type: 'SERVICENOW',
      properties: [{ key: 'instance', value: 'acme.service-now.com' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.servicenow:incident-action');
    expect(result.data!.input.instance).toBe('acme.service-now.com');
  });

  it('should emit teams via http action', () => {
    const result = notifTransformer.transform({
      name: 'Teams',
      type: 'TEAMS',
      properties: [{ key: 'url', value: 'https://outlook.office.com/webhook/xxx' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.http:http-action');
    expect(result.data!.input.url).toBe('https://outlook.office.com/webhook/xxx');
  });

  it('should emit victorops via http action', () => {
    const result = notifTransformer.transform({
      name: 'VO',
      type: 'VICTOROPS',
      properties: [{ key: 'url', value: 'https://alert.victorops.com/integrations/xxx' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe('dynatrace.http:http-action');
  });

  it('should fail unsupported type', () => {
    const result = notifTransformer.transform({
      name: 'Unknown',
      type: 'UNKNOWN_TYPE',
      properties: [],
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should sanitize task name', () => {
    const result = notifTransformer.transform({
      name: 'Team Email!! 1',
      type: 'EMAIL',
      properties: [{ key: 'recipients', value: 'a@b.com' }],
    });
    expect(result.data!.name).toBe('team_email_1');
  });
});

describe('LegacyNotificationTransformer (Gen2 classic problem notifications)', () => {
  let legacy: LegacyNotificationTransformer;

  beforeEach(() => {
    legacy = new LegacyNotificationTransformer();
  });

  it('should emit legacy warning on every channel', () => {
    const result = legacy.transform({
      name: 'E',
      type: 'EMAIL',
      properties: [{ key: 'recipients', value: 'x@y.com' }],
    });
    expect(result.warnings[0]).toContain('Gen2');
  });

  it('should transform email channel (classic)', () => {
    const result = legacy.transform({
      name: 'Team Email',
      type: 'EMAIL',
      active: true,
      properties: [{ key: 'recipients', value: 'a@b.com,c@d.com' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.integrationType).toBe('email');
    expect((result.data!.config.recipients as string[])).toContain('a@b.com');
    expect(result.data!.config.subject).toBe('[Dynatrace] {ProblemTitle}');
  });

  it('should transform slack channel (classic)', () => {
    const result = legacy.transform({
      name: 'Slack',
      type: 'SLACK',
      properties: [
        { key: 'url', value: 'https://hooks.slack.com/xxx' },
        { key: 'channel', value: '#alerts' },
      ],
    });
    expect(result.data!.integrationType).toBe('slack');
    expect(result.data!.config.channel).toBe('#alerts');
  });

  it('should transform webhook channel (classic)', () => {
    const result = legacy.transform({
      name: 'Hook',
      type: 'WEBHOOK',
      properties: [{ key: 'base_url', value: 'https://example.com/hook' }],
    });
    expect(result.data!.config.payload).toBe('{ProblemDetailsJSON}');
  });

  it('should fail unsupported type', () => {
    const result = legacy.transform({ name: 'X', type: 'UNKNOWN', properties: [] });
    expect(result.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SyntheticTransformer
// ═════════════════════════════════════════════════════════════════════════════

describe('SyntheticTransformer', () => {
  let syntheticTransformer: SyntheticTransformer;

  beforeEach(() => {
    syntheticTransformer = new SyntheticTransformer();
  });

  describe('SyntheticTransformResult', () => {
    it('should default lists', () => {
      const nr = {
        name: 'Test',
        monitorType: 'SIMPLE',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_5_MINUTES',
        status: 'ENABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.warnings).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('HTTP transform', () => {
    it('should transform simple ping monitor', () => {
      const nr = {
        name: 'Health Check',
        monitorType: 'SIMPLE',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_5_MINUTES',
        status: 'ENABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data!.monitorType).toBe('HTTP');
      const monitor = result.data!.monitor;
      expect(monitor.name).toBe('[Migrated] Health Check');
      expect(monitor.frequencyMin).toBe(5);
      expect(monitor.enabled).toBe(true);
      expect(monitor.type).toBe('HTTP');
      const script = monitor.script as { requests: Array<{ url: string }> };
      expect(script.requests[0]!.url).toBe('https://example.com');
    });

    it('should transform script api with warning', () => {
      const nr = {
        name: 'API Test',
        monitorType: 'SCRIPT_API',
        monitoredUrl: 'https://api.example.com',
        period: 'EVERY_15_MINUTES',
        status: 'ENABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data!.monitorType).toBe('HTTP');
      expect(result.warnings.some((w) => w.includes('scripted API') || w.includes('script'))).toBe(true);
    });

    it('should disable when status not enabled', () => {
      const nr = {
        name: 'Disabled',
        monitorType: 'SIMPLE',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_HOUR',
        status: 'DISABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.data!.monitor.enabled).toBe(false);
    });
  });

  describe('browser transform', () => {
    it('should transform browser monitor', () => {
      const nr = {
        name: 'Browser Test',
        monitorType: 'BROWSER',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_10_MINUTES',
        status: 'ENABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data!.monitorType).toBe('BROWSER');
      expect(result.data!.monitor.type).toBe('BROWSER');
      expect(result.data!.monitor.frequencyMin).toBe(10);
      const script = result.data!.monitor.script as { type: string; events: Array<{ url: string }> };
      expect(script.type).toBe('clickpath');
      expect(script.events[0]!.url).toBe('https://example.com');
    });

    it('should add warning for scripted browser', () => {
      const nr = {
        name: 'Scripted',
        monitorType: 'SCRIPT_BROWSER',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_15_MINUTES',
        status: 'ENABLED',
      };
      const result = syntheticTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data!.monitorType).toBe('BROWSER');
      expect(result.warnings.some((w) => w.toLowerCase().includes('scripted'))).toBe(true);
    });
  });

  describe('transform all', () => {
    it('should transform multiple monitors', () => {
      const monitors = [
        { name: 'M1', monitorType: 'SIMPLE', monitoredUrl: 'https://a.com', period: 'EVERY_MINUTE', status: 'ENABLED' },
        { name: 'M2', monitorType: 'BROWSER', monitoredUrl: 'https://b.com', period: 'EVERY_HOUR', status: 'ENABLED' },
      ];
      const results = syntheticTransformer.transformAll(monitors);
      expect(results).toHaveLength(2);
      const types = new Set(results.map((r) => r.data!.monitorType));
      expect(types.has('HTTP')).toBe(true);
      expect(types.has('BROWSER')).toBe(true);
    });
  });

  describe('custom locations', () => {
    it('should use provided locations', () => {
      const locations = ['LOC-1', 'LOC-2'];
      const transformer = new SyntheticTransformer(locations);
      const nr = {
        name: 'Test',
        monitorType: 'SIMPLE',
        monitoredUrl: 'https://example.com',
        period: 'EVERY_15_MINUTES',
        status: 'ENABLED',
      };
      const result = transformer.transform(nr);
      expect(result.data!.monitor.locations).toEqual(locations);
    });
  });
});

// ─── SyntheticScriptConverter ────────────────────────────────────────────────

describe('SyntheticScriptConverter', () => {
  it('should analyze simple script', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('$browser.get("https://example.com")');
    expect(analysis.hasNavigation).toBe(true);
    expect(analysis.complexity).toBe('simple');
  });

  it('should detect clicks', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('element.click()');
    expect(analysis.hasClicks).toBe(true);
  });

  it('should detect form input', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('element.sendKeys("hello")');
    expect(analysis.hasFormInput).toBe(true);
  });

  it('should detect assertions', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('assert(title === "Home")');
    expect(analysis.hasAssertions).toBe(true);
  });

  it('should detect custom logic', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('async function test() {}');
    expect(analysis.hasCustomLogic).toBe(true);
  });

  it('should rate complex script as high effort', () => {
    const script = `
      $browser.get("https://example.com")
      element.click()
      input.sendKeys("test")
      assert(result === true)
      async function validate() {}
    `;
    const analysis = SyntheticScriptConverter.analyzeScript(script);
    expect(analysis.complexity).toBe('complex');
    expect(analysis.estimatedEffort).toBe('high');
  });

  it('should handle empty script', () => {
    const analysis = SyntheticScriptConverter.analyzeScript('');
    expect(analysis.complexity).toBe('simple');
    expect(analysis.estimatedEffort).toBe('low');
  });

  it('should provide recommendations', () => {
    const analysis = SyntheticScriptConverter.analyzeScript(
      '$browser.get("url")\nelement.click()',
    );
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SLOTransformer
// ═════════════════════════════════════════════════════════════════════════════

describe('SLOTransformer', () => {
  let sloTransformer: SLOTransformer;

  beforeEach(() => {
    sloTransformer = new SLOTransformer();
  });

  describe('SLOTransformResult', () => {
    it('should default lists', () => {
      const nrSlo = {
        name: 'Test',
        objectives: [
          { target: 99.0, timeWindow: { rolling: { count: 7, unit: 'DAY' } } },
        ],
        events: { validEvents: { where: '' }, goodEvents: { where: '' } },
      };
      const result = sloTransformer.transform(nrSlo);
      expect(result.warnings).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('SLO transform', () => {
    it('should transform basic slo', () => {
      const nrSlo = {
        name: 'Availability SLO',
        description: '99.9% uptime',
        objectives: [
          {
            target: 99.9,
            timeWindow: { rolling: { count: 7, unit: 'DAY' } },
          },
        ],
        events: {
          validEvents: { where: 'status = 200' },
          goodEvents: { where: 'status = 200' },
        },
      };
      const result = sloTransformer.transform(nrSlo);
      expect(result.success).toBe(true);
      const slo = result.data!;
      expect(slo.name).toBe('[Migrated] Availability SLO');
      expect(slo.target).toBe(99.9);
      expect(slo.warning).toBe(98.9); // target - 1.0
      expect(slo.enabled).toBe(true);
      expect(slo.timeframe).toBe('-7d');
    });

    it('should fail when no objectives', () => {
      const nrSlo = { name: 'Bad SLO', objectives: [] };
      const result = sloTransformer.transform(nrSlo);
      expect(result.success).toBe(false);
    });

    it('should detect error rate type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sloType = (sloTransformer as any).detectSloType('', 'error count > 0');
      expect(sloType).toBe('error_rate');
    });

    it('should detect latency type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sloType = (sloTransformer as any).detectSloType('', 'duration < 500');
      expect(sloType).toBe('latency');
    });

    it('should detect availability type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sloType = (sloTransformer as any).detectSloType('status = 200', '');
      expect(sloType).toBe('availability');
    });

    it('should default to unknown', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sloType = (sloTransformer as any).detectSloType('', '');
      expect(sloType).toBe('unknown');
    });
  });

  describe('sanitize metric name', () => {
    it('should sanitize name', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (sloTransformer as any).sanitizeMetricName('My SLO Test!');
      expect(result).toBe('slo.migrated.my_slo_test');
    });

    it('should handle special chars', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (sloTransformer as any).sanitizeMetricName('SLO (prod) - v2');
      expect(result).toBe('slo.migrated.slo_prod__v2');
    });
  });

  describe('build timeframe', () => {
    it('should build day timeframe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(7, 'DAY')).toBe('-7d');
    });

    it('should build week timeframe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(4, 'WEEK')).toBe('-4w');
    });

    it('should build month timeframe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(1, 'MONTH')).toBe('-1M');
    });
  });

  describe('transform all', () => {
    it('should transform multiple slos', () => {
      const slos = [
        {
          name: 'SLO1',
          objectives: [{ target: 99.0, timeWindow: { rolling: { count: 7, unit: 'DAY' } } }],
          events: { validEvents: { where: '' }, goodEvents: { where: '' } },
        },
        {
          name: 'SLO2',
          objectives: [{ target: 95.0, timeWindow: { rolling: { count: 30, unit: 'DAY' } } }],
          events: { validEvents: { where: '' }, goodEvents: { where: '' } },
        },
      ];
      const results = sloTransformer.transformAll(slos);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WorkloadTransformer
// ═════════════════════════════════════════════════════════════════════════════

describe('WorkloadTransformer', () => {
  let workloadTransformer: WorkloadTransformer;

  beforeEach(() => {
    workloadTransformer = new WorkloadTransformer();
  });

  describe('WorkloadTransformResult', () => {
    it('should default lists', () => {
      const nr = {
        name: 'Test',
        collection: [{ name: 'app', type: 'APPLICATION' }],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.warnings).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('workload transform', () => {
    it('should transform workload with collection', () => {
      const nr = {
        name: 'Production Services',
        collection: [
          { name: 'web-app', type: 'APPLICATION' },
          { name: 'api-server', type: 'APM_APPLICATION' },
        ],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      const mz = result.data!;
      expect(mz.name).toBe('[Migrated] Production Services');
      expect(mz.rules).toHaveLength(2);
    });

    it('should create tag rule when no entities', () => {
      const nr = { name: 'Empty Workload', collection: [], entitySearchQueries: [] };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.data!.rules).toHaveLength(1); // tag-based fallback
      expect(result.data!.rules[0]!.entitySelector).toContain('tag(');
    });

    it('should handle unmapped entity types', () => {
      const nr = {
        name: 'Mixed',
        collection: [
          { name: 'dash-1', type: 'DASHBOARD' }, // No DT equivalent
        ],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('entity search queries', () => {
    it('should convert type query', () => {
      const nr = {
        name: 'Apps',
        entitySearchQueries: [
          { query: "type = 'APPLICATION'" },
        ],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      const rules = result.data!.rules;
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules[0]!.entitySelector).toContain('SERVICE');
    });

    it('should convert name like query', () => {
      const nr = {
        name: 'Prod',
        entitySearchQueries: [
          { query: "type = 'APPLICATION' AND name LIKE 'production%'" },
        ],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      const rules = result.data!.rules;
      expect(rules.some((r) => r.entitySelector.includes('entityName.contains'))).toBe(true);
    });

    it('should convert tag query', () => {
      const nr = {
        name: 'Tagged',
        entitySearchQueries: [
          { query: "type = 'HOST' AND tags.environment = 'production'" },
        ],
      };
      const result = workloadTransformer.transform(nr);
      expect(result.success).toBe(true);
      const rules = result.data!.rules;
      expect(rules.some((r) => r.entitySelector.includes('tag('))).toBe(true);
    });
  });

  describe('parse entity query', () => {
    it('should extract entity type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (workloadTransformer as any).parseEntityQuery("type = 'APPLICATION'");
      expect(parsed.entityType).toBe('APPLICATION');
    });

    it('should extract host type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (workloadTransformer as any).parseEntityQuery("type = 'HOST'");
      expect(parsed.entityType).toBe('HOST');
    });

    it('should extract name filter', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (workloadTransformer as any).parseEntityQuery("name LIKE 'prod%'");
      expect(parsed.nameFilter).toBe('prod');
    });

    it('should extract tags', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (workloadTransformer as any).parseEntityQuery("tags.env = 'prod'");
      expect(parsed.tags).toContainEqual(['env', 'prod']);
    });
  });

  describe('create rules', () => {
    it('should create name rule', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = (workloadTransformer as any).createNameRule('SERVICE', 'my-app');
      expect(rule.type).toBe('ME');
      expect(rule.enabled).toBe(true);
      expect(rule.entitySelector).toContain('entityName.equals("my-app")');
    });

    it('should create tag rule', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = (workloadTransformer as any).createTagRule('My Workload');
      expect(rule.entitySelector).toContain('tag("migrated-workload:my-workload")');
    });

    it('should sanitize tag value', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = (workloadTransformer as any).createTagRule('Special (chars) here!');
      const selector = rule.entitySelector as string;
      const tagContent = selector.split('tag(')[1]!.split(')')[0]!;
      const tagValue = tagContent.replace('"migrated-workload:', '').replace('"', '');
      expect(tagValue).not.toContain('(');
    });
  });

  describe('transform all', () => {
    it('should transform multiple workloads', () => {
      const workloads = [
        { name: 'W1', collection: [{ name: 'app1', type: 'APPLICATION' }] },
        { name: 'W2', collection: [{ name: 'host1', type: 'HOST' }] },
      ];
      const results = workloadTransformer.transformAll(workloads);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
