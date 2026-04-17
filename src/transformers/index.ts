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
  NRNotificationRouting,
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
  NRServiceLevelV3Input,
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

// OpenTelemetry collector transformer (Gen3)
export { OpenTelemetryCollectorTransformer } from './otel-collector.transformer.js';
export type {
  NROtelSignal,
  NROtelCollectorInput,
  NROtelProcessor,
  OtelCollectorTransformData,
  DTOtlpExporter,
  DTOtelIngestMapping,
  DTOtelProcessorStep,
} from './otel-collector.transformer.js';

// Prometheus transformer (Gen3)
export { PrometheusTransformer } from './prometheus.transformer.js';
export type {
  NRPrometheusIntegrationInput,
  PrometheusRelabelConfig,
  PrometheusRelabelAction,
  PrometheusTransformData,
  DTPrometheusRemoteWrite,
  DTPrometheusScrapeConfig,
  DTOpenPipelineMetricRule,
} from './prometheus.transformer.js';

// StatsD transformer (Gen3)
export { StatsDTransformer } from './statsd.transformer.js';
export type {
  NRStatsdInput,
  StatsdTransformData,
  DTStatsdIngest,
} from './statsd.transformer.js';

// Non-NRQL alert condition transformer (Gen3)
export { NonNrqlAlertConditionTransformer } from './non-nrql-alert.transformer.js';
export type {
  NRNonNrqlConditionType,
  NRNonNrqlConditionInput,
  NonNrqlAlertTransformData,
} from './non-nrql-alert.transformer.js';

// Baseline / outlier alert transformer (Gen3)
export { BaselineAlertTransformer } from './baseline-alert.transformer.js';
export type {
  NRBaselineDirection,
  NRBaselineSensitivity,
  NRBaselineKind,
  NRBaselineConditionInput,
  BaselineAlertTransformData,
  DTDavisAnomalyDetector,
  DTAnomalyDirection,
  DTAnomalySensitivity,
} from './baseline-alert.transformer.js';

// Maintenance window transformer (Gen3)
export { MaintenanceWindowTransformer, parseRrule } from './maintenance-window.transformer.js';
export type {
  NRMaintenanceKind,
  NRMaintenanceRecurrence,
  NRDayOfWeek,
  NRMaintenanceWindowInput,
  MaintenanceWindowTransformData,
  DTMaintenanceWindow,
  DTSuppressionMode,
} from './maintenance-window.transformer.js';

// Identity transformer (Gen3)
export { IdentityTransformer, translateScimFilter } from './identity.transformer.js';
export type {
  NRIdentityInput,
  NRUser,
  NRTeam,
  NRRole,
  NRSamlConfig,
  IdentityTransformData,
  DTUserStub,
  DTTeam,
  DTIamPolicyV2,
  DTSamlIdpConfig,
  ScimFilterResult,
} from './identity.transformer.js';

// Change tracking transformer (Gen3)
export { ChangeTrackingTransformer } from './change-tracking.transformer.js';
export type {
  NRChangeCategory,
  NRChangeEventInput,
  ChangeTrackingTransformData,
  DTEventType,
  DTCustomEventPayload,
} from './change-tracking.transformer.js';

// AIOps transformer (Gen3)
export { AIOpsTransformer } from './aiops.transformer.js';
export type {
  NRAIOpsWorkflowInput,
  NRAIOpsWorkflowV2Input,
  NRWorkflowV2Predicate,
  NRWorkflowV2MutingHandling,
  NRWorkflowV2NotificationTrigger,
  AIOpsTransformData,
  DTAiopsWorkflow,
  DTWorkflowEnrichment,
} from './aiops.transformer.js';

// Log obfuscation transformer (Gen3)
export { LogObfuscationTransformer, pcreToDpl } from './log-obfuscation.transformer.js';
export type {
  NRObfuscationCategory,
  NRObfuscationRule,
  LogObfuscationTransformData,
  DTOpenPipelineMaskingStage,
  DTOpenPipelineMaskingRule,
  PcreToDplResult,
} from './log-obfuscation.transformer.js';

