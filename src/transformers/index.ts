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

// Alert transformer (Gen3 default + Gen2 legacy opt-in)
export { AlertTransformer, LegacyAlertTransformer } from './alert.transformer.js';
export type {
  NRAlertPolicyInput,
  NRAlertCondition,
  NRAlertTerm,
  AlertTransformData,
  LegacyAlertTransformData,
  DTWorkflow,
  DTWorkflowTaskRef,
  DTMetricEvent,
} from './alert.transformer.js';

// Notification transformer (Gen3 default + Gen2 legacy opt-in)
export {
  NotificationTransformer,
  LegacyNotificationTransformer,
} from './notification.transformer.js';
export type {
  NRNotificationChannelInput,
  DTWorkflowTask,
  LegacyNotificationTransformData,
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

// Workload transformer (Gen3 default + Gen2 legacy opt-in)
export { WorkloadTransformer, LegacyWorkloadTransformer } from './workload.transformer.js';
export type {
  NRWorkloadInput,
  NRWorkloadEntity,
  DTSegment,
  DTSegmentInclude,
  DTSegmentFilterNode,
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

// Tag transformer (Gen3 default + Gen2 legacy opt-in)
export { TagTransformer, LegacyTagTransformer } from './tag.transformer.js';
export type {
  NRTagEntityInput,
  NRTag,
  DTOpenPipelineEnrichmentRule,
  DTAutoTagRule,
} from './tag.transformer.js';

// Cloud integration transformer (Gen3)
export { CloudIntegrationTransformer } from './cloud-integration.transformer.js';
export type {
  NRCloudProvider,
  NRCloudIntegrationInput,
  CloudIntegrationTransformData,
  DTCloudIntegration,
  DTCloudService,
} from './cloud-integration.transformer.js';

// Lambda transformer (Gen3)
export { LambdaTransformer } from './lambda.transformer.js';
export type {
  NRLambdaRuntime,
  NRLambdaFunctionInput,
  LambdaTransformData,
  DTServerlessFunctionDetection,
} from './lambda.transformer.js';

// Kubernetes transformer (Gen3)
export { KubernetesTransformer } from './kubernetes.transformer.js';
export type {
  NRKubernetesClusterInput,
  KubernetesTransformData,
  DTDynaKubeManifest,
} from './kubernetes.transformer.js';

// Custom event transformer (Gen3)
export { CustomEventTransformer } from './custom-event.transformer.js';
export type {
  NRCustomEventTypeInput,
  NRCustomEventAttribute,
  CustomEventTransformData,
  DTBizeventIngestRule,
  DTBizeventProcessingRule,
} from './custom-event.transformer.js';

// Mobile RUM transformer (Gen3)
export { MobileRUMTransformer } from './mobile-rum.transformer.js';
export type {
  NRMobileAppInput,
  NRMobilePlatform,
  MobileRUMTransformData,
  DTMobileAppDetection,
  DTMobileEventMapping,
} from './mobile-rum.transformer.js';

// Browser RUM transformer (Gen3)
export { BrowserRUMTransformer } from './browser-rum.transformer.js';
export type {
  NRBrowserAppInput,
  BrowserRUMTransformData,
  DTRumAppDetection,
  DTRumEventMapping,
  DTCoreWebVitalsNote,
} from './browser-rum.transformer.js';

// Drop rule transformer
export { DropRuleTransformer } from './drop-rule.transformer.js';
export type {
  NRDropRuleInput,
  DTIngestRule,
} from './drop-rule.transformer.js';
