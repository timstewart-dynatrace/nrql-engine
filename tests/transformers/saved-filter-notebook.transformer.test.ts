import { describe, it, expect, beforeEach } from 'vitest';
import { SavedFilterNotebookTransformer } from '../../src/transformers/index.js';

describe('SavedFilterNotebookTransformer', () => {
  let transformer: SavedFilterNotebookTransformer;

  beforeEach(() => {
    transformer = new SavedFilterNotebookTransformer();
  });

  it('should fail without filters', () => {
    const result = transformer.transform({ name: 'x', filters: [] });
    expect(result.success).toBe(false);
  });

  it('should emit notebook payload with markdown header + per-filter sections', () => {
    const result = transformer.transform({
      name: 'Checkout debugging',
      filters: [
        { name: 'Errors only', whereClause: "error IS NOT NULL" },
        { name: 'High latency', whereClause: 'duration > 1000' },
      ],
    });
    expect(result.success).toBe(true);
    const nb = result.data!.notebook;
    expect(nb.type).toBe('notebook');
    expect(nb.name).toContain('Migrated');
    // 1 top-level markdown + 2 filters × 2 cells (md + dql) = 5
    expect(nb.content.cells).toHaveLength(5);
    expect(nb.content.cells[0]!.type).toBe('markdown');
  });

  it('should include TODO placeholder inside each emitted DQL cell', () => {
    const result = transformer.transform({
      name: 'x',
      filters: [{ name: 'f1', whereClause: 'level = "ERROR"' }],
    });
    const dqlCell = result.data!.notebook.content.cells.find(
      (c) => c.type === 'dql',
    );
    expect(dqlCell).toBeDefined();
    if (dqlCell && dqlCell.type === 'dql') {
      expect(dqlCell.query).toContain('TODO');
    }
  });

  it('should convert data-app widgets (markdown + nrql) to cells', () => {
    const result = transformer.transform({
      name: 'x',
      filters: [{ name: 'f', whereClause: 'x = 1' }],
      widgets: [
        { title: 'Header note', markdown: '**Important:** do not delete' },
        { title: 'Traffic', nrql: 'SELECT count(*) FROM Transaction' },
      ],
    });
    const cells = result.data!.notebook.content.cells;
    expect(cells.some((c) => c.type === 'markdown' && c.content.includes('Important'))).toBe(
      true,
    );
    expect(cells.some((c) => c.type === 'dql' && c.title === 'Traffic')).toBe(true);
    expect(result.warnings.some((w) => w.includes('Traffic'))).toBe(true);
  });

  it('should warn + skip widgets with neither markdown nor nrql', () => {
    const result = transformer.transform({
      name: 'x',
      filters: [{ name: 'f', whereClause: 'x = 1' }],
      widgets: [{ title: 'empty' }],
    });
    expect(result.warnings.some((w) => w.includes('empty'))).toBe(true);
  });
});
