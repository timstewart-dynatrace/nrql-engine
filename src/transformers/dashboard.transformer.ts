/**
 * Dashboard Transformer - Converts New Relic dashboards to Dynatrace format.
 *
 * Uses the AST-based NRQL compiler for accurate query translation
 * instead of regex-based conversion.
 */

import { NRQLCompiler } from '../compiler/compiler.js';
import type { CompileResult } from '../compiler/compiler.js';
import {
  VISUALIZATION_TYPE_MAP,
} from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input/output interfaces
// ---------------------------------------------------------------------------

export interface NRDashboardInput {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: string;
  readonly pages?: NRDashboardPage[];
  readonly variables?: NRDashboardVariable[];
}

export interface NRDashboardPage {
  readonly name?: string;
  readonly description?: string;
  readonly widgets?: NRWidget[];
}

export interface NRWidget {
  readonly title?: string;
  readonly visualization?: { id?: string };
  readonly layout?: NRWidgetLayout;
  readonly rawConfiguration?: {
    nrqlQueries?: Array<{ query?: string }>;
    text?: string;
  };
}

export interface NRWidgetLayout {
  readonly column?: number;
  readonly row?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface NRDashboardVariable {
  readonly name?: string;
  readonly type?: string;
}

/** A single Dynatrace dashboard (one per NR page) */
export interface DTDashboard {
  dashboardMetadata: {
    name: string;
    shared: boolean;
    owner: string;
    tags: string[];
    preset: boolean;
    dynamicFilters: {
      filters: unknown[];
      genericTagFilters: unknown[];
    };
    description?: string;
  };
  tiles: DTTile[];
}

export interface DTTile {
  name: string;
  tileType: string;
  configured: boolean;
  bounds: { top: number; left: number; width: number; height: number };
  tileFilter: Record<string, unknown>;
  markdown?: string;
  customName?: string;
  queries?: Array<{
    id: string;
    enabled: boolean;
    freeText: string;
    queryMetaData: { customName: string };
  }>;
}

/** DashboardTransformer returns a list of DT dashboards (one per NR page). */
export type DashboardTransformData = DTDashboard[];

// ---------------------------------------------------------------------------
// DashboardTransformer
// ---------------------------------------------------------------------------

export class DashboardTransformer {
  /** Dynatrace tile size unit (typically 38 pixels per unit) */
  private static readonly TILE_UNIT = 38;
  private static readonly DEFAULT_TILE_WIDTH = 6;
  private static readonly DEFAULT_TILE_HEIGHT = 4;

  private readonly compiler: NRQLCompiler;

  constructor(compiler?: NRQLCompiler) {
    this.compiler = compiler ?? new NRQLCompiler();
  }

  transform(nrDashboard: NRDashboardInput): TransformResult<DashboardTransformData> {
    const dashboards: DTDashboard[] = [];
    const allWarnings: string[] = [];

    try {
      const pages = nrDashboard.pages ?? [];

      if (pages.length === 0) {
        return failure(['Dashboard has no pages']);
      }

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        if (!page) continue;
        const pageResult = this.transformPage(
          nrDashboard,
          page,
          pageIndex,
          pages.length,
        );
        if (pageResult.dashboard) {
          dashboards.push(pageResult.dashboard);
        }
        allWarnings.push(...pageResult.warnings);
      }
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }

    return success(dashboards, allWarnings);
  }

