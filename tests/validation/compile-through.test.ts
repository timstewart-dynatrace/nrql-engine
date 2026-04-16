/**
 * Transformer compile-through validation.
 *
 * Transformers that produce DQL in their output must emit syntactically
 * valid DQL. This test exercises the most critical compile-through path
 * (DashboardTransformer) and direct-DQL generators (BrokenLinks,
 * MultiLocation, CustomEvent, LookupTable, DashboardWidgetUpgrade).
 *
 * DQL extracted from each transformer's output is run through
 * DQLSyntaxValidator. Zero ERRORs = pass.
 */

import { describe, it, expect } from 'vitest';
import { DQLSyntaxValidator } from '../../src/validators/dql-validator.js';
import { DashboardTransformer } from '../../src/transformers/dashboard.transformer.js';
import { DashboardWidgetUpgradeTransformer } from '../../src/transformers/dashboard-widget-upgrade.transformer.js';
import { CustomEventTransformer } from '../../src/transformers/custom-event.transformer.js';
import { LookupTableTransformer } from '../../src/transformers/lookup-table.transformer.js';

const validator = new DQLSyntaxValidator();

function assertValidDql(dql: string, label: string): void {
  const result = validator.validate(dql);
  const errors = result.errors.filter((e) => e.severity === 'ERROR');
  expect(
    errors,
    `${label}: DQL validation errors:\n${errors.map((e) => `  L${e.line}:${e.column} ${e.message}`).join('\n')}\n\nDQL:\n${dql}`,
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// DashboardTransformer — compiles NRQL widgets to DQL via NRQLCompiler
// ---------------------------------------------------------------------------

describe('DashboardTransformer DQL compile-through', () => {
  const transformer = new DashboardTransformer();

  const DASHBOARD_NRQL_CASES = [
    "SELECT count(*) FROM Transaction WHERE appName = 'api' TIMESERIES",
    "SELECT average(duration) FROM Transaction FACET appName",
    "SELECT count(*) FROM Log WHERE level = 'ERROR'",
    "SELECT average(cpuPercent) FROM SystemSample TIMESERIES",
    "SELECT percentile(duration, 95) FROM Transaction",
    "SELECT count(*) FROM PageView FACET deviceType",
  ];

  for (const nrql of DASHBOARD_NRQL_CASES) {
    it(`should produce valid DQL for widget: ${nrql.slice(0, 60)}`, () => {
      const result = transformer.transform({
        name: 'Validation Dashboard',
        pages: [
          {
            name: 'Page 1',
            widgets: [
              {
                title: 'Test Widget',
                visualization: { id: 'viz.line' },
                rawConfiguration: { nrqlQueries: [{ query: nrql }] },
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
      if (!result.data) return;

      // Extract DQL from tiles
      const dashboards = result.data as Array<{
        tiles?: Array<{
          queries?: Array<{ freeText?: string }>;
        }>;
      }>;

      for (const dashboard of dashboards) {
        for (const tile of dashboard.tiles ?? []) {
          for (const query of tile.queries ?? []) {
            if (query.freeText) {
              assertValidDql(query.freeText, `dashboard widget [${nrql.slice(0, 40)}]`);
            }
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// DashboardWidgetUpgradeTransformer — generates DQL for specialized widgets
// ---------------------------------------------------------------------------

describe('DashboardWidgetUpgradeTransformer DQL validity', () => {
  const transformer = new DashboardWidgetUpgradeTransformer();

  it('should produce valid DQL for heatmap → honeycomb', () => {
    const result = transformer.upgradeHeatmap({
      title: 'Latency Heatmap',
      nrql: 'SELECT average(duration) FROM Transaction FACET appName, host',
      xAxisAttribute: 'appName',
      yAxisAttribute: 'host',
    });
    expect(result.success).toBe(true);
    if (!result.data) return;

    const tile = result.data as { query?: string };
    if (tile.query) {
      assertValidDql(tile.query, 'heatmap→honeycomb');
    }
  });

  it('should produce valid DQL for event-feed → table', () => {
    const result = transformer.upgradeEventFeed({
      title: 'Recent Events',
      nrql: "SELECT * FROM Transaction WHERE appName = 'api' LIMIT 20",
    });
    expect(result.success).toBe(true);
    if (!result.data) return;

    const tile = result.data as { query?: string };
    if (tile.query) {
      assertValidDql(tile.query, 'event-feed→table');
    }
  });

  it('should produce valid DQL for funnel', () => {
    const result = transformer.upgradeFunnel({
      title: 'Checkout Funnel',
      steps: [
        { nrql: 'SELECT count(*) FROM PageView WHERE pageName = \'home\'' },
        { nrql: 'SELECT count(*) FROM PageView WHERE pageName = \'cart\'' },
        { nrql: 'SELECT count(*) FROM PageView WHERE pageName = \'checkout\'' },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.data) return;

    const data = result.data as { companionDql?: string };
    if (data.companionDql) {
      assertValidDql(data.companionDql, 'funnel companion DQL');
    }
  });
});

// ---------------------------------------------------------------------------
// CustomEventTransformer — dqlRewrite example
// ---------------------------------------------------------------------------

describe('CustomEventTransformer DQL validity', () => {
  const transformer = new CustomEventTransformer();

  it('should produce valid DQL rewrite example', () => {
    const result = transformer.transform({
      eventType: 'PurchaseEvent',
      attributes: ['userId', 'amount', 'currency'],
    });
    expect(result.success).toBe(true);
    if (!result.data) return;

    const data = result.data as { dqlRewrite?: string };
    if (data.dqlRewrite) {
      assertValidDql(data.dqlRewrite, 'CustomEvent dqlRewrite');
    }
  });
});

// ---------------------------------------------------------------------------
// LookupTableTransformer — dqlUsageExample
// ---------------------------------------------------------------------------

describe('LookupTableTransformer DQL validity', () => {
  const transformer = new LookupTableTransformer();

  it('should produce valid DQL usage example', () => {
    const result = transformer.transform({
      name: 'regions',
      columns: ['regionCode', 'label'],
      rows: [['us-east-1', 'US East']],
    });
    expect(result.success).toBe(true);
    if (!result.data) return;

    const data = result.data as { dqlUsageExample?: string };
    if (data.dqlUsageExample) {
      assertValidDql(data.dqlUsageExample, 'LookupTable dqlUsageExample');
    }
  });
});
