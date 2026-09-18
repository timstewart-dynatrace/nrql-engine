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
  LegacyAlertTransformer,
  NotificationTransformer,
  LegacyNotificationTransformer,
  SyntheticTransformer,
  SyntheticScriptConverter,
  SLOTransformer,
  WorkloadTransformer,
  LegacyWorkloadTransformer,
} from '../../src/transformers/index.js';
import { FALLBACK_QUERY } from '../../src/transformers/detector-utils.js';
import type { DTSegmentFilterNode } from '../../src/transformers/workload.transformer.js';

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

describe('AlertTransformer (Gen3 Workflow + Davis anomaly detectors)', () => {
  let alertTransformer: AlertTransformer;

  beforeEach(() => {
    alertTransformer = new AlertTransformer();
  });

  const inputMap = (d: { value: { analyzer: { input: Array<{ key: string; value: string }> } } }) =>
    Object.fromEntries(d.value.analyzer.input.map((i) => [i.key, i.value]));

  it('should emit Gen3 Workflow with placeholder task even for empty policy', () => {
    const result = alertTransformer.transform({ name: 'Test Policy', id: '9', conditions: [] });
    expect(result.success).toBe(true);
    const wf = result.data!.workflow;
    expect(wf.title).toBe('[Migrated] Test Policy');
    expect(wf.description).toContain('(id=9)');
    expect(wf.trigger).toEqual({
      eventTrigger: {
        isActive: true,
        triggerConfiguration: {
          type: 'davis-problem',
          value: {
            analysisReady: false,
            categories: {
              availability: true,
              error: true,
              slowdown: true,
              resource: true,
              custom: true,
              monitoringUnavailable: true,
            },
            customFilter: 'matchesValue(event.name, "[Migrated] Test Policy | *")',
            entityTags: {},
            entityTagsMatch: 'all',
            onProblemClose: false,
          },
        },
      },
    });
    expect(wf).not.toHaveProperty('private');
    expect(result.data!.anomalyDetectors).toEqual([]);
    expect(result.data!.workflows).toHaveLength(1);
    expect(Array.isArray(wf.tasks)).toBe(false);
    expect(Object.keys(wf.tasks)).toEqual(['placeholder_action']);
    expect(wf.tasks['placeholder_action']!.active).toBe(false);
  });

  it('should emit one Davis anomaly detector per NRQL condition, bound to workflow trigger', () => {
    const result = alertTransformer.transform({
      name: 'Test Policy',
      id: '123',
      conditions: [
        {
          name: 'High Error Rate',
          conditionType: 'NRQL',
          nrql: { query: 'SELECT count(*) FROM TransactionError' },
          signal: { aggregationWindow: 60 },
          terms: [
            { priority: 'critical', operator: 'ABOVE', threshold: 10, thresholdDuration: 300 },
          ],
          enabled: true,
          runbookUrl: 'https://runbooks/err',
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.anomalyDetectors).toHaveLength(1);
    const det = result.data!.anomalyDetectors[0]!;
    expect(det.schemaId).toBe('builtin:davis.anomaly-detectors');
    expect(det.scope).toBe('environment');
    expect(det).not.toHaveProperty('detectorId');
    expect(det.value.title).toBe('[Migrated] High Error Rate');
    expect(det.value.enabled).toBe(true);
    expect(det.value.analyzer.name).toBe(
      'dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer',
    );
    const inputs = inputMap(det);
    expect(inputs).toMatchObject({
      threshold: '10.0',
      alertCondition: 'ABOVE',
      alertOnMissingData: 'false',
      violatingSamples: '5',
      slidingWindow: '5',
      dealertingSamples: '5',
    });
    const props = Object.fromEntries(det.value.eventTemplate.properties.map((p) => [p.key, p.value]));
    expect(props).toMatchObject({
      'event.type': 'CUSTOM_ALERT',
      'event.name': '[Migrated] Test Policy | High Error Rate',
      'source.policy': 'Test Policy',
      'source.condition': 'High Error Rate',
      'migrated.from': 'newrelic',
      'original.nrql': 'SELECT count(*) FROM TransactionError',
      'evaluation.window': '60s',
      'runbook.url': 'https://runbooks/err',
    });
    expect(
      result.data!.workflow.trigger.eventTrigger.triggerConfiguration.value.customFilter,
    ).toBe('matchesValue(event.name, "[Migrated] Test Policy | *")');
  });

  it('should resolve AT_LEAST_ONCE and warning-term fallback', () => {
    const result = alertTransformer.transform({
      name: 'P',
      conditions: [
        {
          name: 'c',
          nrql: { query: 'SELECT count(*) FROM Transaction' },
          terms: [
            {
              priority: 'warning',
              operator: 'BELOW',
              threshold: 2.5,
              thresholdDuration: 120,
              thresholdOccurrences: 'AT_LEAST_ONCE',
            },
          ],
        },
      ],
    });
    const inputs = inputMap(result.data!.anomalyDetectors[0]!);
    expect(inputs['threshold']).toBe('2.5');
    expect(inputs['alertCondition']).toBe('BELOW');
    expect(inputs['slidingWindow']).toBe('2');
    expect(inputs['violatingSamples']).toBe('1');
  });

  it('should emit disabled detector skeleton for non-NRQL conditions', () => {
    const result = alertTransformer.transform({
      name: 'Test',
      conditions: [{ name: 'APM Cond', conditionType: 'APM' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.anomalyDetectors).toHaveLength(1);
    const det = result.data!.anomalyDetectors[0]!;
    expect(det.value.enabled).toBe(false);
    expect(inputMap(det)['query']).toBe(FALLBACK_QUERY);
    expect(result.warnings.some((w) => w.includes('manual review'))).toBe(true);
  });

  it('should turn notification channels into dict-keyed workflow tasks', () => {
    const result = alertTransformer.transform({
      name: 'P',
      conditions: [],
      notificationChannels: [
        { name: 'Ops Mail', type: 'EMAIL', properties: [{ key: 'recipients', value: 'a@b.c' }] },
        { name: 'Ops Mail', type: 'EMAIL', properties: [{ key: 'recipients', value: 'd@e.f' }] },
        { name: 'Nope', type: 'CARRIER_PIGEON' },
      ],
    });
    const tasks = result.data!.workflow.tasks;
    expect(Object.keys(tasks)).toEqual(['ops_mail', 'ops_mail_2']);
    expect(tasks['ops_mail']!.position).toEqual({ x: 0, y: 1 });
    expect(tasks['ops_mail_2']!.position).toEqual({ x: 0, y: 2 });
    expect(result.warnings.some((w) => w.includes('CARRIER_PIGEON'))).toBe(true);
  });

  it('should fan out one workflow per severity when delays are non-uniform', () => {
    const result = alertTransformer.transform({
      name: 'Ladder',
      conditions: [],
      severityRules: [
        { severity: 'AVAILABILITY', delayMinutes: 0 },
        { severity: 'ERROR', delayMinutes: 5 },
      ],
    });
    const wfs = result.data!.workflows;
    expect(wfs).toHaveLength(2);
    expect(result.data!.workflow).toBe(wfs[0]);
    expect(wfs[1]!.title).toBe('[Migrated] Ladder [ERROR]');
    expect(wfs[1]).not.toHaveProperty('migratedFrom');
    expect(wfs[1]!.description).toContain('Severity-ladder workflow for ERROR (delay 5 min).');
    const value = wfs[1]!.trigger.eventTrigger.triggerConfiguration.value;
    expect(value.categories.error).toBe(true);
    expect(value.categories.availability).toBe(false);
    // Fanout workflows still link on the base policy name.
    expect(value.customFilter).toBe('matchesValue(event.name, "[Migrated] Ladder | *")');
    expect(Object.keys(wfs[1]!.tasks)[0]).toBe('delay_5m');
    expect(wfs[0]!.tasks['delay_0m']).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('severity-ladder'))).toBe(true);
  });

  it('should emit a single workflow when severity delays are uniform', () => {
    const result = alertTransformer.transform({
      name: 'Flat',
      conditions: [],
      severityRules: [
        { severity: 'AVAILABILITY', delayMinutes: 3 },
        { severity: 'ERROR', delayMinutes: 3 },
      ],
    });
    expect(result.data!.workflows).toHaveLength(1);
    expect(result.data!.workflow).not.toHaveProperty('migratedFrom');
  });

  it('should transform multiple policies', () => {
    const results = alertTransformer.transformAll([
      { name: 'P1', conditions: [] },
      { name: 'P2', conditions: [] },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe('LegacyAlertTransformer (Gen2 Alerting Profile + Metric Event)', () => {
  let legacy: LegacyAlertTransformer;

  beforeEach(() => {
    legacy = new LegacyAlertTransformer();
  });

  it('should emit legacy warning', () => {
    const result = legacy.transform({ name: 'Test', conditions: [] });
    expect(result.warnings[0]).toContain('Gen2');
  });

  it('should transform empty policy with alertingProfile', () => {
    const result = legacy.transform({ name: 'Test Policy', id: '123', conditions: [] });
    expect(result.success).toBe(true);
    expect(result.data!.alertingProfile).toBeDefined();
    expect((result.data!.alertingProfile as Record<string, unknown>).name).toContain('[Migrated]');
    expect(result.data!.metricEvents).toEqual([]);
  });

  it('should transform with nrql condition', () => {
    const result = legacy.transform({
      name: 'Test Policy',
      id: '123',
      conditions: [
        {
          name: 'High Error Rate',
          conditionType: 'NRQL',
          nrql: { query: 'SELECT count(*) FROM TransactionError' },
          signal: { aggregationWindow: 60 },
          terms: [
            { priority: 'critical', operator: 'ABOVE', threshold: 10, thresholdDuration: 300 },
          ],
          enabled: true,
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.metricEvents).toHaveLength(1);
    const event = result.data!.metricEvents[0]!;
    expect((event.summary as string).startsWith('[Migrated]')).toBe(true);
    expect(event.enabled).toBe(true);
    expect((event.monitoringStrategy as Record<string, unknown>).threshold).toBe(10);
    expect((event.monitoringStrategy as Record<string, unknown>).alertCondition).toBe('ABOVE');
  });

  it('should create placeholder for non nrql condition', () => {
    const result = legacy.transform({
      name: 'Test',
      conditions: [{ name: 'APM Cond', conditionType: 'APM' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.metricEvents).toHaveLength(1);
    expect(result.data!.metricEvents[0]!.enabled).toBe(false);
  });

  it('should build default monitoring strategy', () => {
    const strategy = legacy.buildMonitoringStrategy([], 60, '', []);
    expect(strategy.type).toBe('STATIC_THRESHOLD');
    expect(strategy.alertCondition).toBe('ABOVE');
  });

  it('should use critical term', () => {
    const strategy = legacy.buildMonitoringStrategy(
      [
        { priority: 'warning', operator: 'ABOVE', threshold: 5 },
        { priority: 'critical', operator: 'BELOW', threshold: 100 },
      ],
      60,
      '',
      [],
    );
    expect(strategy.alertCondition).toBe('BELOW');
    expect(strategy.threshold).toBe(100);
  });

  it('should handle at least once occurrences', () => {
    const strategy = legacy.buildMonitoringStrategy(
      [
        {
          priority: 'critical',
          operator: 'ABOVE',
          threshold: 10,
          thresholdDuration: 300,
          thresholdOccurrences: 'AT_LEAST_ONCE',
        },
      ],
      60,
      '',
      [],
    );
    expect(strategy.violatingSamples).toBe(1);
  });

  it('should extract duration metric', () => {
    expect(legacy.extractMetricFromNrql('SELECT average(duration) FROM Transaction')).toBe(
      'builtin:service.response.time',
    );
  });

  it('should extract error metric', () => {
    expect(legacy.extractMetricFromNrql('SELECT count(*) FROM TransactionError')).toBe(
      'builtin:service.errors.total.rate',
    );
  });

  it('should extract cpu metric', () => {
    expect(legacy.extractMetricFromNrql('SELECT average(cpuPercent) FROM SystemSample')).toBe(
      'builtin:host.cpu.usage',
    );
  });

  it('should return undefined for unknown metric', () => {
    expect(legacy.extractMetricFromNrql('SELECT count(*) FROM CustomEvent')).toBeUndefined();
  });

  it('should transform all', () => {
    const results = legacy.transformAll([
      { name: 'P1', conditions: [] },
      { name: 'P2', conditions: [] },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
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

  it('should emit routing filter from Notification Policies v2 policyName', () => {
    const result = notifTransformer.transform({
      name: 'On-call',
      type: 'PAGERDUTY',
      properties: [{ key: 'service_key', value: 'k' }],
      routing: { policyName: 'prod-critical' },
    });
    expect(result.data!.filter).toContain('prod-critical');
    expect(result.data!.filter).toContain("event()['event.source']");
  });

  it('should emit routing filter combining entityTags and severity', () => {
    const result = notifTransformer.transform({
      name: 'On-call',
      type: 'PAGERDUTY',
      properties: [{ key: 'service_key', value: 'k' }],
      routing: {
        entityTags: { env: 'prod', team: 'payments' },
        severityAtLeast: 'ERROR',
      },
    });
    expect(result.data!.filter).toContain('affected_entity_tags.env');
    expect(result.data!.filter).toContain('"prod"');
    expect(result.data!.filter).toContain('affected_entity_tags.team');
    expect(result.data!.filter).toContain('ERROR');
    expect(result.data!.filter).toContain('AVAILABILITY');
    expect(result.data!.filter).not.toContain('PERFORMANCE');
    expect(result.data!.filter!.split(' and ').length).toBeGreaterThan(1);
  });

  it('should not add a filter when routing.severityAtLeast is ALL with no other criteria', () => {
    const result = notifTransformer.transform({
      name: 'Default',
      type: 'EMAIL',
      properties: [{ key: 'recipients', value: 'a@b.com' }],
      routing: { severityAtLeast: 'ALL' },
    });
    expect(result.data!.filter).toBeUndefined();
  });

  it('should not add a filter when routing is absent', () => {
    const result = notifTransformer.transform({
      name: 'Default',
      type: 'EMAIL',
      properties: [{ key: 'recipients', value: 'a@b.com' }],
    });
    expect(result.data!.filter).toBeUndefined();
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
      expect(slo.criteria[0]!.target).toBe(99.9);
      expect(slo.criteria[0]!.warning).toBe(99.95); // Platform SLO: warning > target
      expect(slo.criteria[0]!.timeframeFrom).toBe('now-7d');
      expect(slo.criteria[0]!.timeframeTo).toBe('now');
      expect(slo.customSli.indicator).toContain('by: { dt.smartscape.service }');
      expect(JSON.stringify(slo)).not.toContain('builtin:monitoring.slo');
      expect(JSON.stringify(slo)).not.toContain('dt.entity');
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

  describe('build timeframe', () => {
    it('should build day timeframe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(7, 'DAY')).toBe('now-7d');
    });

    it('should build week timeframe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(4, 'WEEK')).toBe('now-4w');
    });

    it('should approximate month timeframe as days with a warning', () => {
      const warnings: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sloTransformer as any).buildTimeframe(1, 'MONTH', warnings)).toBe('now-30d');
      expect(warnings.some((w) => w.includes('30 days'))).toBe(true);
    });
  });

  describe('transformV3 (Service Levels v3)', () => {
    it('should fail without sli.nrql', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = sloTransformer.transformV3({ name: 'x', sli: {} as any });
      expect(result.success).toBe(false);
    });

    it('should emit DTSlo with rolling timeframe', () => {
      const result = sloTransformer.transformV3({
        name: 'Checkout availability',
        sli: { nrql: "SELECT percentage(count(*), WHERE error IS NULL) FROM Transaction" },
        target: 99.5,
        timeWindow: { rolling: { count: 30, unit: 'DAY' } },
      });
      expect(result.success).toBe(true);
      expect(result.data!.criteria[0]!.timeframeFrom).toBe('now-30d');
      expect(result.data!.criteria[0]!.target).toBe(99.5);
      expect(result.data!.name).toContain('[Migrated SLv3]');
    });

    it('should map calendar-aligned window to snap expression', () => {
      const result = sloTransformer.transformV3({
        name: 'x',
        sli: { nrql: 'q' },
        timeWindow: { calendarAligned: { unit: 'MONTH' } },
      });
      expect(result.data!.criteria[0]!.timeframeFrom).toBe('now-1M@M');
    });

    it('should combine nrql + badEventsNrql when provided', () => {
      const result = sloTransformer.transformV3({
        name: 'errs',
        sli: {
          nrql: 'SELECT count(*) FROM Transaction',
          badEventsNrql: "duration > 1 AND error IS NOT NULL",
        },
      });
      expect(result.success).toBe(true);
      expect(result.data!.customSli.indicator).toContain('dt.service.request.failure_count');
    });

    it('should scope the indicator to a DT SERVICE id when supplied', () => {
      const result = sloTransformer.transformV3({
        name: 'x',
        sli: { nrql: 'q' },
        entityGuid: 'SERVICE-123ABC',
      });
      expect(result.data!.customSli.indicator).toContain(
        'dt.smartscape.service == toSmartscapeId("SERVICE-123ABC")',
      );
    });

    it('should warn when entityGuid is not a DT SERVICE id', () => {
      const result = sloTransformer.transformV3({
        name: 'x',
        sli: { nrql: 'q' },
        entityGuid: 'MXxBUE18QVBQTElDQVRJT058MQ',
      });
      expect(result.data!.customSli.indicator).not.toContain('toSmartscapeId');
      expect(result.warnings.some((w) => w.includes('not a Dynatrace SERVICE id'))).toBe(true);
    });

    it('should surface v3-specific review warning', () => {
      const result = sloTransformer.transformV3({ name: 'x', sli: { nrql: 'q' } });
      expect(result.warnings.some((w) => w.includes('v3'))).toBe(true);
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

describe('WorkloadTransformer (Gen3 builtin:segment)', () => {
  let workloadTransformer: WorkloadTransformer;

  beforeEach(() => {
    workloadTransformer = new WorkloadTransformer();
  });

  it('should emit Gen3 segment with manual-step warnings', () => {
    const result = workloadTransformer.transform({
      name: 'Production Services',
      collection: [{ name: 'web-app', type: 'APPLICATION' }],
    });
    expect(result.success).toBe(true);
    const seg = result.data!;
    expect(seg.schemaId).toBe('builtin:segment');
    expect(seg.name).toBe('[Migrated] Production Services');
    expect(seg.isPublic).toBe(false);
    expect(seg.includes.items).toHaveLength(1);
    expect(seg.manualSteps.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('bucket-scoped IAM'))).toBe(true);
  });

  type Node = DTSegmentFilterNode;
  const groupOf = (n: Node) => {
    if (n.type !== 'Group') throw new Error(`expected Group, got ${n.type}`);
    return n;
  };
  const stmtOf = (n: Node) => {
    if (n.type !== 'Statement') throw new Error(`expected Statement, got ${n.type}`);
    return [n.key.value, n.operator.value, n.value.value];
  };

  it('should use a single _all_entities include with Smartscape type/name statements', () => {
    const result = workloadTransformer.transform({
      name: 'Mixed',
      collection: [
        { name: 'web-app', type: 'APPLICATION' },
        { name: 'api-server', type: 'APM_APPLICATION' },
        { name: 'host-1', type: 'HOST' },
      ],
    });
    const includes = result.data!.includes.items;
    expect(includes).toHaveLength(1);
    expect(includes[0]!.dataObject).toBe('_all_entities');
    const root = groupOf(includes[0]!.filter);
    expect(root.logicalOperator).toBe('OR');
    expect(root.children).toHaveLength(2); // SERVICE group + HOST group
    expect(JSON.stringify(includes)).not.toContain('dt.entity');
  });

  it('should AND the type with an OR of names (D14)', () => {
    const result = workloadTransformer.transform({
      name: 'Services',
      collection: [
        { name: 'svc-a', type: 'APPLICATION' },
        { name: 'svc-b', type: 'APPLICATION' },
      ],
    });
    const group = groupOf(groupOf(result.data!.includes.items[0]!.filter).children[0]!);
    expect(group.logicalOperator).toBe('AND');
    expect(stmtOf(group.children[0]!)).toEqual(['type', '=', 'SERVICE']);
    const names = groupOf(group.children[1]!);
    expect(names.logicalOperator).toBe('OR');
    expect(names.children.map(stmtOf)).toEqual([
      ['name', '=', 'svc-a'],
      ['name', '=', 'svc-b'],
    ]);
  });

  it('should use id statements for Dynatrace entity ids', () => {
    const result = workloadTransformer.transform({
      name: 'prod',
      collection: [{ type: 'HOST', name: 'h1', guid: 'HOST-ABC123' }],
    });
    const group = groupOf(groupOf(result.data!.includes.items[0]!.filter).children[0]!);
    expect(group.logicalOperator).toBe('AND');
    expect(stmtOf(group.children[0]!)).toEqual(['type', '=', 'HOST']);
    expect(stmtOf(groupOf(group.children[1]!).children[0]!)).toEqual(['id', '=', 'HOST-ABC123']);
  });

  it('should mix id and name groups', () => {
    const result = workloadTransformer.transform({
      name: 'mixed',
      collection: [
        { type: 'HOST', name: 'h1', guid: 'HOST-ABC123' },
        { type: 'HOST', name: 'h2' },
      ],
    });
    const flat = JSON.stringify(result.data!.includes.items[0]!.filter);
    expect(flat).toContain('{"value":"id"}');
    expect(flat).toContain('{"value":"name"}');
    expect(flat).not.toContain('dt.entity');
  });

  it('should fall back to name with a warning for NR GUIDs', () => {
    const result = workloadTransformer.transform({
      name: 'nr',
      collection: [{ type: 'APPLICATION', name: 'checkout', guid: 'MXxBUE18QVBQTElDQVRJT058MTIz' }],
    });
    const flat = JSON.stringify(result.data!.includes.items[0]!.filter);
    expect(flat).toContain('{"value":"SERVICE"}');
    expect(flat).toContain('{"value":"checkout"}');
    expect(flat).not.toContain('MXxBUE18');
    expect(result.warnings.some((w) => w.includes('not a Dynatrace entity ID'))).toBe(true);
  });

  it('should map browser/mobile to FRONTEND and skip synthetic monitors', () => {
    const result = workloadTransformer.transform({
      name: 'fe',
      collection: [
        { type: 'BROWSER_APPLICATION', name: 'web' },
        { type: 'MOBILE_APPLICATION', name: 'ios' },
        { type: 'SYNTHETIC_MONITOR', name: 'ping' },
      ],
    });
    const flat = JSON.stringify(result.data!.includes.items[0]!.filter);
    expect(flat).toContain('{"value":"FRONTEND"}');
    expect(flat).not.toContain('ping');
    expect(result.warnings.some((w) => w.includes("'SYNTHETIC_MONITOR'"))).toBe(true);
  });

  it('should fallback to tag-based segment when empty', () => {
    const result = workloadTransformer.transform({
      name: 'Empty Workload',
      collection: [],
      entitySearchQueries: [],
    });
    expect(result.success).toBe(true);
    const include = result.data!.includes.items[0]!;
    expect(include.dataObject).toBe('_all_entities');
    expect(groupOf(include.filter).children.map(stmtOf)).toEqual([
      ['tags.migrated-workload', '=', 'empty-workload'],
    ]);
  });

  it('should warn on unmapped entity types and skip them', () => {
    const result = workloadTransformer.transform({
      name: 'Mixed',
      collection: [{ name: 'dash-1', type: 'DASHBOARD' }],
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('DASHBOARD'))).toBe(true);
  });

  it('should convert type query to a type statement group', () => {
    const result = workloadTransformer.transform({
      name: 'Apps',
      entitySearchQueries: [{ query: "type = 'APPLICATION'" }],
    });
    const group = groupOf(groupOf(result.data!.includes.items[0]!.filter).children[0]!);
    expect(group.children.map(stmtOf)).toEqual([['type', '=', 'SERVICE']]);
  });

  it('should convert name-like query to a name contains statement', () => {
    const result = workloadTransformer.transform({
      name: 'Prod',
      entitySearchQueries: [{ query: "type = 'APPLICATION' AND name LIKE 'production%'" }],
    });
    const group = groupOf(groupOf(result.data!.includes.items[0]!.filter).children[0]!);
    expect(group.logicalOperator).toBe('AND');
    expect(group.children.map(stmtOf)).toEqual([
      ['type', '=', 'SERVICE'],
      ['name', 'contains', 'production'],
    ]);
  });

  it('should convert tag query to a tags.<key> statement', () => {
    const result = workloadTransformer.transform({
      name: 'Tagged',
      entitySearchQueries: [
        { query: "type = 'HOST' AND tags.environment = 'production'" },
      ],
    });
    const group = groupOf(groupOf(result.data!.includes.items[0]!.filter).children[0]!);
    expect(group.children.map(stmtOf)).toEqual([
      ['type', '=', 'HOST'],
      ['tags.environment', '=', 'production'],
    ]);
  });
});

describe('LegacyWorkloadTransformer (Gen2 Management Zone)', () => {
  let legacy: LegacyWorkloadTransformer;

  beforeEach(() => {
    legacy = new LegacyWorkloadTransformer();
  });

  it('should emit legacy warning', () => {
    const result = legacy.transform({ name: 'Test', collection: [] });
    expect(result.warnings[0]).toContain('Gen2');
  });

  it('should transform workload with collection', () => {
    const nr = {
      name: 'Production Services',
      collection: [
        { name: 'web-app', type: 'APPLICATION' },
        { name: 'api-server', type: 'APM_APPLICATION' },
      ],
    };
    const result = legacy.transform(nr);
    expect(result.success).toBe(true);
    const mz = result.data!;
    expect(mz.name).toBe('[Migrated] Production Services');
    expect(mz.rules).toHaveLength(2);
  });

  it('should create tag rule when no entities', () => {
    const result = legacy.transform({
      name: 'Empty Workload',
      collection: [],
      entitySearchQueries: [],
    });
    expect(result.success).toBe(true);
    expect(result.data!.rules).toHaveLength(1);
    expect(result.data!.rules[0]!.entitySelector).toContain('tag(');
  });

  it('should handle unmapped entity types', () => {
    const result = legacy.transform({
      name: 'Mixed',
      collection: [{ name: 'dash-1', type: 'DASHBOARD' }],
    });
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should convert type query', () => {
    const result = legacy.transform({
      name: 'Apps',
      entitySearchQueries: [{ query: "type = 'APPLICATION'" }],
    });
    const rules = result.data!.rules;
    expect(rules.length).toBeGreaterThanOrEqual(1);
    expect(rules[0]!.entitySelector).toContain('SERVICE');
  });

  it('should convert name like query', () => {
    const result = legacy.transform({
      name: 'Prod',
      entitySearchQueries: [{ query: "type = 'APPLICATION' AND name LIKE 'production%'" }],
    });
    expect(
      result.data!.rules.some((r) => r.entitySelector.includes('entityName.contains')),
    ).toBe(true);
  });

  it('should convert tag query', () => {
    const result = legacy.transform({
      name: 'Tagged',
      entitySearchQueries: [{ query: "type = 'HOST' AND tags.environment = 'production'" }],
    });
    expect(result.data!.rules.some((r) => r.entitySelector.includes('tag('))).toBe(true);
  });

  it('should parse entity types in queries', () => {
    expect(legacy.parseEntityQuery("type = 'APPLICATION'").entityType).toBe('APPLICATION');
    expect(legacy.parseEntityQuery("type = 'HOST'").entityType).toBe('HOST');
    expect(legacy.parseEntityQuery("name LIKE 'prod%'").nameFilter).toBe('prod');
    expect(legacy.parseEntityQuery("tags.env = 'prod'").tags).toContainEqual(['env', 'prod']);
  });

  it('should transform multiple workloads', () => {
    const results = legacy.transformAll([
      { name: 'W1', collection: [{ name: 'app1', type: 'APPLICATION' }] },
      { name: 'W2', collection: [{ name: 'host1', type: 'HOST' }] },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
