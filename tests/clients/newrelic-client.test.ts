/**
 * Tests for NewRelicClient -- all public methods with mocked HTTP.
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import axios from 'axios';

import { NewRelicClient } from '../../src/clients/index.js';
import type { NerdGraphResponse } from '../../src/clients/index.js';

// ---------------------------------------------------------------------------
// Mock axios
// ---------------------------------------------------------------------------

vi.mock('axios', () => {
  const mockAxiosInstance = {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      isAxiosError: vi.fn(() => false),
    },
  };
});

function getMockHttp() {
  // Retrieve the mock instance returned by axios.create
  const createMock = axios.create as Mock;
  return createMock.mock.results[createMock.mock.results.length - 1]
    ?.value as ReturnType<typeof axios.create> & {
    post: Mock;
    get: Mock;
    put: Mock;
    delete: Mock;
    request: Mock;
  };
}

function mockNerdGraphResponse(
  data: Record<string, unknown> | null,
  errors?: Record<string, unknown>[] | null,
): { data: { data: unknown; errors: unknown } } {
  return {
    data: {
      data: data,
      errors: errors ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NerdGraphResponse shape', () => {
  it('should be success with no errors', async () => {
    const client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    const http = getMockHttp();
    http.post.mockResolvedValueOnce(mockNerdGraphResponse({ test: 1 }));

    const resp = await client.executeQuery('{ actor { user { name } } }');
    expect(resp.isSuccess).toBe(true);
    expect(resp.data).toEqual({ test: 1 });
  });

  it('should be success with empty errors', async () => {
    const client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    const http = getMockHttp();
    http.post.mockResolvedValueOnce(mockNerdGraphResponse({ test: 1 }, []));

    const resp = await client.executeQuery('{ test }');
    expect(resp.isSuccess).toBe(true);
  });

  it('should not be success with errors', async () => {
    const client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    const http = getMockHttp();
    http.post.mockResolvedValueOnce(
      mockNerdGraphResponse(null, [{ message: 'bad' }]),
    );

    const resp = await client.executeQuery('{ test }');
    expect(resp.isSuccess).toBe(false);
  });
});

describe('NewRelicClient init', () => {
  it('should set US endpoint by default', () => {
    const client = new NewRelicClient({
      apiKey: 'key',
      accountId: '123',
      rateLimit: 0,
    });
    // Verify axios.create was called with US endpoint
    const createMock = axios.create as Mock;
    const lastCall = createMock.mock.calls[createMock.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain('api.newrelic.com');
  });

  it('should set EU endpoint', () => {
    const client = new NewRelicClient({
      apiKey: 'key',
      accountId: '123',
      region: 'EU',
      rateLimit: 0,
    });
    const createMock = axios.create as Mock;
    const lastCall = createMock.mock.calls[createMock.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain('api.eu.newrelic.com');
  });

  it('should set API key header', () => {
    const client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '123',
      rateLimit: 0,
    });
    const createMock = axios.create as Mock;
    const lastCall = createMock.mock.calls[createMock.mock.calls.length - 1][0];
    expect(lastCall.headers['API-Key']).toBe('NRAK-TEST');
  });
});

describe('NewRelicClient executeQuery', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return data on success', async () => {
    http.post.mockResolvedValueOnce(mockNerdGraphResponse({ result: 42 }));

    const resp = await client.executeQuery('{ actor { user { name } } }');
    expect(resp.isSuccess).toBe(true);
    expect(resp.data).toBeDefined();
    expect((resp.data as Record<string, unknown>)['result']).toBe(42);
  });

  it('should return error on HTTP failure', async () => {
    http.post.mockRejectedValueOnce(new Error('Connection failed'));

    const resp = await client.executeQuery('{ actor { } }');
    expect(resp.isSuccess).toBe(false);
    expect(resp.errors).toBeDefined();
    expect(resp.errors!.length).toBe(1);
  });

  it('should pass variables', async () => {
    http.post.mockResolvedValueOnce(mockNerdGraphResponse({}));

    await client.executeQuery('query($id: Int!)', { id: 1 });
    expect(http.post).toHaveBeenCalledWith('', expect.objectContaining({
      query: 'query($id: Int!)',
      variables: { id: 1 },
    }));
  });
});

describe('NewRelicClient getDashboards', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return dashboards', async () => {
    const searchData = {
      actor: {
        entitySearch: {
          results: {
            entities: [{ guid: 'abc', name: 'Test' }],
            nextCursor: null,
          },
        },
      },
    };
    const detailData = {
      actor: {
        entity: { guid: 'abc', name: 'Test', pages: [] },
      },
    };
    http.post
      .mockResolvedValueOnce(mockNerdGraphResponse(searchData))
      .mockResolvedValueOnce(mockNerdGraphResponse(detailData));

    const dashboards = await client.getAllDashboards();
    expect(dashboards.length).toBe(1);
    expect(dashboards[0]['name']).toBe('Test');
  });

  it('should return empty on error', async () => {
    http.post.mockResolvedValueOnce(
      mockNerdGraphResponse(null, [{ message: 'err' }]),
    );

    const dashboards = await client.getAllDashboards();
    expect(dashboards).toEqual([]);
  });
});

describe('NewRelicClient getDashboardDefinition', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return full definition', async () => {
    const data = {
      actor: { entity: { guid: 'abc', name: 'My Dash', pages: [] } },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const result = await client.getDashboardDefinition('abc');
    expect(result).toBeDefined();
    expect(result!['name']).toBe('My Dash');
  });

  it('should return undefined on error', async () => {
    http.post.mockResolvedValueOnce(
      mockNerdGraphResponse(null, [{ message: 'err' }]),
    );

    const result = await client.getDashboardDefinition('abc');
    expect(result).toBeUndefined();
  });
});

describe('NewRelicClient getAlertPolicies', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return policies with conditions', async () => {
    const policyData = {
      actor: {
        account: {
          alerts: {
            policiesSearch: {
              policies: [{ id: '1', name: 'Critical' }],
              nextCursor: null,
            },
          },
        },
      },
    };
    const conditionData = {
      actor: {
        account: {
          alerts: {
            nrqlConditionsSearch: {
              nrqlConditions: [{ id: 'c1', name: 'High Error Rate' }],
              nextCursor: null,
            },
          },
        },
      },
    };
    http.post
      .mockResolvedValueOnce(mockNerdGraphResponse(policyData))
      .mockResolvedValueOnce(mockNerdGraphResponse(conditionData));

    const policies = await client.getAllAlertPolicies();
    expect(policies.length).toBe(1);
    expect(policies[0]['name']).toBe('Critical');
    const conditions = policies[0]['conditions'] as unknown[];
    expect(conditions.length).toBe(1);
  });
});

describe('NewRelicClient getAlertConditions', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return NRQL conditions', async () => {
    const data = {
      actor: {
        account: {
          alerts: {
            nrqlConditionsSearch: {
              nrqlConditions: [
                { id: 'c1', name: 'Latency' },
                { id: 'c2', name: 'Errors' },
              ],
              nextCursor: null,
            },
          },
        },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const conditions = await client.getAlertConditions('policy-1');
    expect(conditions.length).toBe(2);
    expect(
      conditions.every((c) => c['conditionType'] === 'NRQL'),
    ).toBe(true);
  });
});

describe('NewRelicClient getNotificationChannels', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return channels', async () => {
    const data = {
      actor: {
        account: {
          aiNotifications: {
            destinations: {
              entities: [{ id: 'n1', name: 'Slack', type: 'SLACK' }],
              nextCursor: null,
            },
          },
        },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const channels = await client.getNotificationChannels();
    expect(channels.length).toBe(1);
    expect(channels[0]['type']).toBe('SLACK');
  });
});

describe('NewRelicClient getSyntheticMonitors', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return monitors with details', async () => {
    const searchData = {
      actor: {
        entitySearch: {
          results: {
            entities: [{ guid: 'mon1', name: 'Health Check' }],
            nextCursor: null,
          },
        },
      },
    };
    const detailData = {
      actor: {
        entity: { guid: 'mon1', name: 'Health Check', monitorType: 'SIMPLE' },
      },
    };
    http.post
      .mockResolvedValueOnce(mockNerdGraphResponse(searchData))
      .mockResolvedValueOnce(mockNerdGraphResponse(detailData));

    const monitors = await client.getAllSyntheticMonitors();
    expect(monitors.length).toBe(1);
  });

  it('should return monitor details', async () => {
    const data = {
      actor: {
        entity: { guid: 'm1', monitorType: 'BROWSER' },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const result = await client.getSyntheticMonitorDetails('m1');
    expect(result).toBeDefined();
    expect(result!['monitorType']).toBe('BROWSER');
  });

  it('should return monitor script', async () => {
    const data = {
      actor: {
        account: {
          synthetics: { script: { text: "console.log('ok')" } },
        },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const script = await client.getSyntheticMonitorScript('m1');
    expect(script).toBe("console.log('ok')");
  });

  it('should return undefined for no script', async () => {
    const data = {
      actor: {
        account: {
          synthetics: { script: null },
        },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const script = await client.getSyntheticMonitorScript('m1');
    expect(script).toBeUndefined();
  });
});

describe('NewRelicClient getSLOs', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return SLOs', async () => {
    const data = {
      actor: {
        account: {
          serviceLevel: {
            indicators: {
              entities: [{ guid: 'slo1', name: 'Availability' }],
              nextCursor: null,
            },
          },
        },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const slos = await client.getAllSlos();
    expect(slos.length).toBe(1);
    expect(slos[0]['name']).toBe('Availability');
  });
});

describe('NewRelicClient getWorkloads', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return workloads with details', async () => {
    const searchData = {
      actor: {
        entitySearch: {
          results: {
            entities: [{ guid: 'w1', name: 'Production' }],
            nextCursor: null,
          },
        },
      },
    };
    const detailData = {
      actor: {
        entity: { guid: 'w1', name: 'Production', collection: [] },
      },
    };
    http.post
      .mockResolvedValueOnce(mockNerdGraphResponse(searchData))
      .mockResolvedValueOnce(mockNerdGraphResponse(detailData));

    const workloads = await client.getAllWorkloads();
    expect(workloads.length).toBe(1);
  });

  it('should return workload details', async () => {
    const data = {
      actor: {
        entity: { guid: 'w1', name: 'Prod', collection: [] },
      },
    };
    http.post.mockResolvedValueOnce(mockNerdGraphResponse(data));

    const result = await client.getWorkloadDetails('w1');
    expect(result).toBeDefined();
    expect(result!['name']).toBe('Prod');
  });
});

describe('NewRelicClient exportAll', () => {
  let client: NewRelicClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new NewRelicClient({
      apiKey: 'NRAK-TEST',
      accountId: '12345',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should export all entity types', async () => {
    const emptySearch = {
      actor: {
        entitySearch: {
          results: { entities: [], nextCursor: null },
        },
      },
    };
    const emptyPolicies = {
      actor: {
        account: {
          alerts: {
            policiesSearch: { policies: [], nextCursor: null },
          },
        },
      },
    };
    const emptyChannels = {
      actor: {
        account: {
          aiNotifications: {
            destinations: { entities: [], nextCursor: null },
          },
        },
      },
    };
    const emptySlos = {
      actor: {
        account: {
          serviceLevel: {
            indicators: { entities: [], nextCursor: null },
          },
        },
      },
    };

    http.post
      .mockResolvedValueOnce(mockNerdGraphResponse(emptySearch))     // dashboards
      .mockResolvedValueOnce(mockNerdGraphResponse(emptyPolicies))   // alerts
      .mockResolvedValueOnce(mockNerdGraphResponse(emptyChannels))   // notifications
      .mockResolvedValueOnce(mockNerdGraphResponse(emptySearch))     // synthetics
      .mockResolvedValueOnce(mockNerdGraphResponse(emptySlos))       // slos
      .mockResolvedValueOnce(mockNerdGraphResponse(emptySearch));    // workloads

    const result = await client.exportAll();
    expect(result.metadata).toBeDefined();
    expect(result.dashboards).toBeDefined();
    expect(result.alertPolicies).toBeDefined();
    expect(result.slos).toBeDefined();
    expect(result.workloads).toBeDefined();
  });
});
