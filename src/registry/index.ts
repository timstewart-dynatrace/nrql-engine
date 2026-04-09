/**
 * Registry module — live Dynatrace environment validation.
 *
 * Provides DTEnvironmentRegistry for metrics, entities, dashboards,
 * management zones, and synthetic locations, plus SLOAuditor for
 * Gen3 Platform SLO validation and auto-fix.
 */

export { DTEnvironmentRegistry, SYNONYMS } from './environment.js';
export {
  SLOAuditor,
  INVALID_TIMESERIES_AGGS,
  VALID_TIMESERIES_AGGS,
  METRIC_SYNONYMS,
} from './slo-auditor.js';
export type { SloAuditDetail, SloAuditResults } from './slo-auditor.js';
