import { describe, it, expect, beforeEach } from 'vitest';
import { LookupTableTransformer } from '../../src/transformers/index.js';

describe('LookupTableTransformer', () => {
  let transformer: LookupTableTransformer;

  beforeEach(() => {
    transformer = new LookupTableTransformer();
  });

  it('should fail when name is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({
      name: '',
      columns: ['id'],
      rows: [],
    });
    expect(result.success).toBe(false);
  });

  it('should fail when columns list is empty', () => {
    const result = transformer.transform({ name: 't', columns: [], rows: [] });
    expect(result.success).toBe(false);
  });

  it('should fail when lookupField is not in columns', () => {
    const result = transformer.transform({
      name: 't',
      columns: ['id', 'name'],
      rows: [['1', 'a']],
      lookupField: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('should emit JSONL content with one record per row', () => {
    const result = transformer.transform({
      name: 'env-map',
      columns: ['id', 'env'],
      rows: [
        ['svc-1', 'prod'],
        ['svc-2', 'staging'],
      ],
    });
    expect(result.success).toBe(true);
    const lines = result.data!.manifest.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ id: 'svc-1', env: 'prod' });
  });

  it('should default lookupField to first column and slugify file path', () => {
    const result = transformer.transform({
      name: 'Env Map!',
      columns: ['id', 'env'],
      rows: [],
    });
    expect(result.data!.manifest.lookupField).toBe('id');
    expect(result.data!.manifest.filePath).toBe('/lookups/env-map');
  });

  it('should include upload URL and DQL usage example', () => {
    const result = transformer.transform({
      name: 'env-map',
      columns: ['id', 'env'],
      rows: [['svc-1', 'prod']],
    });
    expect(result.data!.uploadUrl).toBe(
      '/platform/storage/resource-store/v1/files/tabular/lookup:upload',
    );
    expect(result.data!.dqlUsageExample).toContain('lookup');
    expect(result.data!.dqlUsageExample).toContain('env-map');
  });

  it('should warn on very large lookup tables', () => {
    const bigRows = new Array(100_001).fill(null).map((_, i) => [`k-${i}`, `v-${i}`]);
    const result = transformer.transform({
      name: 'big',
      columns: ['k', 'v'],
      rows: bigRows,
    });
    expect(result.warnings.some((w) => w.includes('size limit'))).toBe(true);
  });
});
