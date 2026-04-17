/**
 * Specialized Synthetic Transformers — cover two NR monitor types not
 * handled by the general `SyntheticTransformer`:
 *
 *   - **Certificate Check** → DT HTTP Monitor with cert validation rules.
 *   - **Broken Links** → DT does not ship a direct broken-links monitor.
 *     We emit a paired Browser Monitor (page crawl) + DQL-based custom
 *     metric + Metric Event so the signal continues to fire on the
 *     customer's existing Workflows.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Certificate Check
// ═══════════════════════════════════════════════════════════════════════════

export interface NRCertCheckMonitorInput {
  readonly name?: string;
  readonly monitoredUrl: string;
  /** Warn when cert expires within this many days. */
  readonly expirationWarningDays?: number;
  readonly period?: string;
  readonly locations?: string[];
  readonly status?: 'ENABLED' | 'DISABLED';
}

export interface DTHttpMonitorWithCertValidation {
  readonly schemaId: 'builtin:synthetic_test';
  readonly type: 'HTTP';
  readonly name: string;
  readonly enabled: boolean;
  readonly frequencyMin: number;
  readonly locations: string[];
  readonly script: {
    readonly requests: Array<{
      readonly method: 'GET';
      readonly url: string;
      readonly validation: {
        readonly rules: Array<
          | { readonly type: 'httpStatusesList'; readonly value: string }
          | {
              readonly type: 'certificateExpiration';
              readonly warningDaysBeforeExpiry: number;
            }
          | { readonly type: 'certificateValidity'; readonly mustBeValid: true }
        >;
      };
    }>;
  };
}

export interface CertCheckTransformData {
  readonly monitor: DTHttpMonitorWithCertValidation;
  readonly manualSteps: string[];
}

const PERIOD_TO_MIN: Record<string, number> = {
  EVERY_MINUTE: 1,
  EVERY_5_MINUTES: 5,
  EVERY_10_MINUTES: 10,
  EVERY_15_MINUTES: 15,
  EVERY_30_MINUTES: 30,
  EVERY_HOUR: 60,
  EVERY_6_HOURS: 360,
  EVERY_12_HOURS: 720,
  EVERY_DAY: 1440,
};

const CERT_MANUAL_STEPS: string[] = [
  'DT HTTP monitors evaluate certificates at each run; the `certificateExpiration` validation rule fires a problem when the cert is within the warning window.',
  'If the cert check covered a CDN / load-balancer URL behind SNI, verify the monitor targets the exact hostname rather than the IP — DT validates the presented cert against the requested host header.',
];

