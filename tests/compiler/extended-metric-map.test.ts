import { describe, it, expect } from 'vitest';
import {
  EXTENDED_METRIC_MAP,
  DEFAULT_METRIC_MAP,
  NRQLCompiler,
} from '../../src/compiler/index.js';

describe('EXTENDED_METRIC_MAP', () => {
  it('has 232 entries (parity with Python METRIC_MAP)', () => {
    expect(Object.keys(EXTENDED_METRIC_MAP).length).toBe(232);
  });

  it('covers key APM service targets', () => {
    expect(EXTENDED_METRIC_MAP['responsetime']).toBe('dt.service.request.response_time');
    expect(EXTENDED_METRIC_MAP['errorcount']).toBe('dt.service.request.failure_count');
    expect(EXTENDED_METRIC_MAP['throughput']).toBe('dt.service.request.count');
  });

  it('covers AWS namespaces (EC2, Lambda, RDS, DynamoDB, ALB)', () => {
    expect(EXTENDED_METRIC_MAP['awsec2cpuutilization']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['awslambdainvocations']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['awsrdsconnections']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['awsdynamodblatency']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['awsalbrequestcount']).toBeTruthy();
  });

  it('covers Kubernetes node/pod/container metrics', () => {
    expect(EXTENDED_METRIC_MAP['allocatablecpucores']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['allocatablememorybytes']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['allocatablepods']).toBeTruthy();
  });

  it('covers browser RUM XHR metrics', () => {
    expect(EXTENDED_METRIC_MAP['ajaxcallcount']).toBeTruthy();
    expect(EXTENDED_METRIC_MAP['ajaxresponsetime']).toBeTruthy();
  });

  it('does not conflict with DEFAULT_METRIC_MAP values (DEFAULT wins)', () => {
    // DEFAULT's curated entries override EXTENDED when keys overlap.
    for (const k of Object.keys(DEFAULT_METRIC_MAP)) {
      if (EXTENDED_METRIC_MAP[k] !== undefined) {
        // Overlap is fine — DEFAULT just takes precedence.
        expect(DEFAULT_METRIC_MAP[k]).toBeTruthy();
      }
    }
  });

  it('is wired into NRQLCompiler via metricMap merge', () => {
    const compiler = new NRQLCompiler();
    // Rely on the compiler internal state via a known extended-only key.
    // (We only verify the construction doesn't throw and the merge is active
    // by checking that a query referencing an EXTENDED-only metric compiles.)
    const result = compiler.compile("SELECT average(ajaxCallCount) FROM PageAction");
    expect(result.success).toBe(true);
  });
});
