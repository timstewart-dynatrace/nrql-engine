/**
 * Change Tracking Transformer — Converts New Relic change events +
 * deployment markers to Dynatrace event-API payloads.
 *
 * Gen3 output:
 *   - `DTCustomEventPayload` (eventType CUSTOM_DEPLOYMENT or
 *     CUSTOM_CONFIGURATION) posted to `/api/v2/events/ingest`
 *   - A Gen3 Workflow trigger stub that fires when the custom event is
 *     ingested, so change correlation can be wired into Davis.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRChangeCategory =
  | 'DEPLOYMENT'
  | 'FEATURE_FLAG'
  | 'CONFIGURATION'
  | 'BUSINESS_EVENT'
  | 'OTHER';

export interface NRChangeEventInput {
  readonly category?: NRChangeCategory;
  readonly entityGuid?: string;
  readonly entityName?: string;
  readonly version?: string;
  readonly user?: string;
  readonly description?: string;
  readonly timestamp?: string;
  readonly customAttributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export type DTEventType = 'CUSTOM_DEPLOYMENT' | 'CUSTOM_CONFIGURATION' | 'CUSTOM_INFO';

export interface DTCustomEventPayload {
  readonly eventType: DTEventType;
  readonly title: string;
  readonly entitySelector: string;
  readonly properties: Record<string, string>;
  readonly startTime?: string;
  readonly timeout?: number;
}

export interface ChangeTrackingTransformData {
  readonly eventPayload: DTCustomEventPayload;
  readonly ingestPath: '/api/v2/events/ingest';
  readonly workflowTriggerStub: {
    readonly schemaId: 'builtin:automation.workflows';
    readonly matcher: string;
  };
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_TO_DT_TYPE: Record<NRChangeCategory, DTEventType> = {
  DEPLOYMENT: 'CUSTOM_DEPLOYMENT',
  CONFIGURATION: 'CUSTOM_CONFIGURATION',
  FEATURE_FLAG: 'CUSTOM_CONFIGURATION',
  BUSINESS_EVENT: 'CUSTOM_INFO',
  OTHER: 'CUSTOM_INFO',
};

const MANUAL_STEPS: string[] = [
  'Provision an ingest API token with `events.ingest` scope. NR change-tracking tokens are not transferable.',
  'Point any CI/CD pipelines currently calling the NR Change Tracking API at the DT events ingest endpoint `/api/v2/events/ingest`.',
  'If change events should trigger Davis correlation, enable the emitted Workflow trigger stub or wire the custom event into an existing Workflow.',
];

// ---------------------------------------------------------------------------
// ChangeTrackingTransformer
// ---------------------------------------------------------------------------

export class ChangeTrackingTransformer {
  transform(input: NRChangeEventInput): TransformResult<ChangeTrackingTransformData> {
    try {
      const category = input.category ?? 'OTHER';
      const eventType = CATEGORY_TO_DT_TYPE[category];
      const entityName = input.entityName?.trim();
      const entityGuid = input.entityGuid?.trim();

      if (!entityName && !entityGuid) {
        return failure(['Either entityName or entityGuid is required']);
      }

      const warnings: string[] = [];
      const title = input.description
        ? input.description.slice(0, 100)
        : `${category} on ${entityName ?? entityGuid}`;

      const entitySelector = entityGuid
        ? `entityId("${entityGuid}")`
        : `entityName("${entityName}")`;

      const properties: Record<string, string> = {
        source: 'nr-migrated',
        category,
        ...(input.version ? { version: input.version } : {}),
        ...(input.user ? { user: input.user } : {}),
        ...(input.customAttributes ?? {}),
      };

      if (input.timestamp && isNaN(Date.parse(input.timestamp))) {
        warnings.push(
          `Timestamp '${input.timestamp}' is not ISO-8601; DT events ingest requires RFC3339. Emitting without startTime.`,
        );
      }

      const eventPayload: DTCustomEventPayload = {
        eventType,
        title,
        entitySelector,
        properties,
        ...(input.timestamp && !isNaN(Date.parse(input.timestamp))
          ? { startTime: input.timestamp }
          : {}),
      };

      return success(
        {
          eventPayload,
          ingestPath: '/api/v2/events/ingest',
          workflowTriggerStub: {
            schemaId: 'builtin:automation.workflows',
            matcher: `matchesValue(event.type, "${eventType}") and matchesValue(source, "nr-migrated")`,
          },
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRChangeEventInput[],
  ): TransformResult<ChangeTrackingTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
