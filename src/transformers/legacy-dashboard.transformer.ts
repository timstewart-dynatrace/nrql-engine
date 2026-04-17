/**
 * Legacy Dashboard Transformer (Gen2 classic dashboard JSON shape).
 *
 * For parity with Dynatrace tenants that have not migrated to Grail-
 * native Documents. Emits the `builtin:dashboards` classic schema with
 * `dashboardMetadata` + `tiles[]` in the pre-Gen3 format. Every
 * conversion prepends a warning flagging that this is legacy output.
 *
 * Consumers must opt in via `createTransformer('dashboard', { legacy:
 * true })` — the default remains the Grail-native DashboardTransformer.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';
import type {
  NRDashboardInput,
  NRWidget,
} from './dashboard.transformer.js';

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LegacyDTDashboard {
  readonly schemaId: 'builtin:dashboards';
  readonly displayName: string;
  readonly dashboardMetadata: {
    readonly name: string;
    readonly shared: boolean;
    readonly owner: string;
  };
  readonly tiles: LegacyDTTile[];
}

export interface LegacyDTTile {
  readonly name: string;
  readonly tileType: 'DATA_EXPLORER' | 'MARKDOWN' | 'HEADER';
  readonly bounds: { top: number; left: number; width: number; height: number };
  readonly query: string | undefined;
  readonly markdown: string | undefined;
}

// ---------------------------------------------------------------------------
// LegacyDashboardTransformer
// ---------------------------------------------------------------------------

export class LegacyDashboardTransformer {
  transform(input: NRDashboardInput): TransformResult<LegacyDTDashboard> {
    try {
      const name = input.name ?? 'Unnamed Dashboard';
      const warnings: string[] = [
        'Emitting Gen2 classic dashboard (legacy). Default output is a Grail-native Document — use DashboardTransformer unless legacy parity is required.',
      ];

      const pages = input.pages ?? [];
      if (pages.length === 0) {
        return failure([`Dashboard '${name}' has no pages`]);
      }
      const firstPage = pages[0]!;

      const tiles: LegacyDTTile[] = (firstPage.widgets ?? []).map((w, i) =>
        this.convertWidget(w, i),
      );

      if (pages.length > 1) {
        warnings.push(
          `Legacy Gen2 dashboards do not support multiple pages natively; collapsed ${pages.length} pages onto page 1 only. Use the Gen3 DashboardTransformer for multi-page support.`,
        );
      }

      const dashboard: LegacyDTDashboard = {
        schemaId: 'builtin:dashboards',
        displayName: `[Migrated Legacy] ${name}`,
        dashboardMetadata: {
          name: `[Migrated Legacy] ${name}`,
          shared: true,
          owner: 'nr-migrated',
        },
        tiles,
      };

      return success(dashboard, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(inputs: NRDashboardInput[]): TransformResult<LegacyDTDashboard>[] {
    return inputs.map((i) => this.transform(i));
  }

  private convertWidget(w: NRWidget, index: number): LegacyDTTile {
    const title = w.title ?? `Widget ${index + 1}`;
    const layout = w.layout ?? { row: 0, column: 0, width: 4, height: 3 };
    const nrqlQuery = w.rawConfiguration?.nrqlQueries?.[0]?.query;
    const viz = w.visualization?.id ?? 'viz.line';
    const isMarkdown = viz === 'viz.markdown';

    return {
      name: title,
      tileType: isMarkdown ? 'MARKDOWN' : 'DATA_EXPLORER',
      bounds: {
        top: (layout.row ?? 0) * 38,
        left: (layout.column ?? 0) * 76,
        width: (layout.width ?? 4) * 76,
        height: (layout.height ?? 3) * 38,
      },
      query: isMarkdown
        ? undefined
        : `// NRQL source: ${nrqlQuery ?? ''}\n// TODO: compile via nrql-engine before use`,
      markdown: isMarkdown ? w.rawConfiguration?.text ?? '' : undefined,
    };
  }
}
