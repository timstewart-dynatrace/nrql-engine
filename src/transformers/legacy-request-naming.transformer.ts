/**
 * Legacy Request Naming Transformer (Gen2-only fallback).
 *
 * NR's `newrelic.setTransactionName(category, name)` sets the
 * service-request name at call-site. The default
 * `CustomInstrumentationTransformer` emits a code-level replacement
 * comment pointing at a DT Settings rule — but for customers on
 * classic DT, the mature `builtin:request-naming.request-naming-rules`
 * schema is the better target. This transformer emits one
 * request-naming rule per call-site, parameterized by the same
 * category/name strings NR used.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRSetTransactionNameSite {
  /** The first argument of setTransactionName — usually a category like "Custom" or a controller name. */
  readonly category?: string;
  /** The second argument — the desired transaction name. */
  readonly name: string;
  /** Service / application the call lives inside. */
  readonly serviceName: string;
  /** HTTP method or request family; optional but useful for the rule condition. */
  readonly httpMethod?: string;
  /** URL path pattern (regex) that narrows the rule; optional. */
  readonly urlPathPattern?: string;
}

export interface NRRequestNamingInput {
  readonly sites: NRSetTransactionNameSite[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LegacyDTRequestNamingRule {
  readonly schemaId: 'builtin:request-naming.request-naming-rules';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly conditions: Array<
    | { readonly attribute: 'service.name'; readonly operator: 'EQUALS'; readonly value: string }
    | { readonly attribute: 'http.method'; readonly operator: 'EQUALS'; readonly value: string }
    | {
        readonly attribute: 'http.request.path';
        readonly operator: 'MATCHES_REGEX';
        readonly value: string;
      }
  >;
  /** Template string with `{category}` / `{name}` placeholders the classic DT engine expands. */
  readonly namingTemplate: string;
}

export interface LegacyRequestNamingTransformData {
  readonly rules: LegacyDTRequestNamingRule[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGACY_WARNING =
  'Emitting Gen2 classic builtin:request-naming.request-naming-rules (legacy). Default path handles setTransactionName() as a code-level CustomInstrumentationTransformer suggestion — use this legacy transformer when the customer wants a server-side rule instead of rewriting source.';

const MANUAL_STEPS: string[] = [
  'Classic DT request naming rules apply server-side — no agent redeployment is needed once the rule is created, unlike the code-level replacement.',
  'The emitted rules assume service.name EQUALS — adjust to STARTS_WITH / CONTAINS in the DT Settings UI if your service fleet has dynamic service names.',
  'namingTemplate carries NR\'s original category + name strings. Verify the final rendered request name in DT Services before removing the NR call site.',
];

function ruleDisplayName(site: NRSetTransactionNameSite, index: number): string {
  const pieces = [site.serviceName, site.category, site.name].filter(Boolean);
  return `[Migrated Legacy naming ${index + 1}] ${pieces.join(' · ')}`;
}

// ---------------------------------------------------------------------------
// LegacyRequestNamingTransformer
// ---------------------------------------------------------------------------

export class LegacyRequestNamingTransformer {
  transform(
    input: NRRequestNamingInput,
  ): TransformResult<LegacyRequestNamingTransformData> {
    try {
      if (!Array.isArray(input.sites) || input.sites.length === 0) {
        return failure(['At least one setTransactionName call-site is required']);
      }
      const warnings: string[] = [LEGACY_WARNING];
      const rules: LegacyDTRequestNamingRule[] = [];

      input.sites.forEach((site, i) => {
        if (!site.serviceName?.trim()) {
          warnings.push(
            `Call-site #${i} has no serviceName — rule emitted without service.name condition (will match across all services; narrow manually).`,
          );
        }
        if (!site.name?.trim()) {
          warnings.push(`Call-site #${i} has no name — skipped.`);
          return;
        }

        const conditions: LegacyDTRequestNamingRule['conditions'] = [];
        if (site.serviceName) {
          conditions.push({
            attribute: 'service.name',
            operator: 'EQUALS',
            value: site.serviceName,
          });
        }
        if (site.httpMethod) {
          conditions.push({
            attribute: 'http.method',
            operator: 'EQUALS',
            value: site.httpMethod.toUpperCase(),
          });
        }
        if (site.urlPathPattern) {
          conditions.push({
            attribute: 'http.request.path',
            operator: 'MATCHES_REGEX',
            value: site.urlPathPattern,
          });
        }

        const namingTemplate = site.category
          ? `${site.category} / ${site.name}`
          : site.name;

        rules.push({
          schemaId: 'builtin:request-naming.request-naming-rules',
          displayName: ruleDisplayName(site, i),
          enabled: true,
          conditions,
          namingTemplate,
        });
      });

      return success({ rules, manualSteps: MANUAL_STEPS }, [
        ...warnings,
        ...MANUAL_STEPS,
      ]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRRequestNamingInput[],
  ): TransformResult<LegacyRequestNamingTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
