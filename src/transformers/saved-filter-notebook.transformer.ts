/**
 * Saved Filter / Data App → Notebook Transformer — Converts NR saved
 * filter sets and Data Apps to Dynatrace Notebook document payloads.
 *
 * NR side: a saved filter is a named combination of WHERE-clauses +
 * time range. A Data App layers on widget panels + text notes.
 *
 * DT side: Notebooks (`builtin:documents.notebook`) are the natural
 * home for both — each saved filter becomes a notebook section with
 * the filter encoded as a DQL snippet; each Data App widget becomes a
 * notebook cell.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRSavedFilter {
  readonly name: string;
  readonly whereClause: string;
  readonly from?: string;
  readonly timeframe?: string;
}

export interface NRDataAppWidget {
  readonly title: string;
  readonly nrql?: string;
  readonly markdown?: string;
}

export interface NRSavedFilterSetInput {
  readonly name: string;
  readonly filters: NRSavedFilter[];
  readonly widgets?: NRDataAppWidget[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type DTNotebookCell =
  | { readonly type: 'markdown'; readonly content: string }
  | { readonly type: 'dql'; readonly query: string; readonly title: string };

export interface DTNotebookPayload {
  readonly type: 'notebook';
  readonly name: string;
  readonly content: { readonly cells: DTNotebookCell[] };
}

export interface SavedFilterNotebookTransformData {
  readonly notebook: DTNotebookPayload;
  readonly manualSteps: string[];
}

const MANUAL_STEPS: string[] = [
  'POST the notebook payload to /platform/document/v1/documents with type="notebook". The existing Document API client handles the request envelope.',
  'DQL cells carry the original NRQL as a comment — run nrql-engine.compile() on each before production use.',
  'Saved-filter notebooks are not versioned with the rest of your dashboards. If you need durability, persist them to the same source-control bundle as your Terraform dashboards.',
];

// ---------------------------------------------------------------------------
// SavedFilterNotebookTransformer
// ---------------------------------------------------------------------------

export class SavedFilterNotebookTransformer {
  transform(
    input: NRSavedFilterSetInput,
  ): TransformResult<SavedFilterNotebookTransformData> {
    try {
      if (!input.name?.trim()) return failure(['name is required']);
      if (!Array.isArray(input.filters) || input.filters.length === 0) {
        return failure(['At least one saved filter is required']);
      }
      const warnings: string[] = [];
      const cells: DTNotebookCell[] = [];

      cells.push({
        type: 'markdown',
        content: `# ${input.name}\n\n_Migrated from New Relic saved filter set._`,
      });

      for (const f of input.filters) {
        cells.push({
          type: 'markdown',
          content: `## ${f.name}\n\n**WHERE:** \`${f.whereClause}\``,
        });
        const from = f.from ?? 'spans';
        const timeframe = f.timeframe ?? '-24h';
        cells.push({
          type: 'dql',
          title: f.name,
          query:
            `// NRQL source: WHERE ${f.whereClause}\n` +
            `fetch ${from}, from:${timeframe}\n` +
            `| filter /* TODO: compile via nrql-engine */ true\n` +
            `| summarize count()`,
        });
      }

      for (const w of input.widgets ?? []) {
        if (w.markdown) {
          cells.push({ type: 'markdown', content: w.markdown });
        } else if (w.nrql) {
          cells.push({
            type: 'dql',
            title: w.title,
            query: `// NRQL source: ${w.nrql}\nfetch events, from:-1h\n| summarize count()`,
          });
          warnings.push(
            `Data-app widget '${w.title}' has NRQL — compile via nrql-engine before enabling.`,
          );
        } else {
          warnings.push(
            `Data-app widget '${w.title}' has neither markdown nor nrql; skipped.`,
          );
        }
      }

      const notebook: DTNotebookPayload = {
        type: 'notebook',
        name: `[Migrated] ${input.name}`,
        content: { cells },
      };

      return success(
        { notebook, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRSavedFilterSetInput[],
  ): TransformResult<SavedFilterNotebookTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