export class SyntheticCertificateCheckTransformer {
  transform(input: NRCertCheckMonitorInput): TransformResult<CertCheckTransformData> {
    try {
      if (!input.monitoredUrl?.trim()) {
        return failure(['monitoredUrl is required for a certificate-check monitor']);
      }
      const name = input.name ?? `Certificate Check - ${input.monitoredUrl}`;
      const warningDays = input.expirationWarningDays ?? 30;
      const frequencyMin = PERIOD_TO_MIN[input.period ?? 'EVERY_HOUR'] ?? 60;
      const locations = input.locations ?? ['GEOLOCATION-US-EAST-1'];

      const monitor: DTHttpMonitorWithCertValidation = {
        schemaId: 'builtin:synthetic_test',
        type: 'HTTP',
        name: `[Migrated CertCheck] ${name}`,
        enabled: input.status !== 'DISABLED',
        frequencyMin,
        locations: [...locations],
        script: {
          requests: [
            {
              method: 'GET',
              url: input.monitoredUrl,
              validation: {
                rules: [
                  { type: 'httpStatusesList', value: '>=200, <400' },
                  { type: 'certificateValidity', mustBeValid: true },
                  {
                    type: 'certificateExpiration',
                    warningDaysBeforeExpiry: warningDays,
                  },
                ],
              },
            },
          ],
        },
      };

      return success({ monitor, manualSteps: CERT_MANUAL_STEPS }, CERT_MANUAL_STEPS);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCertCheckMonitorInput[],
  ): TransformResult<CertCheckTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Broken Links
// ═══════════════════════════════════════════════════════════════════════════

export interface NRBrokenLinksMonitorInput {
  readonly name?: string;
  readonly rootUrl: string;
  readonly maxDepth?: number;
  readonly period?: string;
  readonly locations?: string[];
  readonly status?: 'ENABLED' | 'DISABLED';
}

export interface DTBrokenLinksPackage {
  readonly browserMonitor: {
    readonly schemaId: 'builtin:synthetic_test';
    readonly type: 'BROWSER';
    readonly name: string;
    readonly enabled: boolean;
    readonly frequencyMin: number;
    readonly locations: string[];
    readonly clickPathStub: string;
    readonly rootUrl: string;
    readonly maxDepth: number;
  };
  readonly dqlDetectionQuery: string;
  readonly metricEventShape: {
    readonly schemaId: 'builtin:anomaly-detection.metric-events';
    readonly summary: string;
    readonly queryDefinition: {
      readonly type: 'DQL';
      readonly query: string;
    };
    readonly monitoringStrategy: {
      readonly type: 'STATIC_THRESHOLD';
      readonly threshold: number;
      readonly alertCondition: 'ABOVE';
    };
  };
}

export interface BrokenLinksTransformData {
  readonly pkg: DTBrokenLinksPackage;
  readonly manualSteps: string[];
}

const BROKEN_LINKS_MANUAL_STEPS: string[] = [
  'Dynatrace does not ship a built-in broken-links monitor. The emitted Browser Monitor is a crawl stub — replace the clickPathStub with a real clickpath that exercises the critical link paths.',
  'The paired DQL detection query counts 4xx/5xx responses against `fetch dt.synthetic.http.request` once the crawl is in place. Tune the 4xx threshold for your site.',
  'Wire the Metric Event into a Workflow (see AlertTransformer + NotificationTransformer) so broken-link problems route like any other Davis problem.',
];

export class SyntheticBrokenLinksTransformer {
  transform(
    input: NRBrokenLinksMonitorInput,
  ): TransformResult<BrokenLinksTransformData> {
    try {
      if (!input.rootUrl?.trim()) {
        return failure(['rootUrl is required for a broken-links monitor']);
      }
      const name = input.name ?? `Broken Links - ${input.rootUrl}`;
      const frequencyMin = PERIOD_TO_MIN[input.period ?? 'EVERY_HOUR'] ?? 60;
      const locations = input.locations ?? ['GEOLOCATION-US-EAST-1'];
      const maxDepth = input.maxDepth ?? 2;

      const dqlDetectionQuery =
        `fetch dt.synthetic.http.request, from:-${frequencyMin}m\n` +
        `| filter monitor.name == "[Migrated BrokenLinks] ${name}"\n` +
        `| filter response.status_code >= 400\n` +
        `| summarize broken = count()`;

      const pkg: DTBrokenLinksPackage = {
        browserMonitor: {
          schemaId: 'builtin:synthetic_test',
          type: 'BROWSER',
          name: `[Migrated BrokenLinks] ${name}`,
          enabled: input.status !== 'DISABLED',
          frequencyMin,
          locations: [...locations],
          clickPathStub: `// TODO: Replace with a clickpath that exercises links under ${input.rootUrl}\n// up to depth ${maxDepth}. Example: navigate to rootUrl, then iterate over anchors.`,
          rootUrl: input.rootUrl,
          maxDepth,
        },
        dqlDetectionQuery,
        metricEventShape: {
          schemaId: 'builtin:anomaly-detection.metric-events',
          summary: `[Migrated BrokenLinks] ${name}`,
          queryDefinition: { type: 'DQL', query: dqlDetectionQuery },
          monitoringStrategy: {
            type: 'STATIC_THRESHOLD',
            threshold: 0,
            alertCondition: 'ABOVE',
          },
        },
      };

      return success(
        { pkg, manualSteps: BROKEN_LINKS_MANUAL_STEPS },
        BROKEN_LINKS_MANUAL_STEPS,
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRBrokenLinksMonitorInput[],
  ): TransformResult<BrokenLinksTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
