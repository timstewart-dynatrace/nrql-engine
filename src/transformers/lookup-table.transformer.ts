/**
 * Lookup Table Transformer — Converts New Relic lookup tables (used
 * for WHERE IN / value-expansion filters) to Dynatrace Grail
 * resource-store lookups consumable via the DQL `lookup` subquery.
 *
 * Gen3 output:
 *   - An upload manifest describing the resource-store entry (file
 *     path, parse pattern, lookup field) that consumers post to
 *     `/platform/storage/resource-store/v1/files/tabular/lookup:upload`
 *   - A DQL snippet showing how to reference the lookup from a query
 *     (replacing the original NRQL `WHERE <field> IN (<lookup>)` pattern)
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRLookupTableInput {
  readonly name: string;
  /** Column names in order. First column is the lookup key by default. */
  readonly columns: string[];
  /** Row data as arrays of cells, one per column in order. */
  readonly rows: Array<Array<string | number | boolean>>;
  /** Which column is the join key (defaults to columns[0]). */
  readonly lookupField?: string;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTLookupUploadManifest {
  readonly filePath: string;
  readonly parsePattern: 'HEADER,PAYLOAD';
  readonly lookupField: string;
  readonly overwrite: true;
  readonly displayName: string;
  /** JSONL body to POST as the `content` multipart part. */
  readonly content: string;
}

export interface LookupTableTransformData {
  readonly manifest: DTLookupUploadManifest;
  readonly uploadUrl: '/platform/storage/resource-store/v1/files/tabular/lookup:upload';
  readonly dqlUsageExample: string;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'POST the manifest JSON + JSONL content as multipart/form-data to the uploadUrl. An ingest token with `storage:lookup:write` scope is required.',
  'Update any NRQL queries that filtered by WHERE field IN (<lookup>) to use the emitted DQL `lookup` subquery pattern.',
  'If the lookup table was keyed by multiple columns in NR, pick one as `lookupField` — Grail lookups are single-key. Additional match columns can be returned as enriched fields and filtered downstream.',
];

function slugifyFilePath(name: string): string {
  return '/lookups/' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function rowToJsonLine(columns: string[], row: Array<string | number | boolean>): string {
  const record: Record<string, string | number | boolean> = {};
  columns.forEach((col, i) => {
    if (i < row.length) {
      record[col] = row[i]!;
    }
  });
  return JSON.stringify(record);
}

// ---------------------------------------------------------------------------
// LookupTableTransformer
// ---------------------------------------------------------------------------

export class LookupTableTransformer {
  transform(input: NRLookupTableInput): TransformResult<LookupTableTransformData> {
    try {
      const name = input.name?.trim();
      if (!name) {
        return failure(['Lookup table name is required']);
      }
      if (!Array.isArray(input.columns) || input.columns.length === 0) {
        return failure(['Lookup table columns are required']);
      }
      if (!Array.isArray(input.rows)) {
        return failure(['Lookup table rows are required']);
      }

      const warnings: string[] = [];

      const lookupField = input.lookupField ?? input.columns[0]!;
      if (!input.columns.includes(lookupField)) {
        return failure([`lookupField '${lookupField}' is not in columns`]);
      }

      const filePath = slugifyFilePath(name);
      const content = input.rows.map((row) => rowToJsonLine(input.columns, row)).join('\n');

      if (input.rows.length > 100_000) {
        warnings.push(
          `Lookup table has ${input.rows.length} rows — Grail resource-store has a size limit; split into multiple lookups if upload fails.`,
        );
      }

      const manifest: DTLookupUploadManifest = {
        filePath,
        parsePattern: 'HEADER,PAYLOAD',
        lookupField,
        overwrite: true,
        displayName: `[Migrated] ${name}`,
        content,
      };

      const dqlUsageExample =
        `// Replace WHERE <field> IN (<${name}>) with:\n` +
        `fetch logs\n` +
        `| lookup [fetch tabular, bucket:"${filePath}"],\n` +
        `    sourceField:<field>, lookupField:${lookupField},\n` +
        `    fields:{${input.columns.filter((c) => c !== lookupField).join(', ') || 'value'}}`;

      return success(
        {
          manifest,
          uploadUrl: '/platform/storage/resource-store/v1/files/tabular/lookup:upload',
          dqlUsageExample,
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRLookupTableInput[],
  ): TransformResult<LookupTableTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
