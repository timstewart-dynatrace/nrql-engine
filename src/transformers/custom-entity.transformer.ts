/**
 * Custom Entity Transformer — Converts NR custom entities (via the
 * entity platform) to Dynatrace custom-device POST payloads.
 *
 * DT API: `POST /api/v2/entities/custom`
 *   Body: { customDeviceId, displayName, group, ipAddresses, listenPorts,
 *          type, faviconUrl, configUrl, properties, tags }
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRCustomEntityInput {
  readonly name: string;
  /** NR entity GUID used as stable id; mapped to customDeviceId. */
  readonly guid?: string;
  readonly type?: string;
  readonly group?: string;
  readonly ipAddresses?: string[];
  readonly listenPorts?: number[];
  readonly tags?: Record<string, string>;
  readonly properties?: Record<string, string>;
  readonly configUrl?: string;
  readonly faviconUrl?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DTCustomDevicePayload {
  readonly customDeviceId: string;
  readonly displayName: string;
  readonly group: string;
  readonly type: string;
  readonly ipAddresses?: string[];
  readonly listenPorts?: number[];
  readonly tags: string[];
  readonly properties?: Record<string, string>;
  readonly configUrl?: string;
  readonly faviconUrl?: string;
}

export interface CustomEntityTransformData {
  readonly endpoint: '/api/v2/entities/custom';
  readonly payload: DTCustomDevicePayload;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-device';
}

const MANUAL_STEPS: string[] = [
  'POST each payload to /api/v2/entities/custom with an API token carrying the `entities.write` scope.',
  'DT custom devices re-create on every POST — use a stable customDeviceId (we derive it from the NR guid when supplied) to keep the same entity across runs.',
  'Custom-device metrics must be ingested separately via the Metrics v2 API; tags + properties set here are display-only unless you attach metrics by customDeviceId.',
];

// ---------------------------------------------------------------------------
// CustomEntityTransformer
// ---------------------------------------------------------------------------

export class CustomEntityTransformer {
  transform(input: NRCustomEntityInput): TransformResult<CustomEntityTransformData> {
    try {
      const name = input.name?.trim();
      if (!name) return failure(['Custom entity name is required']);
      const warnings: string[] = [];

      const customDeviceId = input.guid ?? `nr-migrated-${slug(name)}`;

      const tags: string[] = Object.entries(input.tags ?? {}).map(
        ([k, v]) => `${k}:${v}`,
      );
      tags.push('nr-migrated');

      const payload: DTCustomDevicePayload = {
        customDeviceId,
        displayName: name,
        group: input.group ?? 'nr-migrated',
        type: input.type ?? 'CUSTOM',
        ...(input.ipAddresses?.length ? { ipAddresses: [...input.ipAddresses] } : {}),
        ...(input.listenPorts?.length ? { listenPorts: [...input.listenPorts] } : {}),
        tags,
        ...(input.properties ? { properties: { ...input.properties } } : {}),
        ...(input.configUrl ? { configUrl: input.configUrl } : {}),
        ...(input.faviconUrl ? { faviconUrl: input.faviconUrl } : {}),
      };

      if (!input.guid) {
        warnings.push(
          `Custom entity '${name}' has no NR guid — derived customDeviceId '${customDeviceId}' from the name. Supply guid to preserve entity identity across re-runs.`,
        );
      }

      return success(
        {
          endpoint: '/api/v2/entities/custom',
          payload,
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCustomEntityInput[],
  ): TransformResult<CustomEntityTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
