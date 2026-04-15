import { describe, it, expect } from 'vitest';
import {
  LegacyErrorInboxTransformer,
  LegacyNonNrqlAlertConditionTransformer,
  LegacyRequestNamingTransformer,
  LegacyCloudIntegrationTransformer,
  LegacyApdexTransformer,
} from '../../src/transformers/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// LegacyErrorInboxTransformer
// ═══════════════════════════════════════════════════════════════════════════

describe('LegacyErrorInboxTransformer', () => {
  const t = new LegacyErrorInboxTransformer();

  it('should fail without errorGroupId', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = t.transform({ errorGroupId: '' as any, title: 'x' });
    expect(result.success).toBe(false);
  });

  it('should emit POST_COMMENT actions when dtProblemIds supplied', () => {
    const result = t.transform({
      errorGroupId: 'errg-1',
      title: 'NPE at checkout',
      comments: [{ author: 'alice', body: 'Looking at this', createdAt: '2026-01-05T10:00:00Z' }],
      dtProblemIds: ['PROB-123'],
    });
    expect(result.success).toBe(true);
    const action = result.data!.actions.find((a) => a.kind === 'POST_COMMENT')!;
    expect(action).toBeDefined();
    if (action.kind === 'POST_COMMENT') {
      expect(action.method).toBe('POST');
      expect(action.path).toBe('/api/v2/problems/PROB-123/comments');
      expect(action.body.comment).toContain('alice');
      expect(action.body.context).toContain('errg-1');
    }
  });

  it('should emit POST_COMMENT_UNBOUND when dtProblemIds missing', () => {
    const result = t.transform({
      errorGroupId: 'errg-2',
      title: 'x',
      comments: [{ author: 'bob', body: 'hello' }],
    });
    expect(result.data!.actions[0]!.kind).toBe('POST_COMMENT_UNBOUND');
    expect(result.warnings.some((w) => w.includes('No DT problem id'))).toBe(true);
  });

  it('should emit ACKNOWLEDGE action for RESOLVED status', () => {
    const result = t.transform({
      errorGroupId: 'errg-3',
      title: 'x',
      status: 'RESOLVED',
      dtProblemIds: ['PROB-999'],
    });
    const ack = result.data!.actions.find((a) => a.kind === 'ACKNOWLEDGE');
    expect(ack).toBeDefined();
    if (ack && ack.kind === 'ACKNOWLEDGE') {
      expect(ack.path).toContain('/close');
      expect(ack.body.message).toContain('Resolved');
    }
  });

  it('should emit ACKNOWLEDGE action for IGNORED status with distinct message', () => {
    const result = t.transform({
      errorGroupId: 'errg-4',
      title: 'x',
      status: 'IGNORED',
      dtProblemIds: ['PROB-1'],
    });
    const ack = result.data!.actions.find((a) => a.kind === 'ACKNOWLEDGE');
    if (ack && ack.kind === 'ACKNOWLEDGE') {
      expect(ack.body.message).toContain('Ignored');
    }
  });

  it('should emit assignee comment + audit warning', () => {
    const result = t.transform({
      errorGroupId: 'errg-5',
      title: 'x',
      assignee: 'alice@example.com',
      dtProblemIds: ['PROB-1'],
    });
    const assignComment = result.data!.actions.find(
      (a) => a.kind === 'POST_COMMENT' && a.body.comment.includes('alice@example.com'),
    );
    expect(assignComment).toBeDefined();
    expect(result.warnings.some((w) => w.includes('no assignee field'))).toBe(true);
  });

  it('should emit progress comment for WORK_IN_PROGRESS (not a close)', () => {
    const result = t.transform({
      errorGroupId: 'errg-6',
      title: 'x',
      status: 'WORK_IN_PROGRESS',
      dtProblemIds: ['PROB-1'],
    });
    expect(result.data!.actions.some((a) => a.kind === 'ACKNOWLEDGE')).toBe(false);
    expect(
      result.data!.actions.some(
        (a) => a.kind === 'POST_COMMENT' && a.body.comment.includes('WORK_IN_PROGRESS'),
      ),
    ).toBe(true);
  });

  it('should emit legacy warning', () => {
    const result = t.transform({
      errorGroupId: 'errg-7',
      title: 'x',
      dtProblemIds: ['P1'],
    });
    expect(result.warnings[0]).toContain('Gen2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LegacyNonNrqlAlertConditionTransformer
// ═══════════════════════════════════════════════════════════════════════════

describe('LegacyNonNrqlAlertConditionTransformer', () => {
  const t = new LegacyNonNrqlAlertConditionTransformer();

  it('should emit classic Alerting Profile + Metric Event', () => {
    const result = t.transform({
      conditionType: 'APM',
      name: 'Slow service',
      metric: 'apm.service.responseTime',
      terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 500 }],
      policyName: 'Prod SLA',
    });
    expect(result.success).toBe(true);
    expect(result.data!.alertingProfile.schemaId).toBe('builtin:alerting.profile');
    expect(result.data!.alertingProfile.severityRules).toHaveLength(5);
    expect(result.data!.metricEvent.schemaId).toBe(
      'builtin:anomaly-detection.metric-events',
    );
    const qd = result.data!.metricEvent.queryDefinition as Record<string, unknown>;
    expect(qd.metricKey).toBe('builtin:service.response.time');
  });

  it('should disable placeholder event for unmapped metric', () => {
    const result = t.transform({ conditionType: 'APM', metric: 'apm.unknown.weirdness' });
    expect(result.data!.metricEvent.enabled).toBe(false);
    expect(result.warnings.some((w) => w.includes('apm.unknown.weirdness'))).toBe(true);
  });

  it('should carry entity GUIDs into alertingScope', () => {
    const result = t.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      entityGuids: ['HOST-A', 'HOST-B'],
    });
    const scope = result.data!.metricEvent.alertingScope;
    expect(scope).toHaveLength(2);
    expect(scope[0]!.entityId).toBe('HOST-A');
  });

  it('should map AT_LEAST_ONCE occurrences', () => {
    const result = t.transform({
      conditionType: 'APM',
      metric: 'apm.service.responseTime',
      terms: [
        {
          priority: 'critical',
          operator: 'ABOVE',
          threshold: 10,
          thresholdDuration: 300,
          thresholdOccurrences: 'AT_LEAST_ONCE',
        },
      ],
    });
    const strategy = result.data!.metricEvent.monitoringStrategy as Record<string, unknown>;
    expect(strategy.violatingSamples).toBe(1);
  });

  it('should emit legacy warning', () => {
    const result = t.transform({ conditionType: 'APM', metric: 'apm.service.responseTime' });
    expect(result.warnings[0]).toContain('Gen2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LegacyRequestNamingTransformer
// ═══════════════════════════════════════════════════════════════════════════

describe('LegacyRequestNamingTransformer', () => {
  const t = new LegacyRequestNamingTransformer();

  it('should fail on empty sites', () => {
    const result = t.transform({ sites: [] });
    expect(result.success).toBe(false);
  });

  it('should emit one rule per call-site with service.name condition', () => {
    const result = t.transform({
      sites: [
        {
          category: 'Custom',
          name: 'checkout.submit',
          serviceName: 'checkout-api',
          httpMethod: 'post',
          urlPathPattern: '/v1/checkout/.*',
        },
      ],
    });
    expect(result.success).toBe(true);
    const r = result.data!.rules[0]!;
    expect(r.schemaId).toBe('builtin:request-naming.request-naming-rules');
    expect(r.conditions).toContainEqual({
      attribute: 'service.name',
      operator: 'EQUALS',
      value: 'checkout-api',
    });
    expect(r.conditions).toContainEqual({
      attribute: 'http.method',
      operator: 'EQUALS',
      value: 'POST',
    });
    expect(r.namingTemplate).toContain('checkout.submit');
  });

  it('should warn when serviceName missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = t.transform({
      sites: [{ name: 'txn', serviceName: '' as any }],
    });
    expect(result.warnings.some((w) => w.includes('no serviceName'))).toBe(true);
  });

  it('should skip sites missing name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = t.transform({
      sites: [{ name: '' as any, serviceName: 'svc' }],
    });
    expect(result.data!.rules).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('no name'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LegacyCloudIntegrationTransformer
// ═══════════════════════════════════════════════════════════════════════════

describe('LegacyCloudIntegrationTransformer', () => {
  const t = new LegacyCloudIntegrationTransformer();

  it('should emit AWS v1 credentials payload', () => {
    const result = t.transform({
      provider: 'AWS',
      accountId: '123',
      enabledServices: ['aws_ec2', 'aws_lambda', 'cloudwatch'],
    });
    expect(result.success).toBe(true);
    if (result.data!.config.endpoint === '/api/config/v1/aws/credentials') {
      const cfg = result.data!.config;
      expect(cfg.partitionType).toBe('AWS_DEFAULT');
      expect(cfg.servicesToMonitor).toEqual(['EC2', 'LAMBDA', 'CLOUD_WATCH']);
      expect(cfg.authenticationData.roleBasedAuthentication.accountId).toBe('123');
    }
  });

  it('should emit Azure v1 credentials payload', () => {
    const result = t.transform({
      provider: 'AZURE',
      accountId: 'sub-1',
      enabledServices: ['azure_vm', 'azure_sql'],
    });
    if (result.data!.config.endpoint === '/api/config/v1/azure/credentials') {
      expect(result.data!.config.supportingServicesToMonitor).toEqual([
        'VIRTUAL_MACHINES',
        'SQL_SERVERS',
      ]);
    }
  });

  it('should emit GCP v1 credentials payload with projects', () => {
    const result = t.transform({
      provider: 'GCP',
      accountId: 'proj-a',
      gcpProjects: ['proj-a', 'proj-b'],
      enabledServices: ['gcp_gke', 'gcp_pubsub'],
    });
    if (result.data!.config.endpoint === '/api/config/v1/gcp/credentials') {
      expect(result.data!.config.projects).toEqual(['proj-a', 'proj-b']);
      expect(result.data!.config.services).toEqual(['KUBERNETES_ENGINE', 'PUBSUB']);
    }
  });

  it('should warn on unmapped service names', () => {
    const result = t.transform({
      provider: 'AWS',
      accountId: '1',
      enabledServices: ['aws_ec2', 'aws_quantum_ledger'],
    });
    expect(result.warnings.some((w) => w.includes('quantum_ledger'))).toBe(true);
  });

  it('should emit legacy warning', () => {
    const result = t.transform({ provider: 'AWS', accountId: '1' });
    expect(result.warnings[0]).toContain('Gen2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LegacyApdexTransformer
// ═══════════════════════════════════════════════════════════════════════════

describe('LegacyApdexTransformer', () => {
  const t = new LegacyApdexTransformer();

  it('should fail on empty overrides', () => {
    const result = t.transform({ overrides: [] });
    expect(result.success).toBe(false);
  });

  it('should emit per-service Apdex settings with T in ms', () => {
    const result = t.transform({
      overrides: [
        {
          serviceName: 'checkout',
          tolerated: 0.5,
          dtServiceEntityId: 'SERVICE-ABC',
        },
      ],
    });
    expect(result.success).toBe(true);
    const s = result.data!.settings[0]!;
    expect(s.schemaId).toBe('builtin:apdex.service-apdex-calculation');
    expect(s.toleratedThresholdMs).toBe(500);
    expect(s.frustratedThresholdMs).toBe(2000); // 4× tolerated
    expect(s.scope).toBe('SERVICE-ABC');
  });

  it('should honor explicit frustrated threshold', () => {
    const result = t.transform({
      overrides: [
        {
          serviceName: 'checkout',
          tolerated: 0.5,
          frustrated: 1.5,
          dtServiceEntityId: 'SERVICE-A',
        },
      ],
    });
    expect(result.data!.settings[0]!.frustratedThresholdMs).toBe(1500);
  });

  it('should warn + emit placeholder scope when dtServiceEntityId missing', () => {
    const result = t.transform({
      overrides: [{ serviceName: 'checkout', tolerated: 0.4 }],
    });
    expect(result.warnings.some((w) => w.includes('dtServiceEntityId'))).toBe(true);
    expect(result.data!.settings[0]!.scope).toContain('entity-placeholder-for-checkout');
  });

  it('should skip invalid overrides (empty name or non-positive t)', () => {
    const result = t.transform({
      overrides: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { serviceName: '' as any, tolerated: 0.5 },
        { serviceName: 'bad', tolerated: 0 },
        { serviceName: 'good', tolerated: 0.5, dtServiceEntityId: 'S1' },
      ],
    });
    expect(result.data!.settings).toHaveLength(1);
    expect(result.data!.settings[0]!.displayName).toContain('good');
  });

  it('should fail when no valid overrides remain', () => {
    const result = t.transform({
      overrides: [{ serviceName: 'x', tolerated: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('should emit legacy warning', () => {
    const result = t.transform({
      overrides: [{ serviceName: 'x', tolerated: 0.5, dtServiceEntityId: 'S' }],
    });
    expect(result.warnings[0]).toContain('Gen2');
  });
});
