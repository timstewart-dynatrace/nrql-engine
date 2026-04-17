import { describe, it, expect, beforeEach } from 'vitest';
import {
  SyntheticCertificateCheckTransformer,
  SyntheticBrokenLinksTransformer,
} from '../../src/transformers/index.js';

describe('SyntheticCertificateCheckTransformer', () => {
  let transformer: SyntheticCertificateCheckTransformer;

  beforeEach(() => {
    transformer = new SyntheticCertificateCheckTransformer();
  });

  it('should fail without monitoredUrl', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({ monitoredUrl: '' as any });
    expect(result.success).toBe(false);
  });

  it('should emit HTTP monitor with certificate validation rules', () => {
    const result = transformer.transform({
      name: 'acme.com cert',
      monitoredUrl: 'https://acme.com',
      expirationWarningDays: 14,
    });
    expect(result.success).toBe(true);
    const m = result.data!.monitor;
    expect(m.schemaId).toBe('builtin:synthetic_test');
    expect(m.type).toBe('HTTP');
    const req = m.script.requests[0]!;
    expect(req.url).toBe('https://acme.com');
    const rules = req.validation.rules;
    expect(rules.some((r) => r.type === 'certificateValidity')).toBe(true);
    const expRule = rules.find((r) => r.type === 'certificateExpiration');
    expect(expRule).toBeDefined();
    if (expRule && expRule.type === 'certificateExpiration') {
      expect(expRule.warningDaysBeforeExpiry).toBe(14);
    }
  });

  it('should default expiration warning to 30 days', () => {
    const result = transformer.transform({ monitoredUrl: 'https://x' });
    const rules = result.data!.monitor.script.requests[0]!.validation.rules;
    const expRule = rules.find((r) => r.type === 'certificateExpiration');
    if (expRule && expRule.type === 'certificateExpiration') {
      expect(expRule.warningDaysBeforeExpiry).toBe(30);
    }
  });

  it('should map NR period to DT frequencyMin', () => {
    const result = transformer.transform({
      monitoredUrl: 'https://x',
      period: 'EVERY_15_MINUTES',
    });
    expect(result.data!.monitor.frequencyMin).toBe(15);
  });

  it('should disable when status is DISABLED', () => {
    const result = transformer.transform({
      monitoredUrl: 'https://x',
      status: 'DISABLED',
    });
    expect(result.data!.monitor.enabled).toBe(false);
  });
});

describe('SyntheticBrokenLinksTransformer', () => {
  let transformer: SyntheticBrokenLinksTransformer;

  beforeEach(() => {
    transformer = new SyntheticBrokenLinksTransformer();
  });

  it('should fail without rootUrl', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transformer.transform({ rootUrl: '' as any });
    expect(result.success).toBe(false);
  });

  it('should emit a Browser monitor stub + DQL detection + Metric Event', () => {
    const result = transformer.transform({
      name: 'acme.com links',
      rootUrl: 'https://acme.com',
      maxDepth: 3,
    });
    expect(result.success).toBe(true);
    const pkg = result.data!.pkg;
    expect(pkg.browserMonitor.type).toBe('BROWSER');
    expect(pkg.browserMonitor.rootUrl).toBe('https://acme.com');
    expect(pkg.browserMonitor.maxDepth).toBe(3);
    expect(pkg.dqlDetectionQuery).toContain('fetch dt.synthetic.http.request');
    expect(pkg.dqlDetectionQuery).toContain('response.status_code >= 400');
    expect(pkg.metricEventShape.schemaId).toBe(
      'builtin:anomaly-detection.metric-events',
    );
  });

  it('should include TODO clickpath instructions', () => {
    const result = transformer.transform({ rootUrl: 'https://acme.com' });
    expect(result.data!.pkg.browserMonitor.clickPathStub).toContain('TODO');
    expect(result.data!.pkg.browserMonitor.clickPathStub).toContain('https://acme.com');
  });

  it('should default maxDepth to 2', () => {
    const result = transformer.transform({ rootUrl: 'https://acme.com' });
    expect(result.data!.pkg.browserMonitor.maxDepth).toBe(2);
  });

  it('should disable when status is DISABLED', () => {
    const result = transformer.transform({
      rootUrl: 'https://x',
      status: 'DISABLED',
    });
    expect(result.data!.pkg.browserMonitor.enabled).toBe(false);
  });

  it('should emit manual steps about clickpath + Workflow wiring', () => {
    const result = transformer.transform({ rootUrl: 'https://x' });
    expect(result.warnings.some((w) => w.includes('clickpath'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Workflow'))).toBe(true);
  });

  it('should map NR period to frequencyMin on the Browser monitor', () => {
    const result = transformer.transform({
      rootUrl: 'https://x',
      period: 'EVERY_30_MINUTES',
    });
    expect(result.data!.pkg.browserMonitor.frequencyMin).toBe(30);
  });
});