// Lookup table transformer (Gen3)
export { LookupTableTransformer } from './lookup-table.transformer.js';
export type {
  NRLookupTableInput,
  LookupTableTransformData,
  DTLookupUploadManifest,
} from './lookup-table.transformer.js';

// Phase 14 Gen2-only fallbacks (no Gen3 equivalent)
export { LegacyErrorInboxTransformer } from './legacy-error-inbox.transformer.js';
export type {
  NRErrorStatus,
  NRErrorComment,
  NRErrorInboxRecord,
  LegacyProblemAction,
  LegacyErrorInboxTransformData,
} from './legacy-error-inbox.transformer.js';

export { LegacyNonNrqlAlertConditionTransformer } from './legacy-non-nrql-alert.transformer.js';
export type {
  LegacyAlertingProfileStub,
  LegacyClassicMetricEvent,
  LegacyNonNrqlAlertTransformData,
} from './legacy-non-nrql-alert.transformer.js';

export { LegacyRequestNamingTransformer } from './legacy-request-naming.transformer.js';
export type {
  NRSetTransactionNameSite,
  NRRequestNamingInput,
  LegacyDTRequestNamingRule,
  LegacyRequestNamingTransformData,
} from './legacy-request-naming.transformer.js';

export { LegacyCloudIntegrationTransformer } from './legacy-cloud-integration.transformer.js';
export type {
  LegacyAwsCredentialsConfig,
  LegacyAzureCredentialsConfig,
  LegacyGcpCredentialsConfig,
  LegacyCloudIntegrationPayload,
  LegacyCloudIntegrationTransformData,
} from './legacy-cloud-integration.transformer.js';

export { LegacyApdexTransformer } from './legacy-apdex.transformer.js';
export type {
  NRApdexOverride,
  NRApdexInput,
  LegacyApdexCalculationSetting,
  LegacyApdexTransformData,
} from './legacy-apdex.transformer.js';

// Legacy (Gen2) dashboard / slo / synthetic — opt-in via factory
export { LegacyDashboardTransformer } from './legacy-dashboard.transformer.js';
export type {
  LegacyDTDashboard,
  LegacyDTTile,
} from './legacy-dashboard.transformer.js';
export { LegacySLOTransformer } from './legacy-slo.transformer.js';
export type { LegacyDTSloV1 } from './legacy-slo.transformer.js';
export { LegacySyntheticTransformer } from './legacy-synthetic.transformer.js';
export type {
  LegacyDTSyntheticMonitor,
} from './legacy-synthetic.transformer.js';

// Uniform transformer factory (Gen3 default + legacy opt-in)
export {
  createTransformer,
  hasLegacyVariant,
  LEGACY_SUPPORTED_KINDS,
} from './factory.js';
export type {
  TransformerKind,
  CreateTransformerOptions,
} from './factory.js';

// Monaco YAML helper + OTel env helper (pure data)
export { toMonacoYaml } from './monaco-yaml.js';
export type {
  DtSettingsEnvelope,
  MonacoYamlOptions,
} from './monaco-yaml.js';
export { getOtelEnvForDt, formatOtelEnvAsDotenv } from './otel-env-helper.js';
export type { OtelEnvOptions, OtelTransportProtocol } from './otel-env-helper.js';

// Database Monitoring transformer (Gen3)
export { DatabaseMonitoringTransformer } from './database-monitoring.transformer.js';
export type {
  NRDbEngine,
  NRDatabaseMonitorInput,
  DatabaseMonitoringTransformData,
  DTDbExtensionConfig,
} from './database-monitoring.transformer.js';

