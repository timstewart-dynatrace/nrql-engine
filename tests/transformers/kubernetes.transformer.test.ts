import { describe, it, expect, beforeEach } from 'vitest';
import { KubernetesTransformer } from '../../src/transformers/index.js';

describe('KubernetesTransformer', () => {
  let transformer: KubernetesTransformer;

  beforeEach(() => {
    transformer = new KubernetesTransformer();
  });

  it('should fail when clusterName is missing', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(false);
  });

  it('should emit DynaKube CR with correct apiVersion and kind', () => {
    const result = transformer.transform({ clusterName: 'prod-cluster' });
    expect(result.success).toBe(true);
    expect(result.data!.dynaKube.apiVersion).toBe('dynatrace.com/v1beta2');
    expect(result.data!.dynaKube.kind).toBe('DynaKube');
    expect(result.data!.dynaKube.metadata.namespace).toBe('dynatrace');
  });

  it('should sanitize cluster name for k8s metadata', () => {
    const result = transformer.transform({ clusterName: 'Prod Cluster 01!' });
    expect(result.data!.dynaKube.metadata.name).toBe('prod-cluster-01-');
  });

  it('should include namespace include/exclude match expressions', () => {
    const result = transformer.transform({
      clusterName: 'c',
      monitoredNamespaces: ['payments', 'checkout'],
      excludedNamespaces: ['kube-system'],
    });
    const selector = result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!.namespaceSelector!;
    const exprs = selector.matchExpressions!;
    expect(exprs.some((e) => e.operator === 'In' && e.values.includes('payments'))).toBe(true);
    expect(exprs.some((e) => e.operator === 'NotIn' && e.values.includes('kube-system'))).toBe(
      true,
    );
  });

  it('should omit namespaceSelector when neither list is set', () => {
    const result = transformer.transform({ clusterName: 'c' });
    expect(result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!.namespaceSelector).toBeUndefined();
  });

  it('should emit csiDriver toggle when provided', () => {
    const result = transformer.transform({ clusterName: 'c', csiDriver: true });
    expect(result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!.csiDriver).toEqual({
      enabled: true,
    });
  });

  it('should emit privileged / hostNetwork when set', () => {
    const result = transformer.transform({
      clusterName: 'c',
      privileged: true,
      hostNetwork: true,
    });
    const spec = result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!;
    expect(spec.privileged).toBe(true);
    expect(spec.hostNetwork).toBe(true);
  });

  it('should emit OneAgent resources (requests + limits)', () => {
    const result = transformer.transform({
      clusterName: 'c',
      oneAgentResources: {
        requests: { cpu: '100m', memory: '256Mi' },
        limits: { cpu: '500m', memory: '1Gi' },
      },
    });
    const res = result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!.resources!;
    expect(res.requests?.cpu).toBe('100m');
    expect(res.limits?.memory).toBe('1Gi');
  });

  it('should emit ActiveGate resources + replicas when set', () => {
    const result = transformer.transform({
      clusterName: 'c',
      activeGateResources: { limits: { cpu: '2', memory: '2Gi' } },
      replicas: 3,
    });
    expect(result.data!.dynaKube.spec.activeGate.replicas).toBe(3);
    expect(result.data!.dynaKube.spec.activeGate.resources?.limits?.cpu).toBe('2');
  });

  it('should emit tolerations + nodeSelector + priorityClassName on both OneAgent and ActiveGate', () => {
    const result = transformer.transform({
      clusterName: 'c',
      tolerations: [{ key: 'dedicated', operator: 'Equal', value: 'monitoring', effect: 'NoSchedule' }],
      nodeSelector: { role: 'monitoring' },
      priorityClassName: 'high-prio',
    });
    const oa = result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack!;
    expect(oa.tolerations?.[0]!.key).toBe('dedicated');
    expect(oa.nodeSelector).toEqual({ role: 'monitoring' });
    expect(oa.priorityClassName).toBe('high-prio');

    const ag = result.data!.dynaKube.spec.activeGate;
    expect(ag.tolerations?.[0]!.key).toBe('dedicated');
    expect(ag.nodeSelector).toEqual({ role: 'monitoring' });
    expect(ag.priorityClassName).toBe('high-prio');
  });

  it('should honor explicit DynaKube mode', () => {
    const result = transformer.transform({
      clusterName: 'c',
      mode: 'applicationMonitoring',
    });
    expect(result.data!.dynaKube.spec.oneAgent.applicationMonitoring).toBeDefined();
    expect(result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack).toBeUndefined();
  });

  it('should warn when privileged=true is set with applicationMonitoring mode', () => {
    const result = transformer.transform({
      clusterName: 'c',
      mode: 'applicationMonitoring',
      privileged: true,
    });
    expect(result.warnings.some((w) => w.includes('applicationMonitoring'))).toBe(true);
  });

  it('should accept custom ActiveGate capabilities', () => {
    const result = transformer.transform({
      clusterName: 'c',
      activeGateCapabilities: ['routing', 'metrics-ingest', 'kubernetes-monitoring'],
    });
    expect(result.data!.dynaKube.spec.activeGate.capabilities).toEqual([
      'routing',
      'metrics-ingest',
      'kubernetes-monitoring',
    ]);
  });

  it('should emit metadataEnrichment flag + metadata annotations/labels', () => {
    const result = transformer.transform({
      clusterName: 'c',
      metadataEnrichment: true,
      annotations: { 'feature.dynatrace.com/automatic-injection': 'true' },
      labels: { team: 'sre' },
    });
    expect(result.data!.dynaKube.spec.metadataEnrichment).toEqual({ enabled: true });
    expect(result.data!.dynaKube.metadata.annotations?.['feature.dynatrace.com/automatic-injection']).toBe(
      'true',
    );
    expect(result.data!.dynaKube.metadata.labels?.team).toBe('sre');
  });

  it('should honor custom apiUrl', () => {
    const result = transformer.transform({
      clusterName: 'c',
      apiUrl: 'https://abc12345.live.dynatrace.com/api',
    });
    expect(result.data!.dynaKube.spec.apiUrl).toBe(
      'https://abc12345.live.dynatrace.com/api',
    );
  });

  it('should enable log monitoring by default and include ActiveGate capabilities', () => {
    const result = transformer.transform({ clusterName: 'c' });
    expect(result.data!.dynaKube.spec.logMonitoring.enabled).toBe(true);
    expect(result.data!.dynaKube.spec.activeGate.capabilities).toContain('kubernetes-monitoring');
    expect(result.data!.dynaKube.spec.activeGate.capabilities).toContain('routing');
  });

  it('should warn when Pixie is enabled', () => {
    const result = transformer.transform({ clusterName: 'c', pixieEnabled: true });
    expect(result.warnings.some((w) => w.includes('Pixie'))).toBe(true);
  });

  it('should emit manual steps about operator + secret setup', () => {
    const result = transformer.transform({ clusterName: 'c' });
    expect(result.warnings.some((w) => w.includes('Dynatrace Operator'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('namespace'))).toBe(true);
  });
});
