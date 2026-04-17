import { describe, it, expect } from 'vitest';
import {
  LegacyDashboardTransformer,
  LegacySLOTransformer,
  LegacySyntheticTransformer,
} from '../../src/transformers/index.js';

describe('LegacyDashboardTransformer', () => {
  const t = new LegacyDashboardTransformer();

  it('should fail without pages', () => {
    const result = t.transform({ name: 'x', pages: [] });
    expect(result.success).toBe(false);
  });

  it('should emit builtin:dashboards schema with tiles', () => {
    const result = t.transform({
      name: 'Prod ops',
      pages: [
        {
          name: 'Page 1',
          widgets: [
            {
              title: 'req count',
              visualization: { id: 'viz.line' },
              layout: { row: 0, column: 0, width: 4, height: 3 },
              rawConfiguration: {
                nrqlQueries: [{ accountId: 1, query: 'SELECT count(*) FROM Transaction' }],
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.schemaId).toBe('builtin:dashboards');
    expect(result.data!.tiles).toHaveLength(1);
    expect(result.data!.tiles[0]!.tileType).toBe('DATA_EXPLORER');
    expect(result.warnings[0]).toContain('legacy');
  });

  it('should warn and collapse multi-page dashboards', () => {
    const result = t.transform({
      name: 'Multi',
      pages: [
        { name: 'P1', widgets: [] },
        { name: 'P2', widgets: [] },
      ],
    });
    expect(result.warnings.some((w) => w.includes('multiple pages'))).toBe(true);
  });

  it('should emit MARKDOWN tileType for viz.markdown widgets', () => {
    const result = t.transform({
      name: 'Notes',
      pages: [
        {
          name: 'P',
          widgets: [
            {
              title: 'note',
              visualization: { id: 'viz.markdown' },
              rawConfiguration: { text: '**hi**' },
            },
          ],
        },
      ],
    });
    expect(result.data!.tiles[0]!.tileType).toBe('MARKDOWN');
    expect(result.data!.tiles[0]!.markdown).toBe('**hi**');
  });
});

describe('LegacySLOTransformer', () => {
  const t = new LegacySLOTransformer();

  it('should fail without objectives', () => {
    const result = t.transform({ name: 'x', objectives: [] });
    expect(result.success).toBe(false);
  });

  it('should emit v1 SLO payload with target + timeframe + legacy warning', () => {
    const result = t.transform({
      name: 'checkout availability',
      objectives: [{ target: 99.5, timeWindow: { rolling: { count: 7, unit: 'DAY' } } }],
      events: {
        validEvents: { where: 'appName = "checkout"' },
        goodEvents: { where: 'error IS NULL' },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data!.target).toBe(99.5);
    expect(result.data!.timeframe).toBe('-7d');
    expect(result.data!.numeratorValue).toContain('error IS NULL');
    expect(result.warnings[0]).toContain('legacy');
  });

  it('should warn on missing event queries', () => {
    const result = t.transform({
      name: 'bare',
      objectives: [{ target: 95, timeWindow: { rolling: { count: 30, unit: 'DAY' } } }],
    });
    expect(result.warnings.some((w) => w.includes('missing one or both'))).toBe(true);
  });
});

describe('LegacySyntheticTransformer', () => {
  const t = new LegacySyntheticTransformer();

  it('should emit HTTP monitor for SIMPLE type', () => {
    const result = t.transform({
      name: 'health',
      monitorType: 'SIMPLE',
      monitoredUrl: 'https://acme.com',
      period: 'EVERY_5_MINUTES',
      status: 'ENABLED',
    });
    expect(result.success).toBe(true);
    expect(result.data!.type).toBe('HTTP');
    expect(result.data!.frequencyMin).toBe(5);
    expect(result.warnings[0]).toContain('legacy');
  });

  it('should emit HTTP_MULTI_STEP for SCRIPT_API', () => {
    const result = t.transform({
      name: 'api',
      monitorType: 'SCRIPT_API',
      period: 'EVERY_15_MINUTES',
    });
    expect(result.data!.type).toBe('HTTP_MULTI_STEP');
    expect(result.data!.frequencyMin).toBe(15);
  });

  it('should emit BROWSER for scripted-browser monitors with warning', () => {
    const result = t.transform({
      name: 'browser',
      monitorType: 'SCRIPT_BROWSER',
      period: 'EVERY_HOUR',
    });
    expect(result.data!.type).toBe('BROWSER');
    expect(result.warnings.some((w) => w.includes('richer clickpath'))).toBe(true);
  });

  it('should default disabled status when set to DISABLED', () => {
    const result = t.transform({
      name: 'x',
      monitorType: 'SIMPLE',
      monitoredUrl: 'https://x',
      period: 'EVERY_HOUR',
      status: 'DISABLED',
    });
    expect(result.data!.enabled).toBe(false);
  });
});
