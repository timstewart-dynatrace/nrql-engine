import { describe, it, expect, beforeEach } from 'vitest';
import { MobileRUMTransformer } from '../../src/transformers/index.js';

describe('MobileRUMTransformer', () => {
  let transformer: MobileRUMTransformer;

  beforeEach(() => {
    transformer = new MobileRUMTransformer();
  });

  it('should emit app detection for Android with bundle id', () => {
    const result = transformer.transform({
      name: 'Acme Mobile',
      platform: 'ANDROID',
      bundleId: 'com.acme.app',
    });
    expect(result.success).toBe(true);
    expect(result.data!.appDetection.schemaId).toBe('builtin:mobile.app-detection');
    expect(result.data!.appDetection.applicationName).toBe('Acme Mobile');
    expect(result.data!.appDetection.platform).toBe('ANDROID');
    expect(result.data!.appDetection.bundleId).toBe('com.acme.app');
  });

  it('should default platform to ANDROID and warn when unset', () => {
    const result = transformer.transform({ name: 'App' });
    expect(result.data!.appDetection.platform).toBe('ANDROID');
    expect(result.warnings.some((w) => w.includes('no platform'))).toBe(true);
  });

  it('should include platform-specific manual step', () => {
    const iosResult = transformer.transform({ name: 'iOS App', platform: 'IOS' });
    expect(iosResult.data!.manualSteps[0]).toContain('CocoaPods');

    const rnResult = transformer.transform({ name: 'RN App', platform: 'REACT_NATIVE' });
    expect(rnResult.data!.manualSteps[0]).toContain('@dynatrace/react-native-plugin');

    const flutterResult = transformer.transform({ name: 'Flutter App', platform: 'FLUTTER' });
    expect(flutterResult.data!.manualSteps[0]).toContain('pubspec.yaml');
  });

  it('should map all standard NR mobile event types', () => {
    const result = transformer.transform({ name: 'App', platform: 'ANDROID' });
    const eventNames = result.data!.eventMappings
      .filter((m) => !m.displayName.includes('custom'))
      .map((m) => m.fieldsAdd[0]!.value);
    expect(eventNames).toContain('rum.mobile.session');
    expect(eventNames).toContain('rum.mobile.crash');
    expect(eventNames).toContain('rum.mobile.exception');
    expect(eventNames).toContain('rum.mobile.request');
    expect(eventNames).toContain('rum.mobile.request_error');
  });

  it('should map custom mobile events under rum.mobile.custom.*', () => {
    const result = transformer.transform({
      name: 'App',
      platform: 'IOS',
      customEvents: ['Checkout', 'AddToCart'],
    });
    const custom = result.data!.eventMappings.find((m) => m.displayName.includes('Checkout'));
    expect(custom!.fieldsAdd[0]!.value).toBe('rum.mobile.custom.Checkout');
  });

  it('should emit SDK-swap and symbolication manual-step warnings', () => {
    const result = transformer.transform({ name: 'App', platform: 'ANDROID' });
    expect(result.warnings.some((w) => w.includes('Mobile Agent'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('symbolication'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('applicationToken'))).toBe(true);
  });

  it('should cover all 8 platforms', () => {
    const platforms = [
      'ANDROID',
      'IOS',
      'REACT_NATIVE',
      'FLUTTER',
      'XAMARIN',
      'UNITY',
      'CORDOVA',
      'CAPACITOR',
    ] as const;
    for (const platform of platforms) {
      const result = transformer.transform({ name: `${platform} App`, platform });
      expect(result.success).toBe(true);
      expect(result.data!.appDetection.platform).toBe(platform);
      expect(result.data!.manualSteps[0]).toBeTruthy();
    }
  });

  it('should transform multiple apps via transformAll', () => {
    const results = transformer.transformAll([
      { name: 'A', platform: 'ANDROID' },
      { name: 'B', platform: 'IOS' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
