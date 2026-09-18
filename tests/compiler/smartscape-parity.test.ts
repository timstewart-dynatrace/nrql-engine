/**
 * Smartscape-first emission parity.
 *
 * Mirrors Python tests/unit/test_phase19b_engine_parity.py::TestSmartscapeParity
 * and ::TestK8sOverridesParity::EXPECTED_ENTITY_FIELD_DQL in
 * NewRelic-to-Dynatrace-Migration-Utilities. Same inputs, same expected strings.
 */

import { describe, it, expect } from 'vitest';
import { NRQLCompiler, DQLEmitter } from '../../src/compiler/index.js';
import { DQLFixer } from '../../src/validators/index.js';

const compiler = new NRQLCompiler();

const EXPECTED_ENTITY_FIELD_DQL: Record<string, string> = {
  isready:
    'smartscapeNodes K8S_DEPLOYMENT, K8S_STATEFULSET, K8S_REPLICASET\n' +
    '| parse k8s.object, "JSON:config"\n' +
    '| fieldsAdd desiredReplicas = config[`spec`][`replicas`], ' +
    'readyReplicas = config[`status`][`readyReplicas`]',
  status:
    'smartscapeNodes K8S_DEPLOYMENT, K8S_DAEMONSET, K8S_STATEFULSET, K8S_REPLICASET, ' +
    'K8S_REPLICATIONCONTROLLER, K8S_JOB, K8S_DEPLOYMENTCONFIG\n' +
    '| parse k8s.object, "JSON:config"\n' +
    '| fieldsAdd desiredReplicas = config[`spec`][`replicas`], ' +
    'readyReplicas = config[`status`][`readyReplicas`], ' +
    'availableReplicas = config[`status`][`availableReplicas`]',
  isscheduled:
    'smartscapeNodes K8S_POD\n' +
    '| parse k8s.object, "JSON:config"\n' +
    '| fieldsAdd phase = config[`status`][`phase`]',
};

const FIXER_CASES: Array<[string, string]> = [
  ['fetch dt.entity.host\n| fields entity.name, id', 'smartscapeNodes HOST\n| fields name, id'],
  [
    'timeseries avg(dt.host.cpu.usage), by: {dt.entity.host}\n| fieldsAdd n = entityName(dt.entity.host)',
    'timeseries avg(dt.host.cpu.usage), by: {dt.smartscape.host}\n| fieldsAdd n = getNodeName(dt.smartscape.host)',
  ],
  [
    'fetch spans\n| filter dt.entity.process_group_instance == "PROCESS_GROUP_INSTANCE-18AA85290DF3D5D2"',
    '// NOTE: classic entity IDs wrapped in toSmartscapeId(); verify they resolve ' +
      '(IDs do not always carry over)\n' +
      'fetch spans\n| filter dt.smartscape.process == toSmartscapeId("PROCESS_GROUP_INSTANCE-18AA85290DF3D5D2")',
  ],
];

const fix = (dql: string): string => new DQLFixer().validateAndFix(dql)[0];

describe('Smartscape-first emission parity', () => {
  it('K8s entity fields match the Python strings exactly', () => {
    for (const [key, expected] of Object.entries(EXPECTED_ENTITY_FIELD_DQL)) {
      expect(DQLEmitter.K8S_ENTITY_FIELDS[key]?.dql).toBe(expected);
    }
  });

  it('maps entityName / entity.name to a raw dimension by context', () => {
    const cases: Record<string, string> = {
      "SELECT count(*) FROM Transaction WHERE entityName = 'svc'": 'dt.service.name == "svc"',
      'SELECT average(cpuPercent) FROM SystemSample FACET entityName': 'by: {host.name}',
      'SELECT average(apm.service.transaction.duration) FROM Metric FACET entity.name':
        'by: {dt.service.name}',
      'SELECT average(cpuUsedCores) FROM K8sContainerSample FACET entityName':
        'by: {k8s.workload.name}',
    };
    for (const [nrql, expected] of Object.entries(cases)) {
      const result = compiler.compile(nrql);
      expect(result.success, nrql).toBe(true);
      expect(result.dql, nrql).toContain(expected);
      expect(result.dql, nrql).not.toContain('dt.entity');
    }
  });

  it('maps entityGuid to dt.smartscape.service', () => {
    expect(new DQLEmitter().fieldMap['entityguid']).toBe('dt.smartscape.service');
  });

  it('SHOW EVENT TYPES hint has no classic fetch', () => {
    expect(compiler.compile('SHOW EVENT TYPES').dql).not.toContain('dt.entity');
  });

  it('fixer rewrites 1:1 classic references', () => {
    for (const [dql, expected] of FIXER_CASES) {
      expect(fix(dql)).toBe(expected);
    }
  });

  it('fixer annotates but does not rewrite ambiguous cases', () => {
    const cases: Array<[string, string]> = [
      ['fetch dt.entity.cloud_application\n| fields entity.name', 'maps to several Smartscape types'],
      [
        'fetch logs | filter in(dt.entity.host, classicEntitySelector("type(host)"))',
        'classicEntitySelector is deprecated',
      ],
      ['fetch spans | filter dt.entity.process_group == "x"', 'has no Smartscape entity'],
    ];
    for (const [dql, note] of cases) {
      const out = fix(dql);
      expect(out).toContain(note);
      const code = out.split('\n').filter((l) => !l.startsWith('//')).join('\n');
      expect(code).toBe(dql);
    }
    const attr = fix('fetch spans | fieldsAdd t = entityAttr(dt.entity.host, "tags")');
    expect(attr).toContain('entityAttr() is deprecated');
    expect(attr).toContain('dt.smartscape.host');
  });

  it('fixer leaves comments and clean DQL alone', () => {
    const dql = '// Original NRQL: FROM dt.entity.host\nfetch spans\n| summarize count()';
    expect(fix(dql)).toBe(dql);
  });

  it('fixer is idempotent', () => {
    for (const [dql] of FIXER_CASES) {
      const once = fix(dql);
      expect(fix(once)).toBe(once);
    }
  });
});
