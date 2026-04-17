/**
 * Custom Event Transformer — Converts New Relic custom event type
 * definitions (via `recordCustomEvent` / Event API) to Dynatrace
 * Gen3 bizevent ingest configuration.
 *
 * NR side: customer-defined `eventType` strings, with a free-form
 * attribute bag recorded via the Event API or `newrelic.recordCustomEvent()`.
 *
 * DT side:
 *   - `builtin:bizevents.http.incoming.rules` ingest rule that accepts
 *     JSON posted to the bizevent ingest endpoint
 *   - OpenPipeline bizevent processing stage that maps the NR
 *     `eventType` to DT `event.type`
 *   - DQL compatibility note: `FROM <CustomType>` queries rewrite to
 *     `fetch bizevents | filter event.type == "<CustomType>"`
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRCustomEventTypeInput {
  readonly eventType: string;
  readonly description?: string;
  readonly attributes?: NRCustomEventAttribute[];
  /** Sample event payload used to infer attribute types when schema is absent. */
  readonly sample?: Record<string, unknown>;
}

export interface NRCustomEventAttribute {
  readonly name: string;
  readonly type?: 'string' | 'number' | 'boolean' | 'timestamp';
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTBizeventIngestRule {
  readonly schemaId: 'builtin:bizevents.http.incoming.rules';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly ruleName: string;
  readonly source: {
    readonly path: '/platform/ingest/v1/events.bizevents';
    readonly contentType: 'application/json';
  };
  readonly eventProvider: string;
  readonly eventType: string;
}

export interface DTBizeventProcessingRule {
  readonly schemaId: 'builtin:openpipeline.bizevents.pipelines';
  readonly displayName: string;
  readonly matcher: string;
  readonly fieldsAdd: Array<{ field: string; value: string }>;
}

export interface CustomEventTransformData {
  readonly ingestRule: DTBizeventIngestRule;
  readonly processingRule: DTBizeventProcessingRule;
  readonly attributes: NRCustomEventAttribute[];
  readonly dqlRewrite: string;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferAttributesFromSample(sample: Record<string, unknown>): NRCustomEventAttribute[] {
  const out: NRCustomEventAttribute[] = [];
  for (const [name, value] of Object.entries(sample)) {
    let type: NRCustomEventAttribute['type'];
    if (typeof value === 'string') {
      type = 'string';
    } else if (typeof value === 'number') {
      type = 'number';
    } else if (typeof value === 'boolean') {
      type = 'boolean';
    } else if (value instanceof Date) {
      type = 'timestamp';
    } else {
      type = 'string';
    }
    out.push({ name, type });
  }
  return out;
}

const MANUAL_STEPS: string[] = [
  'Point client code currently calling `newrelic.recordCustomEvent()` or the NR Event API at the Dynatrace bizevent ingest endpoint (/platform/ingest/v1/events.bizevents).',
  'Re-provision an ingest API token with `storage:events:write` scope and inject it via the Authorization header — NR ingest keys are not transferable.',
  'Validate the bizevent payload matches the DT schema (`event.type`, `event.provider`, timestamp). Existing NR attributes flow through unchanged.',
];

// ---------------------------------------------------------------------------
// CustomEventTransformer
// ---------------------------------------------------------------------------

export class CustomEventTransformer {
  transform(input: NRCustomEventTypeInput): TransformResult<CustomEventTransformData> {
    try {
      const eventType = input.eventType?.trim();
      if (!eventType) {
        return failure(['Custom event type name is required']);
      }

      const warnings: string[] = [];

      let attributes = input.attributes ?? [];
      if (attributes.length === 0 && input.sample) {
        attributes = inferAttributesFromSample(input.sample);
        warnings.push(
          `Attribute schema inferred from sample payload for '${eventType}'. Verify types in Dynatrace before production use.`,
        );
      }

      const ingestRule: DTBizeventIngestRule = {
        schemaId: 'builtin:bizevents.http.incoming.rules',
        displayName: `[Migrated] ${eventType} ingest`,
        enabled: true,
        ruleName: `nr_${eventType.toLowerCase()}_ingest`,
        source: {
          path: '/platform/ingest/v1/events.bizevents',
          contentType: 'application/json',
        },
        eventProvider: 'nr.migrated',
        eventType,
      };

      const processingRule: DTBizeventProcessingRule = {
        schemaId: 'builtin:openpipeline.bizevents.pipelines',
        displayName: `[Migrated] ${eventType} → bizevent`,
        matcher: `matchesValue(event.type, "${eventType}")`,
        fieldsAdd: [
          { field: 'event.provider', value: 'nr.migrated' },
          { field: 'nr.original_event_type', value: eventType },
        ],
      };

      const dqlRewrite = `fetch bizevents\n| filter event.type == "${eventType}"`;

      return success(
        {
          ingestRule,
          processingRule,
          attributes,
          dqlRewrite,
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRCustomEventTypeInput[],
  ): TransformResult<CustomEventTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