// Security Signals transformer (Gen3)
export { SecuritySignalsTransformer } from './security-signals.transformer.js';
export type {
  NRSecuritySignalSeverity,
  NRSecuritySignalRule,
  NRSecuritySignalsInput,
  SecuritySignalsTransformData,
  DTSecurityBizeventRule,
} from './security-signals.transformer.js';

// On-host integration transformer (Gen3)
export { OnHostIntegrationTransformer } from './on-host-integration.transformer.js';
export type {
  NROnHostIntegrationKind,
  NROnHostIntegrationInput,
  OnHostIntegrationTransformData,
  DTOnHostExtensionConfig,
} from './on-host-integration.transformer.js';

// Log Live Archive + Streaming Export transformer (Gen3)
export { LogArchiveTransformer } from './log-archive.transformer.js';
export type {
  NRArchiveStorageTier,
  NRLogArchiveConfig,
  NRStreamingExportTarget,
  NRStreamingExportConfig,
  NRLogArchiveInput,
  LogArchiveTransformData,
  DTGrailBucket,
  DTComplianceTag,
  DTOpenPipelineEgress,
} from './log-archive.transformer.js';

// Metric Normalization transformer (Gen3)
export { MetricNormalizationTransformer } from './metric-normalization.transformer.js';
export type {
  NRNormalizationAction,
  NRMetricNormalizationRule,
  NRMetricNormalizationInput,
  MetricNormalizationTransformData,
  DTMetricProcessor,
  DTMetricProcessorOp,
} from './metric-normalization.transformer.js';

// Dashboard widget upgrade transformer (Gen3)
export { DashboardWidgetUpgradeTransformer } from './dashboard-widget-upgrade.transformer.js';
export type {
  NRHeatmapWidgetInput,
  NREventFeedWidgetInput,
  NRFunnelWidgetInput,
  DTHoneycombTile,
  DTTableTile,
  DTMarkdownTile,
  DTMarkdownFunnelResult,
} from './dashboard-widget-upgrade.transformer.js';

// Multi-location synthetic condition transformer (Gen3)
export { MultiLocationSyntheticTransformer } from './multi-location-synthetic.transformer.js';
export type {
  NRMultiLocationSyntheticInput,
  MultiLocationSyntheticTransformData,
  DTMultiLocationMetricEvent,
} from './multi-location-synthetic.transformer.js';

// Saved filter / Data App → Notebook transformer (Gen3)
export { SavedFilterNotebookTransformer } from './saved-filter-notebook.transformer.js';
export type {
  NRSavedFilter,
  NRDataAppWidget,
  NRSavedFilterSetInput,
  SavedFilterNotebookTransformData,
  DTNotebookCell,
  DTNotebookPayload,
} from './saved-filter-notebook.transformer.js';

// Davis anomaly-detection tuning transformer (Gen3)
export { DavisTuningTransformer } from './davis-tuning.transformer.js';
export type {
  NRDavisSignal,
  NRDavisSensitivity,
  NRDavisTuningRule,
  NRDavisTuningInput,
  DavisTuningTransformData,
  DTDavisAnomalySetting,
} from './davis-tuning.transformer.js';

// Vulnerability Management transformer (Gen3)
export { VulnerabilityManagementTransformer } from './vulnerability.transformer.js';
export type {
  NRVulnSeverity,
  NRVulnMuteRule,
  NRVulnLicensePolicy,
  NRVulnManagementInput,
  VulnerabilityTransformData,
  DTRvaSettings,
  DTRvaMutingRule,
} from './vulnerability.transformer.js';

// Network Performance Monitoring transformer (Gen3)
export { NpmTransformer } from './npm.transformer.js';
export type {
  NRSnmpVersion,
  NRNpmSnmpDevice,
  NRNpmNetFlowCollector,
  NRNpmInput,
  NpmTransformData,
  DTSnmpExtensionConfig,
  DTNetflowIngestConfig,
} from './npm.transformer.js';

