import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserRUMTransformer } from '../../src/transformers/index.js';

describe('BrowserRUMTransformer', () => {
  let transformer: BrowserRUMTransformer;

  beforeEach(() => {
    transformer = new BrowserRUMTransformer();
  });

  it('should emit app detection with DOMAIN rule when domain is set', () => {
    const result = transformer.transform({
      name: 'Acme Web',
      domain: 'shop.acme.com',
      spa: false,
    });
    expect(result.success).toBe(true);
    expect(result.data!.appDetection.schemaId).toBe('builtin:rum.web.app-detection');
    expect(result.data!.appDetection.applicationName).toBe('Acme Web');
    expect(result.data!.appDetection.rule).toEqual({ type: 'DOMAIN', value: 'shop.acme.com' });
    expect(result.data!.appDetection.spa).toBe(false);
  });

  it('should preserve SPA flag and allow/deny domain lists', () => {
    const result = transformer.transform({
      name: 'SPA App',
      domain: 'spa.acme.com',
      spa: true,
      allowedDomains: ['*.acme.com'],
      deniedDomains: ['admin.acme.com'],
    });
    expect(result.data!.appDetection.spa).toBe(true);
    expect(result.data!.appDetection.allowedDomains).toEqual(['*.acme.com']);
    expect(result.data!.appDetection.deniedDomains).toEqual(['admin.acme.com']);
  });

  it('should fall back to URL_PATH rule and warn when no domain', () => {
    const result = transformer.transform({ name: 'No Domain App' });
    expect(result.data!.appDetection.rule).toEqual({ type: 'URL_PATH', value: '/' });
    expect(result.warnings.some((w) => w.includes('no domain'))).toBe(true);
  });

  it('should map the five standard NR browser event types to rum.* names', () => {
    const result = transformer.transform({ name: 'App', domain: 'app.test' });
    const names = result.data!.eventMappings.map((m) => m.fieldsAdd[0]!.value);
    expect(names).toEqual([
      'rum.page_view',
      'rum.page_action',
      'rum.user_action',
      'rum.ajax_request',
      'rum.js_error',
    ]);
    expect(result.data!.eventMappings[0]!.matcher).toBe(
      'matchesValue(event.type, "PageView")',
    );
  });

  it('should map custom browser events under rum.custom.*', () => {
    const result = transformer.transform({
      name: 'App',
      domain: 'app.test',
      customEvents: ['CartAdd', 'Checkout'],
    });
    const customMapping = result.data!.eventMappings.find((m) =>
      m.displayName.includes('CartAdd'),
    );
    expect(customMapping).toBeDefined();
    expect(customMapping!.fieldsAdd[0]!.value).toBe('rum.custom.CartAdd');
  });

  it('should include all six Core Web Vitals in the note', () => {
    const result = transformer.transform({ name: 'App', domain: 'app.test' });
    expect(result.data!.coreWebVitals.metrics).toEqual([
      'LCP',
      'FID',
      'CLS',
      'INP',
      'TTFB',
      'FCP',
    ]);
  });

  it('should emit manual-step warnings covering agent deployment and secrets', () => {
    const result = transformer.transform({ name: 'App', domain: 'app.test' });
    expect(result.data!.manualSteps.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('RUM JavaScript agent'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Session Replay'))).toBe(true);
  });

  it('should transform multiple apps via transformAll', () => {
    const results = transformer.transformAll([
      { name: 'A', domain: 'a.test' },
      { name: 'B', domain: 'b.test' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
