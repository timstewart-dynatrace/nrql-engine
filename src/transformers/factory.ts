/**
 * Uniform transformer factory. Routes to the Gen3 default class or its
 * `Legacy*` sibling based on a single `{ legacy }` flag — so consumers
 * can wire one setting (CLI arg, env var, Dynatrace-app toggle) through
 * the engine without conditionally instantiating each transformer.
 *
 * Back-port rationale: the Python `Dynatrace-NewRelic` CLI exposes a
 * `MIGRATION_LEGACY_MODE` boolean that selects v1 vs v2 modules at
 * import time. This factory is the TS equivalent — it picks between
 * `XTransformer` and `LegacyXTransformer` for the four transformer
 * kinds that have both shapes.
 *
 * For Gen3-only transformers (no Legacy sibling exists), the factory
 * returns the Gen3 class regardless of the flag so call-sites can use
 * `createTransformer` uniformly.
 */

import { AlertTransformer, LegacyAlertTransformer } from './alert.transformer.js';
import {
  NotificationTransformer,
  LegacyNotificationTransformer,
} from './notification.transformer.js';
import { TagTransformer, LegacyTagTransformer } from './tag.transformer.js';
import {
  WorkloadTransformer,
  LegacyWorkloadTransformer,
} from './workload.transformer.js';

import { DashboardTransformer } from './dashboard.transformer.js';
import { LegacyDashboardTransformer } from './legacy-dashboard.transformer.js';
import { SLOTransformer } from './slo.transformer.js';
import { LegacySLOTransformer } from './legacy-slo.transformer.js';
import { SyntheticTransformer } from './synthetic.transformer.js';
import { LegacySyntheticTransformer } from './legacy-synthetic.transformer.js';

import { DropRuleTransformer } from './drop-rule.transformer.js';
import { InfrastructureTransformer } from './infrastructure.transformer.js';
import { LogParsingTransformer } from './log-parsing.transformer.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type TransformerKind =
  | 'alert'
  | 'notification'
  | 'tag'
  | 'workload'
  | 'dashboard'
  | 'slo'
  | 'synthetic'
  // Gen3-only kinds (no Legacy sibling — Gen3-native from the start)
  | 'drop-rule'
  | 'infrastructure'
  | 'log-parsing';

export interface CreateTransformerOptions {
  /** When true, return the `Legacy*` variant (classic Gen2 shapes). */
  readonly legacy?: boolean;
}

/**
 * Mapping from `kind` + `legacy` flag to the instantiated class. The
 * return type is `unknown` because each kind has a different TS
 * signature; callers should narrow via the matching import once they
 * know which kind they requested. A typed overload set sits below.
 */
export function createTransformer(
  kind: TransformerKind,
  options?: CreateTransformerOptions,
): unknown {
  const legacy = options?.legacy === true;
  switch (kind) {
    case 'alert':
      return legacy ? new LegacyAlertTransformer() : new AlertTransformer();
    case 'notification':
      return legacy
        ? new LegacyNotificationTransformer()
        : new NotificationTransformer();
    case 'tag':
      return legacy ? new LegacyTagTransformer() : new TagTransformer();
    case 'workload':
      return legacy ? new LegacyWorkloadTransformer() : new WorkloadTransformer();
    case 'dashboard':
      return legacy
        ? new LegacyDashboardTransformer()
        : new DashboardTransformer();
    case 'slo':
      return legacy ? new LegacySLOTransformer() : new SLOTransformer();
    case 'synthetic':
      return legacy
        ? new LegacySyntheticTransformer()
        : new SyntheticTransformer();
    // Gen3-only kinds ignore the legacy flag.
    case 'drop-rule':
      return new DropRuleTransformer();
    case 'infrastructure':
      return new InfrastructureTransformer();
    case 'log-parsing':
      return new LogParsingTransformer();
    default:
      throw new Error(`Unknown transformer kind '${kind as string}'`);
  }
}

/** Kinds that carry a Legacy (Gen2) sibling. */
export const LEGACY_SUPPORTED_KINDS: ReadonlySet<TransformerKind> = new Set([
  'alert',
  'notification',
  'tag',
  'workload',
  'dashboard',
  'slo',
  'synthetic',
]);

export function hasLegacyVariant(kind: TransformerKind): boolean {
  return LEGACY_SUPPORTED_KINDS.has(kind);
}
