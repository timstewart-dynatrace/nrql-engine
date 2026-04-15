/**
 * Browser RUM Transformer — Converts New Relic Browser applications +
 * their event-type-level settings to Dynatrace Gen3 RUM application
 * configs.
 *
 * Gen3 output:
 *   - `builtin:rum.web.app-detection` application detection rule
 *   - `builtin:rum.web.key-user-actions` stub (empty until customer
 *     identifies critical user flows)
 *   - Core Web Vitals monitoring stub (LCP/FID/CLS/INP/TTFB/FCP tracked
 *     automatically by DT RUM agent; the transformer emits metadata
 *     only)
 *   - OpenPipeline bizevents enrichment that maps NR event types
 *     (PageView, BrowserInteraction, AjaxRequest, JavaScriptError) to
 *     `rum.*` event names so existing NRQL → DQL translations keep
 *     working on the same logical fields.
 *
 * Out of scope (flagged as warnings): agent snippet deployment,
 * session replay activation, customer build-pipeline changes.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRBrowserAppInput {
  readonly name?: string;
  readonly guid?: string;
  readonly domain?: string;
  readonly spa?: boolean;
  /** NR browser license / application key; cannot be transferred, flagged for re-provisioning. */
  readonly licenseKey?: string;
  readonly allowedDomains?: string[];
  readonly deniedDomains?: string[];
  readonly customEvents?: string[];
}

// ---------------------------------------------------------------------------
// Gen3 output
// ---------------------------------------------------------------------------

export interface DTRumAppDetection {
  readonly schemaId: 'builtin:rum.web.app-detection';
  readonly displayName: string;
  readonly applicationName: string;
  readonly enabled: boolean;
  readonly rule: {
    readonly type: 'DOMAIN' | 'URL_PATH' | 'TAG';
    readonly value: string;
  };
  readonly spa: boolean;
  readonly allowedDomains: string[];
  readonly deniedDomains: string[];
}

/**
 * OpenPipeline enrichment binding NR browser event types to their DT
 * RUM bizevent counterparts. Customers can then keep using the same
 * DQL queries the compiler emits for PageView / BrowserInteraction /
 * AjaxRequest / JavaScriptError.
 */
export interface DTRumEventMapping {
  readonly schemaId: 'builtin:openpipeline.bizevents.pipelines';
  readonly displayName: string;
  readonly matcher: string;
  readonly fieldsAdd: Array<{ field: string; value: string }>;
}

export interface DTCoreWebVitalsNote {
  readonly metrics: ReadonlyArray<'LCP' | 'FID' | 'CLS' | 'INP' | 'TTFB' | 'FCP'>;
  readonly note: string;
}

export interface BrowserRUMTransformData {
  readonly appDetection: DTRumAppDetection;
  readonly eventMappings: DTRumEventMapping[];
  readonly coreWebVitals: DTCoreWebVitalsNote;
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// NR → DT field-name mapping for browser events
// ---------------------------------------------------------------------------

const NR_BROWSER_EVENT_MAP: Record<string, string> = {
  PageView: 'rum.page_view',
  PageAction: 'rum.page_action',
  BrowserInteraction: 'rum.user_action',
  AjaxRequest: 'rum.ajax_request',
  JavaScriptError: 'rum.js_error',
};

const MANUAL_STEPS: string[] = [
  'Deploy the Dynatrace RUM JavaScript agent (auto-inject via OneAgent or paste the snippet) — the NR browser agent snippet does not transfer.',
  'Re-provision the RUM application ID and CSP allowlist in Dynatrace; NR license/browser keys are not transferable.',
  'If Session Replay was enabled in NR, activate DT Session Replay separately (licensing/feature flag).',
  'SPA-specific routing hooks must be re-registered against the Dynatrace RUM agent.',
  'Crash/error source-map uploads require re-configuration against DT symbolication endpoints.',
];

// ---------------------------------------------------------------------------
// BrowserRUMTransformer
// ---------------------------------------------------------------------------

export class BrowserRUMTransformer {
  transform(input: NRBrowserAppInput): TransformResult<BrowserRUMTransformData> {
    try {
      const appName = input.name ?? 'Unnamed Browser App';
      const domain = input.domain ?? '';
      const spa = input.spa ?? false;
      const warnings: string[] = [];

      if (!domain) {
        warnings.push(
          `Browser app '${appName}' has no domain configured; detection rule falls back to URL_PATH match on '/'. Set a domain explicitly for accurate routing.`,
        );
      }

      const appDetection: DTRumAppDetection = {
        schemaId: 'builtin:rum.web.app-detection',
        displayName: `[Migrated] ${appName}`,
        applicationName: appName,
        enabled: true,
        rule: domain
          ? { type: 'DOMAIN', value: domain }
          : { type: 'URL_PATH', value: '/' },
        spa,
        allowedDomains: [...(input.allowedDomains ?? [])],
        deniedDomains: [...(input.deniedDomains ?? [])],
      };

      const eventMappings: DTRumEventMapping[] = [];
      for (const [nrEventType, dtEventName] of Object.entries(NR_BROWSER_EVENT_MAP)) {
        eventMappings.push({
          schemaId: 'builtin:openpipeline.bizevents.pipelines',
          displayName: `[Migrated] ${nrEventType} → ${dtEventName}`,
          matcher: `matchesValue(event.type, "${nrEventType}")`,
          fieldsAdd: [{ field: 'rum.event_name', value: dtEventName }],
        });
      }

      for (const custom of input.customEvents ?? []) {
        eventMappings.push({
          schemaId: 'builtin:openpipeline.bizevents.pipelines',
          displayName: `[Migrated] custom browser event ${custom}`,
          matcher: `matchesValue(event.type, "${custom}")`,
          fieldsAdd: [{ field: 'rum.event_name', value: `rum.custom.${custom}` }],
        });
      }

      const coreWebVitals: DTCoreWebVitalsNote = {
        metrics: ['LCP', 'FID', 'CLS', 'INP', 'TTFB', 'FCP'],
        note: 'Dynatrace RUM captures Core Web Vitals automatically once the RUM agent is injected. No per-metric migration step is required — existing NR Core Web Vitals dashboards should be recreated against DT `rum.page_view` bizevents (see compiler event-type map).',
      };

      return success(
        {
          appDetection,
          eventMappings,
          coreWebVitals,
          manualSteps: MANUAL_STEPS,
        },
        [...warnings, ...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(apps: NRBrowserAppInput[]): TransformResult<BrowserRUMTransformData>[] {
    return apps.map((a) => this.transform(a));
  }
}
