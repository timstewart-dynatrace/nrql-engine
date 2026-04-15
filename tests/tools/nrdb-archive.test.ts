import { describe, it, expect } from 'vitest';
import { runNrdbArchive } from '../../src/tools/nrdb-archive.js';

interface Row {
  id: number;
}

function buildMockQuery(batches: Array<{ records: Row[]; nextCursor?: string }>) {
  let idx = 0;
  return async (_cursor: string | undefined) => {
    const next = batches[idx++];
    if (!next) return { records: [] as Row[], nextCursor: undefined };
    return { records: next.records, nextCursor: next.nextCursor };
  };
}

describe('runNrdbArchive', () => {
  it('walks until exhaustion', async () => {
    const batches = [
      { records: [{ id: 1 }, { id: 2 }], nextCursor: 'c1' },
      { records: [{ id: 3 }], nextCursor: undefined },
    ];
    const persisted: Array<Row[]> = [];
    const result = await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async (records) => {
        persisted.push([...records]);
      },
    });
    expect(result.status).toBe('EXHAUSTED');
    expect(result.totalRecords).toBe(3);
    expect(result.totalBatches).toBe(2);
    expect(persisted).toHaveLength(2);
    expect(persisted[0]!).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('resumes from a persisted cursor', async () => {
    let starterCursor: string | undefined;
    const runQuery = async (cursor: string | undefined) => {
      starterCursor = cursor;
      return { records: [] as Row[], nextCursor: undefined };
    };
    await runNrdbArchive<Row>({
      runQuery,
      persistBatch: async () => {},
      readCursor: async () => 'resume-from-here',
    });
    expect(starterCursor).toBe('resume-from-here');
  });

  it('calls persistCursor after each batch', async () => {
    const cursors: Array<string | undefined> = [];
    const batches = [
      { records: [{ id: 1 }], nextCursor: 'c1' },
      { records: [{ id: 2 }], nextCursor: 'c2' },
      { records: [{ id: 3 }], nextCursor: undefined },
    ];
    await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async () => {},
      persistCursor: async (c) => {
        cursors.push(c);
      },
    });
    expect(cursors).toEqual(['c1', 'c2', undefined]);
  });

  it('stops at maxBatches and flags status', async () => {
    const batches = [
      { records: [{ id: 1 }], nextCursor: 'c1' },
      { records: [{ id: 2 }], nextCursor: 'c2' },
      { records: [{ id: 3 }], nextCursor: 'c3' },
    ];
    const result = await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async () => {},
      maxBatches: 2,
    });
    expect(result.status).toBe('MAX_BATCHES');
    expect(result.totalBatches).toBe(2);
  });

  it('stops at maxRecords and flags status', async () => {
    const batches = [
      { records: [{ id: 1 }, { id: 2 }], nextCursor: 'c1' },
      { records: [{ id: 3 }, { id: 4 }], nextCursor: 'c2' },
    ];
    const result = await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async () => {},
      maxRecords: 3,
    });
    expect(result.status).toBe('MAX_RECORDS');
    expect(result.totalRecords).toBeGreaterThanOrEqual(3);
  });

  it('respects AbortSignal', async () => {
    const controller = new AbortController();
    const batches = [
      { records: [{ id: 1 }], nextCursor: 'c1' },
      { records: [{ id: 2 }], nextCursor: 'c2' },
    ];
    let batchIndex = 0;
    const result = await runNrdbArchive<Row>({
      runQuery: async (_cursor) => {
        if (batchIndex === 1) controller.abort();
        return batches[batchIndex++] ?? { records: [], nextCursor: undefined };
      },
      persistBatch: async () => {},
      signal: controller.signal,
    });
    expect(result.status).toBe('ABORTED');
  });

  it('invokes onBatch callback', async () => {
    const calls: Array<{ batchIndex: number; batchSize: number; totalRecords: number }> = [];
    const batches = [
      { records: [{ id: 1 }], nextCursor: 'c1' },
      { records: [{ id: 2 }, { id: 3 }], nextCursor: undefined },
    ];
    await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async () => {},
      onBatch: (info) => calls.push(info),
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.totalRecords).toBe(3);
  });

  it('manifest entries track batch size + cursor', async () => {
    const batches = [
      { records: [{ id: 1 }, { id: 2 }], nextCursor: 'c1' },
      { records: [{ id: 3 }], nextCursor: undefined },
    ];
    const result = await runNrdbArchive<Row>({
      runQuery: buildMockQuery(batches),
      persistBatch: async () => {},
    });
    expect(result.manifest).toHaveLength(2);
    expect(result.manifest[0]!.recordCount).toBe(2);
    expect(result.manifest[0]!.cursor).toBe('c1');
    expect(result.manifest[1]!.cursor).toBeUndefined();
  });
});
