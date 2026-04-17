/**
 * Kubernetes Transformer — Converts New Relic Kubernetes integration
 * config (NR Cluster Explorer / Pixie) to Dynatrace Gen3 DynaKube
 * CustomResource spec (full fidelity).
 *
 * Covers the full set of DynaKube spec fields exposed by the NR
 * integration inputs: namespace selectors, CSI driver toggle,
 * privileged / hostNetwork mode, per-component resource requests/limits,
 * tolerations + nodeSelector + priorityClassName, ActiveGate capability
 * set and its own resource spec, log monitoring, metadata enrichment.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRKubernetesMode = 'cloudNativeFullStack' | 'classicFullStack' | 'applicationMonitoring' | 'hostMonitoring';

export interface NRKubernetesResourceLimits {
  readonly cpu?: string;
  readonly memory?: string;
}

export interface NRKubernetesResources {
  readonly requests?: NRKubernetesResourceLimits;
  readonly limits?: NRKubernetesResourceLimits;
}

export interface NRKubernetesToleration {
  readonly key?: string;
  readonly operator?: 'Equal' | 'Exists';
  readonly value?: string;
  readonly effect?: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
  readonly tolerationSeconds?: number;
}

export type NRActiveGateCapability =
  | 'routing'
  | 'kubernetes-monitoring'
  | 'dynatrace-api'
  | 'metrics-ingest'
  | 'beacon-forwarder'
  | 'kubernetes-monitoring-extensions';

export interface NRKubernetesClusterInput {
  readonly clusterName?: string;
  readonly clusterNamespace?: string;
  readonly k8sVersion?: string;
  readonly cloudProvider?: 'AWS' | 'AZURE' | 'GCP' | 'ON_PREM';
  readonly monitoredNamespaces?: string[];
  readonly excludedNamespaces?: string[];
  readonly pixieEnabled?: boolean;
  readonly logsEnabled?: boolean;
  // ─── Full-fidelity extensions ────────────────────────────────────────
  readonly mode?: NRKubernetesMode;
  readonly csiDriver?: boolean;
  readonly privileged?: boolean;
  readonly hostNetwork?: boolean;
  readonly oneAgentResources?: NRKubernetesResources;
  readonly activeGateResources?: NRKubernetesResources;
  readonly tolerations?: NRKubernetesToleration[];
  readonly nodeSelector?: Record<string, string>;
  readonly priorityClassName?: string;
  readonly apiUrl?: string;
  readonly activeGateCapabilities?: NRActiveGateCapability[];
  readonly replicas?: number;
  readonly metadataEnrichment?: boolean;
  readonly annotations?: Record<string, string>;
  readonly labels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Gen3 output — DynaKube CR body
// ---------------------------------------------------------------------------

export interface DTDynaKubeManifest {
  readonly apiVersion: 'dynatrace.com/v1beta2';
  readonly kind: 'DynaKube';
  readonly metadata: {
    readonly name: string;
    readonly namespace: string;
    readonly annotations?: Record<string, string>;
    readonly labels?: Record<string, string>;
  };
  readonly spec: {
    readonly apiUrl: string;
    readonly tokens?: string;
    readonly skipCertCheck?: boolean;
    readonly enableIstio?: boolean;
    readonly metadataEnrichment?: { readonly enabled: boolean };
    readonly oneAgent: {
      readonly cloudNativeFullStack?: DTDynaKubeOneAgentSpec;
      readonly classicFullStack?: DTDynaKubeOneAgentSpec;
      readonly applicationMonitoring?: DTDynaKubeOneAgentSpec;
      readonly hostMonitoring?: DTDynaKubeOneAgentSpec;
    };
    readonly activeGate: {
      readonly capabilities: NRActiveGateCapability[];
      readonly replicas?: number;
      readonly resources?: NRKubernetesResources;
      readonly tolerations?: NRKubernetesToleration[];
      readonly nodeSelector?: Record<string, string>;
      readonly priorityClassName?: string;
    };
    readonly logMonitoring: { readonly enabled: boolean };
  };
}

export interface DTDynaKubeOneAgentSpec {
  readonly namespaceSelector?: {
    readonly matchExpressions?: Array<{
      readonly key: 'metadata.name';
      readonly operator: 'In' | 'NotIn';
      readonly values: string[];
    }>;
  };
  readonly csiDriver?: { readonly enabled: boolean };
  readonly hostNetwork?: boolean;
  readonly secCompProfile?: string;
  readonly privileged?: boolean;
  readonly resources?: NRKubernetesResources;
  readonly tolerations?: NRKubernetesToleration[];
  readonly nodeSelector?: Record<string, string>;
  readonly priorityClassName?: string;
}

export interface KubernetesTransformData {
  readonly dynaKube: DTDynaKubeManifest;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_AG_CAPABILITIES: NRActiveGateCapability[] = [
  'routing',
  'kubernetes-monitoring',
  'dynatrace-api',
];

const MANUAL_STEPS: string[] = [
  'Create the `dynatrace` namespace: `kubectl create namespace dynatrace`.',
  'Create the DT PaaS + data-ingest token secret in the dynatrace namespace before applying the DynaKube CR. NR integration credentials are not transferable.',
  'Install the Dynatrace Operator CRD bundle (kubectl apply -f https://.../kubernetes.yaml).',
  'Apply the generated DynaKube manifest.',
  'If NR was using Pixie for eBPF-based observability, evaluate DT Grail eBPF ingestion or OneAgent auto-instrumentation — no direct Pixie equivalent.',
  'Validate the manifest locally before cluster-side apply: `kubectl apply --dry-run=client -f dynakube.yaml` (and ideally `--dry-run=server` against a test cluster).',
];

function buildNamespaceSelector(
  monitored: readonly string[],
  excluded: readonly string[],
): DTDynaKubeOneAgentSpec['namespaceSelector'] | undefined {
  if (monitored.length === 0 && excluded.length === 0) return undefined;
  return {
    matchExpressions: [
      ...(monitored.length > 0
        ? [{ key: 'metadata.name' as const, operator: 'In' as const, values: [...monitored] }]
        : []),
      ...(excluded.length > 0
        ? [{ key: 'metadata.name' as const, operator: 'NotIn' as const, values: [...excluded] }]
        : []),
    ],
  };
}

function buildOneAgentSpec(input: NRKubernetesClusterInput): DTDynaKubeOneAgentSpec {
  const spec: DTDynaKubeOneAgentSpec = {};
  const ns = buildNamespaceSelector(
    input.monitoredNamespaces ?? [],
    input.excludedNamespaces ?? [],
  );
  if (ns) (spec as Record<string, unknown>)['namespaceSelector'] = ns;
  if (input.csiDriver !== undefined) {
    (spec as Record<string, unknown>)['csiDriver'] = { enabled: input.csiDriver };
  }
  if (input.hostNetwork !== undefined) {
    (spec as Record<string, unknown>)['hostNetwork'] = input.hostNetwork;
  }
  if (input.privileged !== undefined) {
    (spec as Record<string, unknown>)['privileged'] = input.privileged;
  }
  if (input.oneAgentResources) {
    (spec as Record<string, unknown>)['resources'] = input.oneAgentResources;
  }
  if (input.tolerations?.length) {
    (spec as Record<string, unknown>)['tolerations'] = [...input.tolerations];
  }
  if (input.nodeSelector && Object.keys(input.nodeSelector).length > 0) {
    (spec as Record<string, unknown>)['nodeSelector'] = { ...input.nodeSelector };
  }
  if (input.priorityClassName) {
    (spec as Record<string, unknown>)['priorityClassName'] = input.priorityClassName;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// KubernetesTransformer
// ---------------------------------------------------------------------------

export class KubernetesTransformer {
  transform(input: NRKubernetesClusterInput): TransformResult<KubernetesTransformData> {
    try {
      const clusterName = input.clusterName?.trim();
      if (!clusterName) {
        return failure(['clusterName is required']);
      }

      const warnings: string[] = [];
      const mode: NRKubernetesMode = input.mode ?? 'cloudNativeFullStack';

      if (input.pixieEnabled) {
        warnings.push(
          'NR Pixie (eBPF) is enabled. Dynatrace has no direct Pixie equivalent — evaluate Grail eBPF ingestion or rely on OneAgent auto-instrumentation.',
        );
      }

      if (input.privileged === true && mode === 'applicationMonitoring') {
        warnings.push(
          'applicationMonitoring mode does not honor privileged=true; the flag will be ignored by the operator.',
        );
      }

      const oneAgentSpec = buildOneAgentSpec(input);
      const oneAgent: DTDynaKubeManifest['spec']['oneAgent'] = {
        [mode]: oneAgentSpec,
      };

      const capabilities = input.activeGateCapabilities ?? DEFAULT_AG_CAPABILITIES;

      const dynaKube: DTDynaKubeManifest = {
        apiVersion: 'dynatrace.com/v1beta2',
        kind: 'DynaKube',
        metadata: {
          name: clusterName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          namespace: 'dynatrace',
          ...(input.annotations ? { annotations: { ...input.annotations } } : {}),
          ...(input.labels ? { labels: { ...input.labels } } : {}),
        },
        spec: {
          apiUrl: input.apiUrl ?? 'https://<your-env>.live.dynatrace.com/api',
          ...(input.metadataEnrichment !== undefined
            ? { metadataEnrichment: { enabled: input.metadataEnrichment } }
            : {}),
          oneAgent,
          activeGate: {
            capabilities,
            ...(input.replicas !== undefined ? { replicas: input.replicas } : {}),
            ...(input.activeGateResources
              ? { resources: input.activeGateResources }
              : {}),
            ...(input.tolerations?.length ? { tolerations: [...input.tolerations] } : {}),
            ...(input.nodeSelector && Object.keys(input.nodeSelector).length > 0
              ? { nodeSelector: { ...input.nodeSelector } }
              : {}),
            ...(input.priorityClassName
              ? { priorityClassName: input.priorityClassName }
              : {}),
          },
          logMonitoring: { enabled: input.logsEnabled ?? true },
        },
      };

      return success(
        { dynaKube, manualSteps: MANUAL_STEPS },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRKubernetesClusterInput[],
  ): TransformResult<KubernetesTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
