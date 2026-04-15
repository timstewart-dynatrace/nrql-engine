import { describe, it, expect } from 'vitest';
import { toMonacoYaml } from '../../src/transformers/index.js';

describe('toMonacoYaml', () => {
  it('should return empty string for empty input', () => {
    expect(toMonacoYaml([])).toBe('');
  });

  it('should accept a single envelope or an array', () => {
    const env = {
      schemaId: 'builtin:alerting.profile',
      displayName: 'Prod Alerts',
      value: { name: 'Prod Alerts', severity: 'ERROR' },
    };
    const single = toMonacoYaml(env);
    const asArray = toMonacoYaml([env]);
    expect(single).toBe(asArray);
  });

  it('should emit a configs: list with schema + schemaVersion', () => {
    const yaml = toMonacoYaml({
      schemaId: 'builtin:alerting.profile',
      displayName: 'Prod',
      value: { name: 'Prod' },
    });
    expect(yaml).toContain('configs:');
    expect(yaml).toContain('schema: "builtin:alerting.profile"');
    expect(yaml).toMatch(/schemaVersion:\s+"?1\.0\.0"?/);
  });

  it('should slugify the displayName for the config id', () => {
    const yaml = toMonacoYaml({
      schemaId: 'builtin:alerting.profile',
      displayName: 'My Prod Alerts 2024!',
      value: {},
    });
    expect(yaml).toContain('id: my-prod-alerts-2024');
  });

  it('should embed the value payload as a comment', () => {
    const yaml = toMonacoYaml({
      schemaId: 'builtin:segment',
      value: { name: 'seg', description: 'demo' },
    });
    expect(yaml).toContain('# template payload');
    expect(yaml).toContain('"name": "seg"');
  });

  it('should separate multiple envelopes with --- by default', () => {
    const yaml = toMonacoYaml([
      { schemaId: 'builtin:a', displayName: 'a', value: {} },
      { schemaId: 'builtin:b', displayName: 'b', value: {} },
    ]);
    expect(yaml.split('---').length).toBe(2);
  });

  it('should honor documentSeparators=true for a leading ---', () => {
    const yaml = toMonacoYaml(
      [{ schemaId: 'builtin:a', displayName: 'a', value: {} }],
      { documentSeparators: true },
    );
    expect(yaml.startsWith('---')).toBe(true);
  });

  it('should honor indent override', () => {
    const yaml = toMonacoYaml(
      { schemaId: 'builtin:a', displayName: 'a', value: {} },
      { indentSpaces: 4 },
    );
    expect(yaml).toContain('    id:');
  });
});
