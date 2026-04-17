import { describe, it, expect } from 'vitest';
import {
  getOtelEnvForDt,
  formatOtelEnvAsDotenv,
} from '../../src/transformers/index.js';

describe('getOtelEnvForDt', () => {
  it('should build a minimal env map for grpc OTLP', () => {
    const env = getOtelEnvForDt({
      dtTenant: 'abc12345',
      ingestToken: 'dt0c01.FAKE',
      serviceName: 'checkout',
    });
    expect(env['OTEL_EXPORTER_OTLP_ENDPOINT']).toContain('abc12345.live.dynatrace.com/api/v2/otlp');
    expect(env['OTEL_EXPORTER_OTLP_PROTOCOL']).toBe('grpc');
    expect(env['OTEL_EXPORTER_OTLP_HEADERS']).toBe(
      'Authorization=Api-Token dt0c01.FAKE',
    );
    expect(env['OTEL_SERVICE_NAME']).toBe('checkout');
    expect(env['OTEL_TRACES_EXPORTER']).toBe('otlp');
    expect(env['OTEL_METRICS_EXPORTER']).toBe('otlp');
    expect(env['OTEL_LOGS_EXPORTER']).toBe('otlp');
  });

  it('should include service.instance.id + deployment.environment in resource attrs', () => {
    const env = getOtelEnvForDt({
      dtTenant: 'x',
      ingestToken: 't',
      serviceName: 's',
      serviceInstanceId: 'pod-abc',
      deploymentEnvironment: 'prod',
    });
    expect(env['OTEL_RESOURCE_ATTRIBUTES']).toContain('service.name=s');
    expect(env['OTEL_RESOURCE_ATTRIBUTES']).toContain('service.instance.id=pod-abc');
    expect(env['OTEL_RESOURCE_ATTRIBUTES']).toContain('deployment.environment=prod');
  });

  it('should honor http/protobuf protocol', () => {
    const env = getOtelEnvForDt({
      dtTenant: 'x',
      ingestToken: 't',
      serviceName: 's',
      protocol: 'http/protobuf',
    });
    expect(env['OTEL_EXPORTER_OTLP_PROTOCOL']).toBe('http/protobuf');
  });

  it('should disable signals not listed in options.signals', () => {
    const env = getOtelEnvForDt({
      dtTenant: 'x',
      ingestToken: 't',
      serviceName: 's',
      signals: ['metrics'],
    });
    expect(env['OTEL_METRICS_EXPORTER']).toBe('otlp');
    expect(env['OTEL_TRACES_EXPORTER']).toBe('none');
    expect(env['OTEL_LOGS_EXPORTER']).toBe('none');
  });

  it('should honor custom region + extra resourceAttributes', () => {
    const env = getOtelEnvForDt({
      dtTenant: 'abc',
      dtRegion: 'sprint',
      ingestToken: 't',
      serviceName: 's',
      resourceAttributes: { 'host.name': 'web-01', 'telemetry.sdk.name': 'custom' },
    });
    expect(env['OTEL_EXPORTER_OTLP_ENDPOINT']).toContain('abc.sprint.dynatrace.com');
    expect(env['OTEL_RESOURCE_ATTRIBUTES']).toContain('host.name=web-01');
    expect(env['OTEL_RESOURCE_ATTRIBUTES']).toContain('telemetry.sdk.name=custom');
  });
});

describe('formatOtelEnvAsDotenv', () => {
  it('should emit KEY=value lines', () => {
    const result = formatOtelEnvAsDotenv({
      OTEL_SERVICE_NAME: 'svc',
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=svc,env=prod',
    });
    expect(result).toContain('OTEL_SERVICE_NAME=svc');
    expect(result).toContain('OTEL_RESOURCE_ATTRIBUTES=');
  });

  it('should quote values containing whitespace or commas', () => {
    const result = formatOtelEnvAsDotenv({
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Api-Token XXX',
    });
    expect(result).toMatch(/^OTEL_EXPORTER_OTLP_HEADERS="Authorization=Api-Token XXX"$/);
  });
});
