/**
 * NRDB archive helper (P15-11).
 *
 * Pure-data port of the Python `tools/nrdb_archive.py`. This helper
 * **does not perform HTTP, write files, or hold state of its own** —
 * the caller injects three I/O primitives:
 *
 *   - `runQuery(cursor?)` — hits NR NerdGraph / NRQL and returns a
 *     batch of records plus the next cursor (or `undefined` when
 *     exhausted)
 *   - `persistBatch(records, batchIndex)` — writes a batch somewhere
 *     (file / S3 / BigQuery load job / Azure Blob / …)
 *   - `persistCursor(cursor)` / `readCursor()` — round-trip the
 *     resume cursor to durable storage
 *
 * The archive driver itself is a small coordinator that loops until
 * `runQuery` signals exhaustion, respecting a configurable `maxBatches`
 * bound and an optional `AbortSignal`. It returns a manifest
 * describing how many records landed in each batch so the caller can
 * build a deterministic audit record.
 */

// ---------------------------------------------------------------------------
// Injected I/O contract
// ---------------------------------------------------------------------------

export interface NrdbBatch<R> {
  readonly records: readonly R[];
  readonly nextCursor: string | undefined;
}

export type RunQueryFn<R> = (
  cursor: string | undefined,
) => Promise<NrdbBatch<R>>;

export type PersistBatchFn<R> = (
  records: readonly R[],
  batchIndex: number,
) => Promise<void>;

export type PersistCursorFn = (cursor: string | undefined) => Promise<void>;

export type ReadCursorFn = () => Promise<string | undefined>;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NrdbArchiveOptions<R> {
  readonly runQuery: RunQueryFn<R>;
  readonly persistBatch: PersistBatchFn<R>;
  readonly persistCursor?: PersistCursorFn;
  readonly readCursor?: ReadCursorFn;
  /** Hard cap on the number of batches to process. Default: `Infinity`. */
  readonly maxBatches?: number;
  /** Stop early when the cumulative record count meets this limit. */
  readonly maxRecords?: number;
  /** Abort the archive mid-flight. */
  readonly signal?: AbortSignal;
  /** Optional progress callback fired after each persisted batch. */
  readonly onBatch?: (info: {
    batchIndex: number;
    batchSize: number;
    totalRecords: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface NrdbArchiveManifestEntry {
  readonly batchIndex: number;
  readonly recordCount: number;
  readonly cursor: string | undefined;
}

export interface NrdbArchiveResult {
  readonly totalRecords: number;
  readonly totalBatches: number;
  readonly finalCursor: string | undefined;
  readonly manifest: NrdbArchiveManifestEntry[];
  readonly status: 'EXHAUSTED' | 'MAX_BATCHES' | 'MAX_RECORDS' | 'ABORTED';
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export async function runNrdbArchive<R>(
  options: NrdbArchiveOptions<R>,
): Promise<NrdbArchiveResult> {
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;

  // Resume from the persisted cursor if a reader is supplied.
  let cursor: string | undefined = options.readCursor
    ? await options.readCursor()
    : undefined;

  const manifest: NrdbArchiveManifestEntry[] = [];
  let totalRecords = 0;
  let batchIndex = 0;
  let status: NrdbArchiveResult['status'] = 'EXHAUSTED';

  while (batchIndex < maxBatches) {
    if (options.signal?.aborted) {
      status = 'ABORTED';
      break;
    }

    const batch = await options.runQuery(cursor);
    if (batch.records.length === 0 && batch.nextCursor === undefined) {
      // Empty final response. Treat as exhaustion.
      break;
    }

    if (batch.records.length > 0) {
      await options.persistBatch(batch.records, batchIndex);
      totalRecords += batch.records.length;
    }

    manifest.push({
      batchIndex,
      recordCount: batch.records.length,
      cursor: batch.nextCursor,
    });

    if (options.persistCursor) {
      await options.persistCursor(batch.nextCursor);
    }

    options.onBatch?.({
      batchIndex,
      batchSize: batch.records.length,
      totalRecords,
    });

    cursor = batch.nextCursor;
    batchIndex++;

    if (cursor === undefined) {
      // Query signalled exhaustion.
      break;
    }
    if (totalRecords >= maxRecords) {
      status = 'MAX_RECORDS';
      break;
    }
  }

  if (status === 'EXHAUSTED' && batchIndex >= maxBatches) {
    status = 'MAX_BATCHES';
  }

  return {
    totalRecords,
    totalBatches: batchIndex,
    finalCursor: cursor,
    manifest,
    status,
  };
}