  transformAll(dashboards: NRDashboardInput[]): TransformResult<DashboardTransformData>[] {
    return dashboards.map((d) => this.transform(d));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private transformPage(
    nrDashboard: NRDashboardInput,
    page: NRDashboardPage,
    pageIndex: number,
    totalPages: number,
  ): { dashboard: DTDashboard; warnings: string[] } {
    const warnings: string[] = [];

    let dashboardName = nrDashboard.name ?? 'Untitled Dashboard';
    const pageName = page.name ?? `Page ${pageIndex + 1}`;

    if (totalPages > 1) {
      dashboardName = `${dashboardName} - ${pageName}`;
    }

    const dtDashboard: DTDashboard = {
      dashboardMetadata: {
        name: dashboardName,
        shared: this.mapPermissions(nrDashboard.permissions),
        owner: 'migration-tool',
        tags: ['migrated-from-newrelic'],
        preset: false,
        dynamicFilters: {
          filters: [],
          genericTagFilters: [],
        },
      },
      tiles: [],
    };

    const description = nrDashboard.description ?? page.description;
    if (description) {
      dtDashboard.dashboardMetadata.description = description;
    }

    const widgets = page.widgets ?? [];
    for (const widget of widgets) {
      const tileResult = this.transformWidget(widget);
      if (tileResult) {
        dtDashboard.tiles.push(tileResult.tile);
        warnings.push(...tileResult.warnings);
      }
    }

    const variables = nrDashboard.variables ?? [];
    if (variables.length > 0) {
      dtDashboard.dashboardMetadata.dynamicFilters = this.transformVariables(variables);
    }

    return { dashboard: dtDashboard, warnings };
  }

  private transformWidget(widget: NRWidget): { tile: DTTile; warnings: string[] } | undefined {
    const warnings: string[] = [];
    const vizId = widget.visualization?.id ?? '';
    const tileType = VISUALIZATION_TYPE_MAP[vizId] ?? 'DATA_EXPLORER';
    const layout = widget.layout ?? {};
    const bounds = this.transformLayout(layout);

    let tile: DTTile = {
      name: widget.title ?? 'Untitled',
      tileType,
      configured: true,
      bounds,
      tileFilter: {},
    };

    if (tileType === 'MARKDOWN') {
      tile = this.transformMarkdownWidget(widget, tile);
    } else if (tileType === 'SINGLE_VALUE') {
      tile = this.transformBillboardWidget(widget, tile, warnings);
    } else {
      tile = this.transformChartWidget(widget, tile, warnings);
    }

    return { tile, warnings };
  }

  private transformLayout(layout: NRWidgetLayout): { top: number; left: number; width: number; height: number } {
    const column = (layout.column ?? 1) - 1;
    const row = (layout.row ?? 1) - 1;
    const width = layout.width ?? DashboardTransformer.DEFAULT_TILE_WIDTH;
    const height = layout.height ?? DashboardTransformer.DEFAULT_TILE_HEIGHT;

    return {
      top: row * DashboardTransformer.TILE_UNIT * 2,
      left: column * DashboardTransformer.TILE_UNIT * 2,
      width: width * DashboardTransformer.TILE_UNIT * 2,
      height: height * DashboardTransformer.TILE_UNIT * 2,
    };
  }

  private transformMarkdownWidget(widget: NRWidget, tile: DTTile): DTTile {
    const rawConfig = widget.rawConfiguration ?? {};
    const text = rawConfig.text ?? '';

    return {
      ...tile,
      tileType: 'MARKDOWN',
      markdown: text,
    };
  }

  private transformBillboardWidget(widget: NRWidget, tile: DTTile, warnings: string[]): DTTile {
    const rawConfig = widget.rawConfiguration ?? {};
    const nrqlQueries = rawConfig.nrqlQueries ?? [];

    const updated: DTTile = { ...tile, tileType: 'DATA_EXPLORER' };

    if (nrqlQueries.length > 0 && nrqlQueries[0]) {
      const query = nrqlQueries[0].query ?? '';
      const title = widget.title ?? 'Billboard';
      const dqlResult = this.convertNrqlToDql(query, title);

      updated.customName = title;
      updated.queries = [
        {
          id: 'A',
          enabled: true,
          freeText: dqlResult.dql,
          queryMetaData: { customName: title },
        },
      ];

      warnings.push(...dqlResult.warnings);

      if (!dqlResult.fullyConverted) {
        warnings.push(
          `Billboard '${title}' converted with ${dqlResult.confidence} ` +
            `confidence. Original NRQL: ${query.slice(0, 100)}...`,
        );
      }
    }

    return updated;
  }

  private transformChartWidget(widget: NRWidget, tile: DTTile, warnings: string[]): DTTile {
    const rawConfig = widget.rawConfiguration ?? {};
    const nrqlQueries = rawConfig.nrqlQueries ?? [];

    const updated: DTTile = {
      ...tile,
      tileType: 'DATA_EXPLORER',
      customName: widget.title ?? 'Chart',
    };

    if (nrqlQueries.length > 0 && nrqlQueries[0]) {
      const query = nrqlQueries[0].query ?? '';
      const title = widget.title ?? 'Chart';
      const dqlResult = this.convertNrqlToDql(query, title);

      updated.queries = [
        {
          id: 'A',
          enabled: true,
          freeText: dqlResult.dql,
          queryMetaData: { customName: widget.title ?? 'Query A' },
        },
      ];

      warnings.push(...dqlResult.warnings);

      if (!dqlResult.fullyConverted) {
        warnings.push(
          `Chart '${widget.title}' NRQL query requires manual review. ` +
            `Original: ${query.slice(0, 100)}...`,
        );
      }
    }

    return updated;
  }

  private convertNrqlToDql(
    nrql: string,
    title: string,
  ): { dql: string; warnings: string[]; fullyConverted: boolean; confidence: string; fixes: string[] } {
    const result: CompileResult = this.compiler.compile(nrql, title || 'query');

    return {
      dql: result.dql,
      warnings: [...result.warnings],
      fullyConverted: result.success && result.confidence === 'HIGH',
      confidence: result.confidence,
      fixes: [...result.fixes],
    };
  }

  private transformVariables(
    variables: NRDashboardVariable[],
  ): { filters: unknown[]; genericTagFilters: unknown[] } {
    const tagFilters: unknown[] = [];

    for (const v of variables) {
      tagFilters.push({
        name: v.name ?? '',
        entityTypes: [],
        tagFilter: true,
      });
    }

    return { filters: [], genericTagFilters: tagFilters };
  }

  private mapPermissions(permissions: string | undefined): boolean {
    if (!permissions) return false;
    const map: Record<string, boolean> = {
      PUBLIC_READ_ONLY: true,
      PUBLIC_READ_WRITE: true,
      PRIVATE: false,
    };
    return map[permissions] ?? false;
  }
}