// AI Monitoring / MLM transformer (Gen3)
export { AiMonitoringTransformer } from './ai-monitoring.transformer.js';
export type {
  NRAiModelVendor,
  NRAiModelEntry,
  NRAiAttributeMapping,
  NRAiMonitoringInput,
  AiMonitoringTransformData,
  DTAiModelRegistryEntry,
  DTAiBizeventIngestRule,
} from './ai-monitoring.transformer.js';

// Custom instrumentation translator (Gen3)
export { CustomInstrumentationTransformer } from './custom-instrumentation.transformer.js';
export type {
  NRInstrumentationLanguage,
  NRInstrumentationInput,
  NRApiCategory,
  ReplacementConfidence,
  TranslationSuggestion,
  CustomInstrumentationTransformData,
} from './custom-instrumentation.transformer.js';

// Specialized synthetic monitors (cert check + broken links)
export {
  SyntheticCertificateCheckTransformer,
  SyntheticBrokenLinksTransformer,
} from './synthetic-specialized.transformer.js';
export type {
  NRCertCheckMonitorInput,
  NRBrokenLinksMonitorInput,
  CertCheckTransformData,
  BrokenLinksTransformData,
  DTHttpMonitorWithCertValidation,
  DTBrokenLinksPackage,
} from './synthetic-specialized.transformer.js';

// OTel Metrics (direct OTLP) transformer (Gen3)
export { OpenTelemetryMetricsTransformer } from './otel-metrics.transformer.js';
export type {
  NROtelMetricsInput,
  NROtelMetricTemporality,
  NROtelHistogramLayout,
  OtelMetricsTransformData,
  DTOtelMetricsExporter,
  DTOtelMetricsIngestSettings,
} from './otel-metrics.transformer.js';

// Key Transaction transformer (Gen3)
export { KeyTransactionTransformer } from './key-transaction.transformer.js';
export type {
  NRKeyTransactionInput,
  KeyTransactionTransformData,
  DTCriticalServiceTag,
  DTKeyTxSlo,
} from './key-transaction.transformer.js';

// Custom Entity transformer (Gen3)
export { CustomEntityTransformer } from './custom-entity.transformer.js';
export type {
  NRCustomEntityInput,
  CustomEntityTransformData,
  DTCustomDevicePayload,
} from './custom-entity.transformer.js';

// CloudWatch Metric Streams transformer (Gen3)
export { CloudWatchMetricStreamsTransformer } from './cloudwatch-metric-streams.transformer.js';
export type {
  NRCloudWatchMetricStreamInput,
  CloudWatchMetricStreamsTransformData,
  DTAwsMetricStreamsConfig,
  DTFirehoseDeliveryStreamSpec,
  DTFirehoseIamTrust,
} from './cloudwatch-metric-streams.transformer.js';

// Cloud integration transformer (Gen3)
export { CloudIntegrationTransformer } from './cloud-integration.transformer.js';
export type {
  NRCloudProvider,
  NRCloudIntegrationInput,
  NRCloudServiceConfig,
  NRAwsIngestMode,
  CloudIntegrationTransformData,
  DTCloudIntegration,
  DTCloudService,
  DTCloudIntegrationAwsScope,
  DTCloudIntegrationAzureScope,
  DTCloudIntegrationGcpScope,
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
  NRKubernetesMode,
  NRKubernetesResources,
  NRKubernetesResourceLimits,
  NRKubernetesToleration,
  NRActiveGateCapability,
  KubernetesTransformData,
  DTDynaKubeManifest,
  DTDynaKubeOneAgentSpec,
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

// Drop rule transformer (v1 + v2)
export { DropRuleTransformer } from './drop-rule.transformer.js';
export type {
  NRDropRuleInput,
  NRDropRuleV2Input,
  NRDropPipeline,
  NRDropV2Action,
  DTIngestRule,
  DTOpenPipelineDropProcessor,
} from './drop-rule.transformer.js';
