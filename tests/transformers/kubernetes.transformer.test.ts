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
    const selector = result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack.namespaceSelector!;
    const exprs = selector.matchExpressions!;
    expect(exprs.some((e) => e.operator === 'In' && e.values.includes('payments'))).toBe(true);
    expect(exprs.some((e) => e.operator === 'NotIn' && e.values.includes('kube-system'))).toBe(
      true,
    );
  });

  it('should omit namespaceSelector when neither list is set', () => {
    const result = transformer.transform({ clusterName: 'c' });
    expect(result.data!.dynaKube.spec.oneAgent.cloudNativeFullStack.namespaceSelector).toBeUndefined();
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
