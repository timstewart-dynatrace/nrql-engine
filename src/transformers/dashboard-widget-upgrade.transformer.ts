/**
 * Dashboard Widget Upgrade Transformer — Complements `DashboardTransformer`
 * for the three widget types that previously landed at 🟡 in
 * `docs/COVERAGE.md §10`:
 *
 *   - **heatmap** → DT honeycomb tile (native)
 *   - **event-feed** → DT table sorted by time (native)
 *   - **funnel** → DT markdown tile with a pre-built DQL snippet
 *
 * Consumers call one of the three upgrade methods per NR widget; the
 * result is a DT tile record suitable for insertion into the
 * `tiles` map of a `builtin:documents.dashboard` payload.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRHeatmapWidgetInput {
  readonly title?: string;
  readonly nrql: string;
  readonly xAxisAttribute: string;
  readonly yAxisAttribute: string;
}

export interface NREventFeedWidgetInput {
  readonly title?: string;
  readonly nrql: string;
  readonly limit?: number;
}

export interface NRFunnelWidgetInput {
  readonly title?: string;
  readonly steps: Array<{ readonly name: string; readonly condition: string }>;
  readonly from?: string;
  readonly timeframe?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTHoneycombTile {
  readonly type: 'data';
  readonly title: string;
  readonly visualization: 'honeycomb';
  readonly query: string;
  readonly honeycomb: {
    readonly xAxis: string;
    readonly yAxis: string;
    readonly color: 'byValue';
  };
}

export interface DTTableTile {
  readonly type: 'data';
  readonly title: string;
  readonly visualization: 'table';
  readonly query: string;
  readonly table: {
    readonly sortBy: string;
    readonly sortDirection: 'desc';
    readonly rowLimit: number;
  };
}

export interface DTMarkdownTile {
  readonly type: 'markdown';
  readonly title: string;
  readonly markdown: string;
}

export interface DTMarkdownFunnelResult {
  readonly tile: DTMarkdownTile;
  readonly companionDql: string;
}

// ---------------------------------------------------------------------------
// DashboardWidgetUpgradeTransformer
// ---------------------------------------------------------------------------

export class DashboardWidgetUpgradeTransformer {
  upgradeHeatmap(input: NRHeatmapWidgetInput): TransformResult<DTHoneycombTile> {
    try {
      if (!input.nrql?.trim()) return failure(['nrql is required']);
      if (!input.xAxisAttribute || !input.yAxisAttribute) {
        return failure(['xAxisAttribute and yAxisAttribute are required']);
      }
      const warnings: string[] = [
        'DT honeycomb tiles expect pre-aggregated data; verify the emitted DQL produces one row per (x,y) bucket.',
      ];
      const tile: DTHoneycombTile = {
        type: 'data',
        title: input.title ?? 'Heatmap (migrated)',
        visualization: 'honeycomb',
        query: `// NRQL source: ${input.nrql}\n// TODO: compile via nrql-engine and summarize by ${input.xAxisAttribute}, ${input.yAxisAttribute}`,
        honeycomb: {
          xAxis: input.xAxisAttribute,
          yAxis: input.yAxisAttribute,
          color: 'byValue',
        },
      };
      return success(tile, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  upgradeEventFeed(input: NREventFeedWidgetInput): TransformResult<DTTableTile> {
    try {
      if (!input.nrql?.trim()) return failure(['nrql is required']);
      const limit = input.limit ?? 100;
      const tile: DTTableTile = {
        type: 'data',
        title: input.title ?? 'Event Feed (migrated)',
        visualization: 'table',
        query: `// NRQL source: ${input.nrql}\n// TODO: compile via nrql-engine; default sort by timestamp desc\nfetch events\n| sort timestamp desc\n| limit ${limit}`,
        table: {
          sortBy: 'timestamp',
          sortDirection: 'desc',
          rowLimit: limit,
        },
      };
      return success(tile);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  upgradeFunnel(input: NRFunnelWidgetInput): TransformResult<DTMarkdownFunnelResult> {
    try {
      if (!Array.isArray(input.steps) || input.steps.length === 0) {
        return failure(['At least one funnel step is required']);
      }
      const warnings: string[] = [
        'DT dashboards do not ship a native funnel tile; the emitted markdown tile carries a pre-built DQL snippet the operator can paste into a Notebook for visualization.',
      ];
      const from = input.from ?? 'bizevents';
      const timeframe = input.timeframe ?? '-24h';

      // DQL pattern: one countIf per step inside a single summarize.
      const stepClauses = input.steps
        .map((s, i) => `  step${i + 1} = countIf(${s.condition}),`)
        .join('\n');
      const companionDql =
        `fetch ${from}, from:${timeframe}\n` +
        `| summarize\n${stepClauses}\n  total = count()`;

      const tileBody =
        `**Funnel: ${input.title ?? 'Migrated funnel'}**\n\n` +
        input.steps
          .map((s, i) => `${i + 1}. **${s.name}** — \`${s.condition}\``)
          .join('\n') +
        '\n\n```dql\n' +
        companionDql +
        '\n```\n';

      const tile: DTMarkdownTile = {
        type: 'markdown',
        title: input.title ?? 'Funnel (migrated)',
        markdown: tileBody,
      };

      return success({ tile, companionDql }, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }
}
