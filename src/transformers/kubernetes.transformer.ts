/**
 * Kubernetes Transformer — Converts New Relic Kubernetes integration
 * config (NR Cluster Explorer / Pixie) to Dynatrace Gen3 DynaKube
 * CustomResource spec.
 *
 * The transformer emits a DynaKube manifest body suitable for
 * `kubectl apply -f`. Secrets (DT PaaS / data-ingest tokens, API URLs)
 * are flagged as manual pre-deployment steps.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRKubernetesClusterInput {
  readonly clusterName?: string;
  readonly clusterNamespace?: string;
  readonly k8sVersion?: string;
  readonly cloudProvider?: 'AWS' | 'AZURE' | 'GCP' | 'ON_PREM';
  readonly monitoredNamespaces?: string[];
  readonly excludedNamespaces?: string[];
  readonly pixieEnabled?: boolean;
  readonly logsEnabled?: boolean;
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
  };
  readonly spec: {
    readonly apiUrl: string;
    readonly oneAgent: {
      readonly cloudNativeFullStack: {
        readonly namespaceSelector?: {
          readonly matchExpressions?: Array<{
            readonly key: 'metadata.name';
            readonly operator: 'In' | 'NotIn';
            readonly values: string[];
          }>;
        };
      };
    };
    readonly activeGate: {
      readonly capabilities: Array<'routing' | 'kubernetes-monitoring' | 'dynatrace-api'>;
    };
    readonly logMonitoring: { readonly enabled: boolean };
  };
}

export interface KubernetesTransformData {
  readonly dynaKube: DTDynaKubeManifest;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MANUAL_STEPS: string[] = [
  'Create the `dynatrace` namespace: `kubectl create namespace dynatrace`.',
  'Create the DT PaaS + data-ingest token secret in the dynatrace namespace before applying the DynaKube CR. NR integration credentials are not transferable.',
  'Install the Dynatrace Operator CRD bundle (kubectl apply -f https://.../kubernetes.yaml).',
  'Apply the generated DynaKube manifest.',
  'If NR was using Pixie for eBPF-based observability, evaluate DT Grail eBPF ingestion or OneAgent auto-instrumentation — no direct Pixie equivalent.',
];

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
      const monitored = input.monitoredNamespaces ?? [];
      const excluded = input.excludedNamespaces ?? [];

      const namespaceSelector:
        | NonNullable<DTDynaKubeManifest['spec']['oneAgent']['cloudNativeFullStack']['namespaceSelector']>
        | undefined =
        monitored.length === 0 && excluded.length === 0
          ? undefined
          : {
              matchExpressions: [
                ...(monitored.length > 0
                  ? [
                      {
                        key: 'metadata.name' as const,
                        operator: 'In' as const,
                        values: monitored,
                      },
                    ]
                  : []),
                ...(excluded.length > 0
                  ? [
                      {
                        key: 'metadata.name' as const,
                        operator: 'NotIn' as const,
                        values: excluded,
                      },
                    ]
                  : []),
              ],
            };

      if (input.pixieEnabled) {
        warnings.push(
          'NR Pixie (eBPF) is enabled. Dynatrace has no direct Pixie equivalent — evaluate Grail eBPF ingestion or rely on OneAgent auto-instrumentation.',
        );
      }

      const dynaKube: DTDynaKubeManifest = {
        apiVersion: 'dynatrace.com/v1beta2',
        kind: 'DynaKube',
        metadata: {
          name: clusterName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          namespace: 'dynatrace',
        },
        spec: {
          apiUrl: 'https://<your-env>.live.dynatrace.com/api',
          oneAgent: {
            cloudNativeFullStack:
              namespaceSelector === undefined ? {} : { namespaceSelector },
          },
          activeGate: {
            capabilities: ['routing', 'kubernetes-monitoring', 'dynatrace-api'],
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
