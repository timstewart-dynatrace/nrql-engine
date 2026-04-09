/**
 * Transformers barrel export.
 *
 * Re-exports all entity transformers, their input/output types,
 * the shared TransformResult type, and mapping rules.
 */

// Shared types
export type { TransformResult, Transformer } from './types.js';
export { success, failure } from './types.js';

// Mapping rules and constants
export {
  VISUALIZATION_TYPE_MAP,
  CHART_TYPE_MAP,
  ALERT_PRIORITY_MAP,
  OPERATOR_MAP,
  THRESHOLD_OCCURRENCES_MAP,
  SYNTHETIC_MONITOR_TYPE_MAP,
  MONITOR_PERIOD_MAP,
  NOTIFICATION_TYPE_MAP,
  AGGREGATION_MAP,
  FILL_OPTION_MAP,
  SLO_TIME_UNIT_MAP,
  INFRA_METRIC_MAP,
  INFRA_OPERATOR_MAP,
  ENTITY_MAPPINGS,
  EntityMapper,
} from './mapping-rules.js';
export type { TransformationType, FieldMapping, EntityMapping } from './mapping-rules.js';

// Dashboard transformer
export { DashboardTransformer } from './dashboard.transformer.js';
export type {
  NRDashboardInput,
  NRDashboardPage,
  NRWidget,
  NRWidgetLayout,
  NRDashboardVariable,
  DTDashboard,
  DTTile,
  DashboardTransformData,
} from './dashboard.transformer.js';

// Alert transformer
export { AlertTransformer } from './alert.transformer.js';
export type {
  NRAlertPolicyInput,
  NRAlertCondition,
  NRAlertTerm,
  AlertTransformData,
} from './alert.transformer.js';

// Notification transformer
export { NotificationTransformer } from './notification.transformer.js';
export type {
  NRNotificationChannelInput,
  NotificationTransformData,
} from './notification.transformer.js';

// Synthetic transformer
export { SyntheticTransformer, SyntheticScriptConverter } from './synthetic.transformer.js';
export type {
  NRSyntheticMonitorInput,
  SyntheticTransformData,
  ScriptAnalysis,
} from './synthetic.transformer.js';

// SLO transformer
export { SLOTransformer } from './slo.transformer.js';
export type {
  NRSloInput,
  NRSloObjective,
  NRSloEvents,
  DTSlo,
} from './slo.transformer.js';

// Workload transformer
export { WorkloadTransformer } from './workload.transformer.js';
export type {
  NRWorkloadInput,
  NRWorkloadEntity,
  DTManagementZone,
  DTManagementZoneRule,
} from './workload.transformer.js';

// Infrastructure transformer
export { InfrastructureTransformer } from './infrastructure.transformer.js';
export type {
  NRInfraConditionInput,
  DTInfraMetricEvent,
} from './infrastructure.transformer.js';

// Log parsing transformer
export { LogParsingTransformer } from './log-parsing.transformer.js';
export type {
  NRLogParsingRuleInput,
  DTLogProcessingRule,
} from './log-parsing.transformer.js';

// Tag transformer
export { TagTransformer } from './tag.transformer.js';
export type {
  NRTagEntityInput,
  NRTag,
  DTAutoTagRule,
} from './tag.transformer.js';

// Drop rule transformer
export { DropRuleTransformer } from './drop-rule.transformer.js';
export type {
  NRDropRuleInput,
  DTIngestRule,
} from './drop-rule.transformer.js';
