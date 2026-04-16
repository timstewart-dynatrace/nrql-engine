/**
 * Factory contract validation.
 *
 * Validates that every transformer kind wired through createTransformer:
 *   1. Instantiates without error
 *   2. Accepts canonical minimal input and returns a valid TransformResult
 *   3. Returns the correct shape (success boolean, data/errors, warnings array)
 *   4. Legacy variants (where applicable) also instantiate and return valid results
 *   5. transformAll batch path works for every kind
 */

import { describe, it, expect } from 'vitest';
import {
  createTransformer,
  hasLegacyVariant,
  LEGACY_SUPPORTED_KINDS,
  type TransformerKind,
} from '../../src/transformers/factory.js';
import type { TransformResult } from '../../src/transformers/types.js';

// ---------------------------------------------------------------------------
// Canonical minimal inputs — one per factory kind
// ---------------------------------------------------------------------------

const CANONICAL_INPUTS: Record<TransformerKind, unknown> = {
  alert: {
    name: 'Test Policy',
    conditions: [
      {
        name: 'High Error Rate',
        conditionType: 'NRQL',
        nrql: { query: "SELECT count(*) FROM TransactionError WHERE appName = 'api'" },
        terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 100 }],
      },
    ],
  },
  notification: {
    name: 'Alert Email',
    type: 'EMAIL',
    properties: [{ key: 'recipients', value: 'admin@example.com' }],
    active: true,
  },
  tag: {
    name: 'my-service',
    type: 'APPLICATION',
    tags: [{ key: 'environment', values: ['production'] }],
  },
  workload: {
    name: 'Production Workload',
    collection: [{ type: 'APPLICATION', name: 'checkout-service' }],
  },
  dashboard: {
    name: 'Test Dashboard',
    pages: [
      {
        name: 'Overview',
        widgets: [
          {
            title: 'Transaction Count',
            visualization: { id: 'viz.line' },
            rawConfiguration: {
              nrqlQueries: [{ query: 'SELECT count(*) FROM Transaction TIMESERIES' }],
            },
          },
        ],
      },
    ],
  },
  slo: {
    name: 'API Availability',
    objectives: [
      { target: 99.5, timeWindow: { rolling: { count: 7, unit: 'DAY' } } },
    ],
    events: {
      validEvents: { where: "service = 'api'" },
      goodEvents: { where: 'http.statusCode < 500' },
    },
  },
  synthetic: {
    name: 'Health Check',
    monitorType: 'SIMPLE',
    monitoredUrl: 'https://api.example.com/health',
    period: 'EVERY_15_MINUTES',
    status: 'ENABLED',
  },
  'drop-rule': {
    name: 'Drop Debug',
    nrqlCondition: "level = 'DEBUG'",
    action: 'drop_data',
    enabled: true,
  },
  infrastructure: {
    name: 'Host Down',
    type: 'host_not_reporting',
    enabled: true,
    criticalThreshold: { durationMinutes: 5 },
  },
  'log-parsing': {
    name: 'Extract IP',
    type: 'regex',
    pattern: String.raw`(\d+\.\d+\.\d+\.\d+)`,
    attributes: ['ip_address'],
    enabled: true,
  },
  'error-inbox': {
    errorGroupId: 'errg-1',
    title: 'NullPointerException at checkout',
    dtProblemIds: ['PROB-123'],
  },
  'non-nrql-alert-legacy': {
    conditionType: 'APM',
    name: 'Slow service',
    metric: 'apm.service.responseTime',
    terms: [{ priority: 'critical', operator: 'ABOVE', threshold: 500 }],
  },
  'request-naming': {
    sites: [
      {
        name: 'checkout.submit',
        serviceName: 'checkout-api',
        category: 'Custom',
        httpMethod: 'POST',
      },
    ],
  },
  'cloud-integration-legacy': {
    provider: 'AWS',
    accountId: '123456789012',
    enabledServices: ['aws_ec2', 'aws_lambda'],
  },
  apdex: {
    overrides: [
      {
        serviceName: 'checkout-service',
        tolerated: 0.5,
        dtServiceEntityId: 'SERVICE-ABC123',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Shape assertions
// ---------------------------------------------------------------------------

function assertTransformResultShape(result: unknown, label: string): void {
  expect(result, `${label}: result is defined`).toBeDefined();
  const r = result as TransformResult<unknown>;
  expect(typeof r.success, `${label}: success is boolean`).toBe('boolean');
  expect(Array.isArray(r.warnings), `${label}: warnings is array`).toBe(true);
  expect(Array.isArray(r.errors), `${label}: errors is array`).toBe(true);
  if (r.success) {
    expect(r.data, `${label}: successful result has data`).toBeDefined();
    expect(r.errors.length, `${label}: successful result has no errors`).toBe(0);
  } else {
    expect(r.errors.length, `${label}: failed result has errors`).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ALL_KINDS = Object.keys(CANONICAL_INPUTS) as TransformerKind[];

describe('Factory contract validation', () => {
  describe('instantiation', () => {
    for (const kind of ALL_KINDS) {
      it(`should instantiate '${kind}' without error`, () => {
        expect(() => createTransformer(kind)).not.toThrow();
      });
    }
  });

  describe('Gen3 transform() with canonical input', () => {
    for (const kind of ALL_KINDS) {
      it(`should return valid TransformResult for '${kind}'`, () => {
        const transformer = createTransformer(kind) as {
          transform(input: unknown): TransformResult<unknown>;
        };
        const result = transformer.transform(CANONICAL_INPUTS[kind]);
        assertTransformResultShape(result, `${kind}/gen3`);
      });
    }
  });

  describe('Gen3 transformAll() batch path', () => {
    for (const kind of ALL_KINDS) {
      it(`should batch-transform '${kind}' with one item`, () => {
        const transformer = createTransformer(kind) as {
          transformAll(inputs: unknown[]): TransformResult<unknown>[];
        };
        const results = transformer.transformAll([CANONICAL_INPUTS[kind]]);
        expect(Array.isArray(results), `${kind}: transformAll returns array`).toBe(true);
        expect(results.length, `${kind}: transformAll returns one result`).toBe(1);
        assertTransformResultShape(results[0], `${kind}/batch`);
      });
    }
  });

  describe('Legacy variants', () => {
    const legacyKinds = ALL_KINDS.filter((k) => hasLegacyVariant(k));

    it('LEGACY_SUPPORTED_KINDS should match hasLegacyVariant', () => {
      for (const kind of ALL_KINDS) {
        expect(
          hasLegacyVariant(kind),
          `hasLegacyVariant('${kind}') should match LEGACY_SUPPORTED_KINDS`,
        ).toBe(LEGACY_SUPPORTED_KINDS.has(kind));
      }
    });

    for (const kind of legacyKinds) {
      it(`should instantiate Legacy '${kind}' and return valid TransformResult`, () => {
        const transformer = createTransformer(kind, { legacy: true }) as {
          transform(input: unknown): TransformResult<unknown>;
        };
        const result = transformer.transform(CANONICAL_INPUTS[kind]);
        assertTransformResultShape(result, `${kind}/legacy`);
      });
    }
  });

  describe('empty input resilience', () => {
    for (const kind of ALL_KINDS) {
      it(`should not throw for '${kind}' with empty input`, () => {
        const transformer = createTransformer(kind) as {
          transform(input: unknown): TransformResult<unknown>;
        };
        let result: TransformResult<unknown>;
        expect(() => {
          result = transformer.transform({});
        }).not.toThrow();
        assertTransformResultShape(result!, `${kind}/empty`);
      });
    }
  });

  it('should throw for unknown transformer kind', () => {
    expect(() => createTransformer('nonexistent' as TransformerKind)).toThrow(
      'Unknown transformer kind',
    );
  });
});
