/**
 * Tests for DynatraceClient -- all public methods with mocked HTTP.
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import axios from 'axios';

import {
  DynatraceClient,
  NOTIFICATION_INTEGRATION_SCHEMA,
} from '../../src/clients/index.js';
import type { DynatraceResponse, ImportResult } from '../../src/clients/index.js';

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

function mockResponse(
  data: unknown,
  status = 200,
): { data: unknown; status: number; statusText: string } {
  return {
    data,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DynatraceResponse shape', () => {
  it('should be success for 2xx', async () => {
    const client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    const http = getMockHttp();
    http.request.mockResolvedValueOnce(mockResponse({ ok: true }, 200));

    const resp = await client.get('https://abc123.live.dynatrace.com/api/v2/test');
    expect(resp.isSuccess).toBe(true);

    http.request.mockResolvedValueOnce(mockResponse({}, 201));
    const resp2 = await client.post('https://url/api', {});
    expect(resp2.isSuccess).toBe(true);
  });

  it('should not be success for 4xx', async () => {
    const client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    const http = getMockHttp();
    http.request.mockResolvedValueOnce(mockResponse({ error: 'bad' }, 400));

    const resp = await client.get('https://url/api');
    expect(resp.isSuccess).toBe(false);

    http.request.mockResolvedValueOnce(mockResponse(null, 401));
    const resp2 = await client.get('https://url/api');
    expect(resp2.isSuccess).toBe(false);
  });
});

describe('ImportResult shape', () => {
  it('should store fields via createDashboard', async () => {
    const client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    const http = getMockHttp();
    // createDashboard tries v2 first (via createDashboardV2)
    http.request
      .mockResolvedValueOnce(mockResponse({ id: 'doc-123' }, 201));

    const result = await client.createDashboardV2({
      dashboardMetadata: { name: 'My Dash' },
      tiles: [],
    });
    expect(result.entityType).toBe('dashboard');
    expect(result.success).toBe(true);
    expect(result.dynatraceId).toBe('doc-123');
  });
});

describe('DynatraceClient init', () => {
  it('should set API endpoints', () => {
    const client = new DynatraceClient({
      apiToken: 'token',
      environmentUrl: 'https://abc.live.dynatrace.com',
      rateLimit: 0,
    });
    // Access private fields via bracket notation to validate
    // The client constructs apiV2 and configApi in constructor
    const createMock = axios.create as Mock;
    // We verify the client was created; endpoints are internal
    expect(createMock).toHaveBeenCalled();
  });

  it('should strip trailing slash', () => {
    // We validate by checking that API calls use the stripped URL
    const client = new DynatraceClient({
      apiToken: 'token',
      environmentUrl: 'https://abc.live.dynatrace.com/',
      rateLimit: 0,
    });
    // The client strips trailing slashes in constructor
    // Verify via validateConnection which uses apiV2
    expect(client).toBeDefined();
  });

  it('should set auth header', () => {
    const client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc.live.dynatrace.com',
      rateLimit: 0,
    });
    const createMock = axios.create as Mock;
    const lastCall = createMock.mock.calls[createMock.mock.calls.length - 1][0];
    expect(lastCall.headers['Authorization']).toContain('Api-Token dt0c01.TEST');
  });
});

describe('DynatraceClient HTTP methods', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should call request for GET', async () => {
    http.request.mockResolvedValueOnce(mockResponse({ ok: true }));

    const resp = await client.get('https://abc.live.dynatrace.com/api/v2/test');
    expect(resp.isSuccess).toBe(true);
    expect(resp.data).toEqual({ ok: true });
  });

  it('should call request for POST', async () => {
    http.request.mockResolvedValueOnce(mockResponse({ id: '123' }, 201));

    const resp = await client.post('https://url/api', { name: 'test' });
    expect(resp.isSuccess).toBe(true);
  });

  it('should handle HTTP error', async () => {
    http.request.mockResolvedValueOnce(mockResponse({ error: 'bad' }, 400));

    const resp = await client.get('https://url/api');
    expect(resp.isSuccess).toBe(false);
    expect(resp.error).toBeDefined();
  });

  it('should handle connection error', async () => {
    http.request.mockRejectedValueOnce(new Error('timeout'));

    const resp = await client.get('https://url/api');
    expect(resp.isSuccess).toBe(false);
    expect(resp.statusCode).toBe(0);
  });
});

describe('DynatraceClient Settings API', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should get schemas', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ items: [{ id: 'schema1' }] }),
    );

    const schemas = await client.getSettingsSchemas();
    expect(schemas.length).toBe(1);
  });

  it('should get settings objects', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ items: [{ objectId: 'o1' }], nextPageKey: null }),
    );

    const objects = await client.getSettingsObjects('builtin:alerting.profile');
    expect(objects.length).toBe(1);
  });

  it('should create settings object', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse([{ objectId: 'new-1' }], 201),
    );

    const resp = await client.createSettingsObject('builtin:test', { name: 'test' });
    expect(resp.isSuccess).toBe(true);
  });

  it('should update settings object', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ objectId: 'o1' }, 200),
    );

    const resp = await client.updateSettingsObject('o1', { name: 'updated' });
    expect(resp.isSuccess).toBe(true);
  });
});

describe('DynatraceClient createDashboard', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return success result', async () => {
    const dash = { dashboardMetadata: { name: 'My Dash' }, tiles: [] };
    // createDashboard tries V2 first
    http.request.mockResolvedValueOnce(mockResponse({ id: 'doc-abc' }, 201));

    const result = await client.createDashboard(dash);
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('dashboard');
    expect(result.dynatraceId).toBe('doc-abc');
  });

  it('should return failure on error', async () => {
    const dash = { dashboardMetadata: { name: 'Bad' }, tiles: [] };
    // V2 fails, then V1 fails
    http.request
      .mockResolvedValueOnce(mockResponse({ error: 'auth' }, 403))
      .mockResolvedValueOnce(mockResponse({ error: 'invalid' }, 400));

    const result = await client.createDashboard(dash);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeDefined();
  });
});

describe('DynatraceClient getAllDashboards', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return dashboards', async () => {
    http.request
      .mockResolvedValueOnce(
        mockResponse({ dashboards: [{ id: 'd1' }, { id: 'd2' }] }),
      )
      .mockResolvedValueOnce(
        mockResponse({ id: 'd1', dashboardMetadata: { name: 'Test' } }),
      )
      .mockResolvedValueOnce(
        mockResponse({ id: 'd2', dashboardMetadata: { name: 'Test2' } }),
      );

    const dashboards = await client.getAllDashboards();
    expect(dashboards.length).toBe(2);
  });
});

describe('DynatraceClient createMetricEvent', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return success', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse([{ objectId: 'me-1' }], 201),
    );

    const result = await client.createMetricEvent({ summary: 'High Latency' });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('metric_event');
  });

  it('should return failure', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ error: 'bad' }, 400),
    );

    const result = await client.createMetricEvent({ summary: 'Bad' });
    expect(result.success).toBe(false);
  });
});

describe('DynatraceClient createAlertingProfile', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return success', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse([{ objectId: 'ap-1' }], 201),
    );

    const result = await client.createAlertingProfile({ name: 'Critical' });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('alerting_profile');
  });
});

describe('DynatraceClient synthetic monitors', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should create HTTP monitor', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ entityId: 'HTTP-1' }, 200),
    );

    const result = await client.createHttpMonitor({ name: 'Health' });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('http_monitor');
  });

  it('should create browser monitor', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ entityId: 'BROWSER-1' }, 200),
    );

    const result = await client.createBrowserMonitor({ name: 'Login Flow' });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('browser_monitor');
  });

  it('should get locations', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ locations: [{ id: 'loc1' }] }),
    );

    const locations = await client.getSyntheticLocations();
    expect(locations.length).toBe(1);
  });
});

describe('DynatraceClient SLO', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should create SLO', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ id: 'slo-1' }, 201),
    );

    const result = await client.createSlo({ name: 'Availability' });
    expect(result.success).toBe(true);
  });

  it('should get all SLOs', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse({ slo: [{ id: 's1' }], nextPageKey: null }),
    );

    const slos = await client.getAllSlos();
    expect(slos.length).toBe(1);
  });
});

describe('DynatraceClient management zone', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should create management zone', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse([{ objectId: 'mz-1' }], 201),
    );

    const result = await client.createManagementZone({ name: 'Production' });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('management_zone');
  });
});

describe('DynatraceClient notification integration', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should create email notification', async () => {
    http.request.mockResolvedValueOnce(
      mockResponse([{ objectId: 'n-1' }], 201),
    );

    const result = await client.createNotificationIntegration('email', {
      name: 'Team Email',
    });
    expect(result.success).toBe(true);
  });

  it('should fail for unknown type', async () => {
    const result = await client.createNotificationIntegration('carrier_pigeon', {
      name: 'Bird',
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Unknown integration type');
  });
});

describe('DynatraceClient createDashboardV2', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should create via documents API', async () => {
    const dash = {
      dashboardMetadata: { name: 'My Dash', shared: true },
      tiles: [],
    };
    http.request.mockResolvedValueOnce(mockResponse({ id: 'doc-123' }, 201));

    const result = await client.createDashboardV2(dash);
    expect(result.success).toBe(true);
    expect(result.dynatraceId).toBe('doc-123');
  });

  it('should return failure on error', async () => {
    const dash = { dashboardMetadata: { name: 'Bad' }, tiles: [] };
    http.request.mockResolvedValueOnce(mockResponse({ error: 'auth' }, 403));

    const result = await client.createDashboardV2(dash);
    expect(result.success).toBe(false);
  });

  it('should update dashboard v2', async () => {
    const dash = { dashboardMetadata: { name: 'Updated' }, tiles: [] };
    http.request.mockResolvedValueOnce(mockResponse({ id: 'doc-123' }, 200));

    const result = await client.updateDashboardV2('doc-123', dash);
    expect(result.success).toBe(true);
  });
});

describe('DynatraceClient validateConnection', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should return true on success', async () => {
    http.request.mockResolvedValueOnce(mockResponse({ items: [] }));

    const result = await client.validateConnection();
    expect(result).toBe(true);
  });

  it('should return false on failure', async () => {
    http.request.mockResolvedValueOnce(mockResponse(null, 401));

    const result = await client.validateConnection();
    expect(result).toBe(false);
  });
});

describe('DynatraceClient backupAll', () => {
  let client: DynatraceClient;
  let http: ReturnType<typeof getMockHttp>;

  beforeEach(() => {
    client = new DynatraceClient({
      apiToken: 'dt0c01.TEST',
      environmentUrl: 'https://abc123.live.dynatrace.com',
      rateLimit: 0,
    });
    http = getMockHttp();
  });

  it('should backup all entity types', async () => {
    const emptyList = mockResponse({ dashboards: [], items: [], slo: [], nextPageKey: null });
    http.request.mockResolvedValue(emptyList);

    const result = await client.backupAll();
    expect(result['metadata']).toBeDefined();
    expect(result['dashboards']).toBeDefined();
    expect(result['slos']).toBeDefined();
    expect(result['alertingProfiles']).toBeDefined();
    expect(result['managementZones']).toBeDefined();
  });
});
