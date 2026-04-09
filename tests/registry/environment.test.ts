/**
 * Tests for DTEnvironmentRegistry -- all public methods with mocked HTTP.
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import axios from 'axios';

import { DTEnvironmentRegistry, SYNONYMS } from '../../src/registry/index.js';

// ---------------------------------------------------------------------------
// Mock axios
// ---------------------------------------------------------------------------

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      isAxiosError: vi.fn(() => false),
    },
  };
});

const mockedAxiosGet = axios.get as Mock;
const mockedAxiosPost = axios.post as Mock;

function mockApiResponse(data: Record<string, unknown>, status = 200) {
  return { data, status };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DTEnvironmentRegistry init', () => {
  it('should set live and platform URLs', () => {
    const r = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'test',
    );
    expect(r.liveUrl).toContain('live');
    expect(r.platformUrl).toContain('apps');
  });

  it('should strip trailing slash', () => {
    const r = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com/',
      '',
      'test',
    );
    expect(r.dtUrl.endsWith('/')).toBe(false);
  });

  it('should accept apps URL', () => {
    const r = new DTEnvironmentRegistry(
      'https://abc123.apps.dynatrace.com',
      '',
      'test',
    );
    expect(r.liveUrl).toContain('live');
    expect(r.platformUrl).toContain('apps');
  });
});

describe('SYNONYMS', () => {
  it('should have semantic groups', () => {
    expect(SYNONYMS['error']).toBeDefined();
    expect(SYNONYMS['memory']).toBeDefined();
    expect(SYNONYMS['cpu']).toBeDefined();
  });

  it('error synonyms should include failure', () => {
    expect(SYNONYMS['error'].has('failure')).toBe(true);
  });
});

describe('DTEnvironmentRegistry tokenSimilarity', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
  });

  it('should return 1 for identical', () => {
    const tokens = new Set(['host', 'cpu', 'usage']);
    expect(registry.tokenSimilarity(tokens, tokens)).toBe(1.0);
  });

  it('should return 0 for disjoint', () => {
    expect(
      registry.tokenSimilarity(new Set(['a', 'b']), new Set(['c', 'd'])),
    ).toBe(0.0);
  });

  it('should score synonym matches', () => {
    // "error" and "failure" are synonyms
    const score = registry.tokenSimilarity(
      new Set(['error', 'count']),
      new Set(['failure', 'count']),
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('should handle empty sets', () => {
    expect(registry.tokenSimilarity(new Set(), new Set(['a']))).toBe(0.0);
  });
});

describe('DTEnvironmentRegistry tokenize', () => {
  it('should split on dots and underscores', () => {
    const tokens = DTEnvironmentRegistry.tokenize('dt.host.cpu.usage');
    expect(tokens).toEqual(new Set(['dt', 'host', 'cpu', 'usage']));
  });

  it('should lowercase', () => {
    const tokens = DTEnvironmentRegistry.tokenize('Host.CPU');
    expect(tokens.has('host')).toBe(true);
    expect(tokens.has('cpu')).toBe(true);
  });
});

describe('DTEnvironmentRegistry metric registry', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should check metric exists', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        metrics: [
          { metricId: 'dt.host.cpu.usage', displayName: 'CPU Usage', unit: 'Percent' },
        ],
        nextPageKey: null,
      }),
    );

    const exists = await registry.metricExists('dt.host.cpu.usage');
    expect(exists).toBe(true);

    const notExists = await registry.metricExists('dt.nonexistent');
    expect(notExists).toBe(false);
  });

  it('should get metric info', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        metrics: [
          { metricId: 'dt.host.cpu.usage', displayName: 'CPU', unit: '%' },
        ],
        nextPageKey: null,
      }),
    );

    const info = await registry.getMetricInfo('dt.host.cpu.usage');
    expect(info).toBeDefined();
    expect(info!.displayName).toBe('CPU');
  });

  it('should return undefined for unknown metric', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({ metrics: [], nextPageKey: null }),
    );

    const info = await registry.getMetricInfo('dt.nonexistent');
    expect(info).toBeUndefined();
  });
});

describe('DTEnvironmentRegistry findMetric', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should fuzzy find similar metric', async () => {
    mockedAxiosGet.mockResolvedValue(
      mockApiResponse({
        metrics: [
          { metricId: 'dt.host.cpu.usage' },
          { metricId: 'dt.host.cpu.system' },
          { metricId: 'dt.host.memory.usage' },
        ],
        nextPageKey: null,
      }),
    );

    const result = await registry.findMetric('dt.host.cpu.utilization');
    // Should find a cpu-related metric via synonym/token matching
    expect(result).toBeDefined();
    expect(result!).toContain('cpu');
  });
});

describe('DTEnvironmentRegistry entity registry', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should find entity by name', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        entities: [
          {
            entityId: 'SERVICE-123',
            displayName: 'my-api-service',
            tags: [],
            type: 'SERVICE',
            properties: {},
          },
        ],
        nextPageKey: null,
      }),
    );

    const entity = await registry.findEntity('my-api-service', 'SERVICE');
    expect(entity).toBeDefined();
    expect(entity!.name).toBe('my-api-service');
  });

  it('should return undefined for unknown entity', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({ entities: [], nextPageKey: null }),
    );

    const result = await registry.findEntity('nonexistent', 'SERVICE');
    expect(result).toBeUndefined();
  });
});

describe('DTEnvironmentRegistry dashboard registry', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      'test-oauth',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should check dashboard exists', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        documents: [{ id: 'doc1', name: 'My Dashboard', owner: '', modificationInfo: {} }],
      }),
    );

    const result = await registry.dashboardExists('My Dashboard');
    expect(result).toBe('doc1');
  });

  it('should return undefined for nonexistent', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({ documents: [] }),
    );

    const result = await registry.dashboardExists('Nonexistent');
    expect(result).toBeUndefined();
  });
});

describe('DTEnvironmentRegistry management zone registry', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should find management zone', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        items: [
          {
            objectId: 'mz-1',
            value: { name: 'Production', rules: [] },
          },
        ],
        nextPageKey: null,
      }),
    );

    const mz = await registry.findManagementZone('Production');
    expect(mz).toBeDefined();
    expect(mz!.name).toBe('Production');
  });
});

describe('DTEnvironmentRegistry synthetic location registry', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should find location by city', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        locations: [
          {
            entityId: 'loc1',
            name: 'N. Virginia',
            city: 'N. Virginia',
            type: 'PUBLIC',
            countryCode: 'US',
            regionCode: '',
            cloudPlatform: 'AWS',
            status: 'ENABLED',
          },
        ],
      }),
    );

    const loc = await registry.findSyntheticLocation('N. Virginia');
    expect(loc).toBeDefined();
  });

  it('should map AWS region', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        locations: [
          {
            entityId: 'loc1',
            name: 'N. Virginia',
            city: 'N. Virginia',
            type: 'PUBLIC',
            countryCode: 'US',
            regionCode: '',
            cloudPlatform: 'AWS',
            status: 'ENABLED',
          },
        ],
      }),
    );

    const loc = await registry.findSyntheticLocation('AWS_US_EAST_1');
    expect(loc).toBeDefined();
  });
});

describe('DTEnvironmentRegistry validateDqlSyntax', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    mockedAxiosPost.mockReset();
    mockedAxiosGet.mockReset();
  });

  it('should return undefined isValid without OAuth', async () => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',  // no oauth
      'dt0c01.TEST',
    );

    const result = await registry.validateDqlSyntax('fetch logs');
    expect(result.isValid).toBeUndefined();
  });

  it('should return valid on 200', async () => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      'test-oauth',
      'dt0c01.TEST',
    );

    mockedAxiosPost.mockResolvedValueOnce({
      data: { records: [] },
      status: 200,
    });

    const result = await registry.validateDqlSyntax('fetch logs | limit 1');
    expect(result.isValid).toBe(true);
  });
});

describe('DTEnvironmentRegistry summary', () => {
  let registry: DTEnvironmentRegistry;

  beforeEach(() => {
    registry = new DTEnvironmentRegistry(
      'https://abc123.live.dynatrace.com',
      '',
      'dt0c01.TEST',
    );
    mockedAxiosGet.mockReset();
  });

  it('should return empty when nothing loaded', () => {
    const s = registry.summary();
    expect(s).toEqual({});
  });

  it('should count metrics after load', async () => {
    mockedAxiosGet.mockResolvedValueOnce(
      mockApiResponse({
        metrics: [
          { metricId: 'dt.host.cpu.usage' },
          { metricId: 'builtin:host.cpu' },
        ],
        nextPageKey: null,
      }),
    );

    await registry.metricExists('dt.host.cpu.usage'); // triggers load
    const s = registry.summary();
    expect(s['metrics']).toBeGreaterThanOrEqual(1);
  });
});
