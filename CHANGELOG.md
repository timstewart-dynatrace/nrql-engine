# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Accumulating toward **v2.0.0**. The branch now carries every Phase 01–16 deliverable: 46 Gen3 transformers, 12 Legacy opt-in / Gen2-only classes, Phase 19 compiler uplift, preflight probes, PCRE→DPL + rrule + SCIM filter + Monaco YAML + OTel env helpers, Phase 15 safety + observability cluster (coded warnings, drift audit, orphan diff, HTTP retry, provenance stamping, conversion reports), and Phase 16 parity completion (canary rollout, NRDB archive helper, 232-entry extended metric map, OAuth2 platform-token provider + split DT client stack). Test count 838 → 1562 (+724). The release contains BREAKING default-output changes for four transformers (`AlertTransformer`, `NotificationTransformer`, `TagTransformer`, `WorkloadTransformer`) — callers needing the previous Gen2 shapes must switch to the paired `Legacy*` classes or call `createTransformer(kind, { legacy: true })`.

### Added (validation harness)

- **`tests/validation/compile-through.test.ts`** — end-to-end NRQL→DQL compile coverage over the curated corpus.
- **`tests/validation/compiler-dql-validity.test.ts`** — asserts every emitted DQL string parses through the DQL syntax validator.
- **`tests/validation/factory-contract.test.ts`** — enforces the `createTransformer` factory contract across all 46 Gen3 + 12 Legacy kinds.

Tests: 1434 → 1562 (+128 across 3 new test files). Typecheck clean.

### Changed (documentation)

- Doc drift pass: README, `.claude/CLAUDE.md`, and `docs/COVERAGE.md` updated to reflect the current 1562 / 78 suite.
- `.claude/CLAUDE.md` skill references extended to include `svg-graphics` and `dynatrace-workflow`.
- Phase file `Status:` fields aligned to their `-done` filenames.
- Removed empty `tests/cli/` and `tests/exporters/` directories (the engine is a library — CLI / exporters live in consuming projects).

### Added (Phase 16 — Python parity completion + OAuth2 / split DT client)

Closes the remaining Python parity backlog. P15-06 ships the OAuth2 flow and split-client refactor intentionally — v2.0.0 is authorised to be all-encompassing.

- **P15-04 `CanaryPlan`** — two-wave rollout helper with `split(bucket)` → `{ canary, rest }` partition (configurable `canaryPercent` / `minCanarySize` / `maxCanarySize`) and `rollout(bucket, runWave, approvalGate)` orchestration. Built-in `autoApproveGate` + `autoRejectGate` conveniences for tests / unattended runs.
- **P15-08 `FailedEntities.filterTransformedData`** — confirmed already shipped and tested in `src/migration/retry.ts`; no new code needed.
- **P15-11 `runNrdbArchive` pure-data helper** — `src/tools/nrdb-archive.ts`. Cursor-resumable batch driver where the caller injects `runQuery` / `persistBatch` / `persistCursor` / `readCursor` so the library stays I/O-free. Supports `maxBatches`, `maxRecords`, `AbortSignal`, `onBatch` progress callback. Returns manifest + final status (`EXHAUSTED` / `MAX_BATCHES` / `MAX_RECORDS` / `ABORTED`).
- **P15-10 Extended NR→DT metric map** — `src/compiler/extended-metric-map.ts`. 232-entry `EXTENDED_METRIC_MAP` back-ported verbatim from the Python CLI's `nrql_mapping_rules.py::METRIC_MAP`. Spans APM service / host / K8s / AWS / Azure / GCP / mobile / browser / synthetic / database / queue / container surfaces. Merged into `NRQLCompiler.metricMap` at construction time (order: EXTENDED < DEFAULT < caller overrides).
- **P15-06 OAuth2 + split DT client stack** (BREAKING — authorized for v2.0.0):
  - `HttpTransport` (`src/clients/http-transport.ts`) — shared transport with auth-header injection (via pluggable `AuthHeaderProvider`), rate limiting, automatic 429/5xx retry via `withRetry`, JSON envelope parsing, error-message extraction.
  - `OAuth2PlatformTokenProvider` (`src/clients/oauth2-platform-token.ts`) — client-credentials flow with 60 s refresh margin, in-flight-promise mutex for concurrent callers, `invalidate()` for forced refresh. Exposed as an `AuthHeaderProvider` via `oauthAuthProvider(provider)`. `apiTokenAuthProvider(token)` convenience for the classic DT header.
  - `SettingsV2Client` / `DocumentClient` / `AutomationClient` (`src/clients/split-clients.ts`) — focused wrappers with `preferOauth` routing: Settings v2 defaults to Api-Token; Document + Automation default to OAuth2. Document client uses `pageKey` (not `nextPageKey`) and rewrites `.live.` → `.apps.` for platform URLs.

Tests: 1385 → 1434 (+49 across 7 new test files). Typecheck clean.

### Added (Phase 15 — safety + observability parity with Python CLI)

Absorbs the "safety / observability" cluster identified in the second Python parity survey. 6 items in dependency order, all back-compatible (no existing API surface changed).

- **P15-01 `WarningCode` / `ErrorCode` taxonomy** — stable string-backed enums in `src/utils/warning-codes.ts` with 34 warning codes (confidence / schema / capability / auth / HTTP / build / manual / input / informational groups) + 9 error codes + `CodedWarning` / `CodedError` interfaces + `warningsByCode()` triage bucket + `WARNING_LABELS` map for human-readable rendering. Existing `warnings: string[]` surface untouched.
- **P15-12 `migrated.from=newrelic` provenance stamping** — `src/utils/provenance.ts` exports `PROVENANCE_MARKER`, `withProvenance()`, `stampDescription()`, and `looksMigrated()` heuristic. `MaintenanceWindowTransformer` updated so user-supplied names always carry the `[Migrated]` prefix. `looksMigrated()` recognizes 6 shapes: `[Migrated...]` name prefix, `properties.migrated.from=newrelic`, `eventTemplate.properties.migrated.from=newrelic`, `entityTags['nr-migrated']`, tags array containing `nr-migrated`, and description phrase "migrated from NR" — verified against 10 real transformer outputs.
- **P15-02 `runAudit()` drift detector** — `src/migration/audit.ts` compares transformed outputs against a DT-tenant snapshot and classifies drift into four kinds: `RENAMED` (name differs, payload matches), `DELETED` (in transformed, missing from DT), `MODIFIED` (both sides present, normalized payload differs), `EXTRA` (in DT, not in transformed, but `looksMigrated()` returns true). Normalization strips server-populated fields (`modificationInfo` / `version` / `objectId` / `metadata` / `createdAt` / `lastModified` / …). `driftByKind()` convenience bucketed view.
- **P15-03 Diff `ORPHAN` detection** — `DiffEntry.action` extended with `'ORPHAN'`. `DiffRegistry` gains optional `listDashboards()` / `listManagementZones()` callbacks; when supplied, `generateDiff()` walks the DT inventory and flags migrated-looking entities that weren't in the transformed set. `DiffReport.getOrphans()` + `summary().orphans` accessors. Back-compat: registries without the optional methods produce no orphans.
- **P15-07 HTTP retry adapter** — `src/utils/http-retry.ts` exports `withRetry()` with default `status_forcelist=[429,500,502,503,504]`, 3 retries, exponential backoff with jitter, `Retry-After` header support (seconds or HTTP date), and `AbortSignal` cancellation. Throws `RetryExhaustedError` with `lastStatus` + `attempts` on budget exhaustion.
- **P15-05 `ConversionReport` JSON + HTML writer** — `src/migration/conversion-report.ts` emits a stable JSON artifact (suitable for programmatic triage) and a self-contained HTML document (inline CSS, no external assets, XSS-safe escaping) from a list of `ConversionQueryRecord`s. Features: `summary()` with `warningsByCode` bucket + `averageConfidenceScore` + `needsReview` threshold, `needsReview()` filter that flags both low-score and review-required codes.

Tests: 1324 → 1385 (+61 across 6 new test files).
Typecheck: clean.

### Added (Phase 14 — Gen2 fallbacks for D-band items)

Closes `⚫` / D-band rows where classic Dynatrace offers a path even though Gen3 does not. All five ship as `Legacy*` classes routed through the uniform factory.

- **P14-01 `LegacyErrorInboxTransformer`** — NR Errors-Inbox state (status / assignee / comments) → classic DT Problem action list (`POST /api/v2/problems/{id}/comments` + `/close`). Emits `POST_COMMENT`, `POST_COMMENT_UNBOUND` (when problem ids aren't resolved yet), and `ACKNOWLEDGE` action kinds. Status RESOLVED / IGNORED close the problem; WORK_IN_PROGRESS emits a progress comment; assignee lands as an `[...]:assignee` comment. Kind: `error-inbox`.
- **P14-02 `LegacyNonNrqlAlertConditionTransformer`** — non-NRQL conditions (APM / Infra / Synth / Browser / Mobile / ExternalService) → classic `builtin:alerting.profile` + `builtin:anomaly-detection.metric-events` pair without the Gen3 Workflow wrap. Kind: `non-nrql-alert-legacy`.
- **P14-03 `LegacyRequestNamingTransformer`** — `newrelic.setTransactionName(category, name)` call sites → `builtin:request-naming.request-naming-rules` entries with service.name / http.method / http.request.path conditions. Kind: `request-naming`.
- **P14-04 `LegacyCloudIntegrationTransformer`** — NR AWS / Azure / GCP integrations → classic `/api/config/v1/aws/credentials` / `/azure/credentials` / `/gcp/credentials` payloads. Distinct service-name map (AWS_DEFAULT / AZURE / GCP v1 conventions). Kind: `cloud-integration-legacy`.
- **P14-05 `LegacyApdexTransformer`** — NR Apdex T-values → `builtin:apdex.service-apdex-calculation` per-service overrides in ms (tolerated + frustrated). Lifts Apdex from LOW-confidence compiler decomposition to deterministic classic-settings output. Kind: `apdex`.

Factory: 5 new kinds (`error-inbox`, `non-nrql-alert-legacy`, `request-naming`, `cloud-integration-legacy`, `apdex`) added to `TransformerKind`. These are Gen2-only — the `legacy` flag is ignored for them.

Tests: 1295 → 1324 (+29). Typecheck clean.


Entries below are preserved in reverse chronological order (newest phase first) for reviewers. On release they collapse under a single `## [2.0.0] - YYYY-MM-DD` heading.

### Added (Phase 12 — Phase 11 back-port follow-ups)

All four deferred P11 items shipped.

- **P11-07 `createTransformer(kind, { legacy })` factory** — uniform routing between Gen3 defaults and `Legacy*` siblings. Supports 10 `TransformerKind` values; 7 have Legacy variants (alert, notification, tag, workload, dashboard, slo, synthetic); 3 are Gen3-only (drop-rule, infrastructure, log-parsing) and ignore the flag. `hasLegacyVariant()` + `LEGACY_SUPPORTED_KINDS` helpers exported alongside.
- **P11-08 Additional Legacy transformers** — `LegacyDashboardTransformer` (classic `builtin:dashboards` with DATA_EXPLORER / MARKDOWN tiles + multi-page collapse warning), `LegacySLOTransformer` (v1 SLO payload with numerator/denominator), `LegacySyntheticTransformer` (classic `/api/v1/synthetic/monitors` HTTP / BROWSER / HTTP_MULTI_STEP shapes). All three emit a legacy warning on every call.
- **P11-09 `toMonacoYaml()` pure-data helper** — Dynatrace Settings 2.0 envelope (`{ schemaId, displayName?, scope?, value }`) → Monaco configuration-as-code YAML string. Dependency-free YAML serializer. Supports single-envelope or array input, configurable indent, optional leading `---` document separator. Output includes the payload JSON as a comment for paste into the matching template file.
- **P11-10 `getOtelEnvForDt()` + `formatOtelEnvAsDotenv()`** — data helpers returning the set of `OTEL_*` environment variables a service needs to push OTLP telemetry to a DT tenant. Covers endpoint (grpc + http/protobuf), region override, resource attributes (service.name + service.instance.id + deployment.environment + extras), signal toggles, and dotenv-format rendering.

Tests: 1264 → 1295 (+31). Typecheck clean.

### Added (Phase 10 — specialized products + stretch)

Closes the remaining 🔴 rows identified in the Phase 07 audit. Several
items (AI Monitoring, NPM, Vulnerability Management, custom
instrumentation) already shipped in Phase 11 back-ports; the
remaining ten translators landed here.

- **P10-03 DatabaseMonitoringTransformer** — 10 engines (mysql / postgres / mssql / oracle / mongodb / redis / cassandra / mariadb / db2 / hana) with slow-query + wait-event toggles and a `dt.services.database.*` metric-key seed list.
- **P10-05 SecuritySignalsTransformer** — NR security signals → OpenPipeline bizevent rules tagged `event.category=SECURITY` with DT Security Investigator attr conventions.
- **P10-12 OnHostIntegrationTransformer** — 10 NR on-host integrations (nginx / haproxy / kafka / rabbitmq / elasticsearch / memcached / couchbase / consul / apache / etcd) → DT extensions.
- **P10-13/14 LogArchiveTransformer** — NR Log Live Archive → `builtin:bucket.retention` with compliance tags; streaming exports (Kinesis / Event Hub / Pub/Sub / HTTP) → OpenPipeline egress stage entries.
- **P10-15/16 Data Plus tier + bucket retention** — emitted inside `LogArchiveTransformer` via `DTGrailBucket.complianceTags` (hipaa / pci-dss / fedramp-moderate / sox); warns when the target tenant may not have the Data Plus tier.
- **P10-17 MetricNormalizationTransformer** — NR normalization rules → OpenPipeline metric transforms (RENAME / SCALE / CONVERT_UNIT / DERIVE). Built-in bytes↔(KB/MB/GB) + time↔(s/ms/µs) unit conversion tables.
- **P10-18/19/20 DashboardWidgetUpgradeTransformer** — `upgradeHeatmap()` → honeycomb, `upgradeEventFeed()` → table-sort-desc, `upgradeFunnel()` → markdown + companion DQL `summarize` block (DT has no native funnel tile).
- **P10-21 MultiLocationSyntheticTransformer** — NR multi-location condition → DQL `countDistinctExact(location.id)` + Metric Event with threshold-aware eventTemplate.
- **P10-22 SavedFilterNotebookTransformer** — NR saved filters + Data Apps → DT Notebook payloads with markdown + DQL cells per filter.
- **P10-23 DavisTuningTransformer** — NR proactive-detection suppression / Golden-Signal tuning → `builtin:anomaly-detection.davis` settings (7 signals × 4 sensitivities, optional entity-tag scope).

Tests: 1206 → 1264 (+58). Typecheck clean.

### Added (Phase 11 — Dynatrace-NewRelic back-ports)

Six library-appropriate capabilities back-ported from the Python `Dynatrace-NewRelic` CLI (survey 2026-04-15). Three candidates (NRDB archive, agent host-ops orchestrators, Lambda layer ARN already covered) confirmed out-of-scope.

- **P11-01 Phase 19 confidence uplift** — `applyPhase19Uplift()` now runs inside `NRQLCompiler.compile()`. Raises confidence (never lowers) when the emitter successfully carried `apdex(t)` / `COMPARE WITH` / `rate(count,N)` / `percentage(count, WHERE)` rewrites. Audit-trail `phase19:` entries land on `fixes[]`. Exported standalone helper.
- **P11-02 CustomInstrumentationTransformer** — JS/TS/Python/Java pattern matcher emitting `TranslationSuggestion[]` across 6 API categories (custom_event / custom_attribute / custom_metric / error_capture / transaction_naming / segment). Never rewrites files.
- **P11-03 VulnerabilityManagementTransformer** — `builtin:appsec.runtime-vulnerability-analytics` + muting rules + SCA-tool-ready license-policy runbook.
- **P11-04 NpmTransformer** — SNMP extension (v1/v2c/v3, credential-vault refs) + NetFlow v5/v9 / IPFIX / sFlow collectors.
- **P11-05 AiMonitoringTransformer** — `builtin:ai.observability.model-registry` + bizevent ingest rule renaming NR attributes to DT AIO conventions (`ai.tokens.prompt`, `ai.cost.usd`, …).
- **P11-06 `preflightGen3()` + `preflightNewRelic()`** — cheap capability probes on both client classes; return boolean readiness map + `diagnostics` string[].

Tests: 1155 → 1206 (+51). Typecheck clean.

Deferred follow-ups: P11-07 uniform `createTransformer()` factory, P11-08 5 missing Legacy v1 ports, P11-09 `toMonacoYaml()` helper, P11-10 `getOtelEnvForDt()` helper.

### Added (Phase 09 — net-new translators)

All 8 P09-NN work items landed. COVERAGE.md flipped for each.

- **P09-01 KeyTransactionTransformer** — NR Key Transactions → critical-service entity tag + `builtin:monitoring.slo` + davis_problem Workflow (shared nr-migrated + critical-service entityTags bind the triple).
- **P09-07 CustomEntityTransformer** — NR custom entities → DT `/api/v2/entities/custom` payloads with stable `customDeviceId` (NR guid or derived slug with warning), tag/property/ipAddress/listenPorts passthrough.
- **P09-02 SLOTransformer.transformV3** — Service Levels v3 API shape (sli.nrql + badEventsNrql + rolling or calendar-aligned timeWindow + entityGuid filter). v1/v2 paths preserved.
- **P09-03 MaintenanceWindowTransformer `rrule`** — RFC 5545 strings (FREQ=DAILY/WEEKLY/MONTHLY; BYDAY with position prefix stripping; warnings on BYMONTH / BYSETPOS / COUNT / UNTIL / INTERVAL≠1; YEARLY downgraded to MONTHLY). Exported `parseRrule` helper.
- **P09-06 translateScimFilter** — NR SCIM v2 → DT SCIM attribute renaming (userName / emails.value → email; name.givenName / name.familyName → firstName / lastName; active → enabled). Preserves logical operators unchanged. Warns on `meta.*` references.
- **P09-04 AIOps enrichment compile-through** — v1 + v2 AIOps enrichment NRQL now compiles via NRQLCompiler instead of emitting TODO placeholders; task description reports the compiler confidence band.
- **P09-05 OpenTelemetryMetricsTransformer** — direct-OTLP metrics exporter translation (distinct from the collector path). Covers temporality (DELTA/CUMULATIVE), histogram layout (EXPONENTIAL/EXPLICIT_BUCKET), export interval, resource-attribute semconv guidance. Emits `builtin:otel.metrics.ingest` settings.
- **P09-08 Synthetic Certificate Check + Broken Links** — `SyntheticCertificateCheckTransformer` emits HTTP monitor with `certificateValidity` + `certificateExpiration` validation rules. `SyntheticBrokenLinksTransformer` emits a package: Browser Monitor stub (with clickpath TODO) + DQL detection query + Metric Event shape for Workflow wiring.

Tests: 1099 → 1155 (+56). Typecheck clean.

### Added (Phase 08 — depth passes on shipped transformers)

All ten P08-NN work items landed. Every previously ✅* / 🟡 row from the Phase 07 audit flipped to plain ✅.

- **P08-05 Lambda per-region layer ARN** — `resolvedLayerArn` field per function, 27-region commercial-partition allowlist, GovCloud/China warn + omit.
- **P08-02 Prometheus relabel-rule translator** — all 7 Prometheus relabel actions → OpenPipeline metric processors (drop/keep/replace/labeldrop/labelkeep/labelmap; hashmod warned). Multi-label source concat with separator. Structured `relabelConfigs[]` input alongside legacy `relabelRules[]` passthrough.
- **P08-07 Drop Filter Rules v2** — new `transformV2()` method accepts attribute-scoped rules across 4 pipelines; emits OpenPipeline drop / fieldsRemove / fieldsKeep processors.
- **P08-10 Notification Policies v2 routing** — new `routing` input (policyName / entityTags / severityAtLeast) emits a per-task `filter` DPL expression on the DTWorkflowTask.
- **P08-09 CloudWatch Metric Streams** — new `CloudWatchMetricStreamsTransformer` emits `builtin:aws.metric-streams` + Firehose delivery-stream spec + IAM trust statement.
- **P08-08 NR Workflows v2** — `transformV2()` on AIOpsTransformer accepts the new NerdGraph shape (workflowEnabled + destinationsEnabled + mutingRulesHandling + predicates + enrichments.nrqlEnrichments/dashboardEnrichments + destinationConfigurations).
- **P08-03 OTel collector processor pipeline** — `processors` input compiles to an ordered `processorPipeline` (attributes / filter / batch / memory_limiter / resource / unknown).
- **P08-06 PCRE→DPL translator** — exported `pcreToDpl()` detects 12 non-RE2 features (lookbehind, lookahead, named/numeric backrefs, atomic groups, possessive quantifiers, Unicode property escapes, backtracking verbs, recursion, branch reset, inline comments, PCRE escapes). Downgrades atomic groups, strips possessive quantifiers, strips inline flags, normalizes named groups to RE2 syntax. Consumed by `LogObfuscationTransformer` for CUSTOM rules.
- **P08-04 DynaKube full fidelity** — DT Kubernetes manifest now emits mode selector (cloudNative/classic/application/host monitoring), CSI toggle, privileged, hostNetwork, per-component resources (requests+limits), tolerations, nodeSelector, priorityClassName, ActiveGate replicas/resources/capabilities, metadataEnrichment, annotations, labels, custom apiUrl.
- **P08-01 Cloud integration per-service fidelity** — new rich `services[]` input (polling override + namespaces + tag allow/exclude + resource allowlist per service) alongside legacy `enabledServices[]`. AWS gains region allowlist + ingestMode (POLLING / METRIC_STREAM). Azure gains multi-subscription + resource-group scope + managementGroupId. GCP gains multi-project list + service-account email. Service catalog expanded (AWS +8 services, Azure +6, GCP +6).

Tests: 1016 → 1099 (+83). Typecheck clean.

### Changed (Phase 06 — compiler infra metric-name rewriting)

- `NRQLCompiler` now applies a built-in NR → DT metric-name map to `timeseries`-style queries against `SystemSample` / `ProcessSample` / `NetworkSample` / `StorageSample`, so `SELECT average(cpuPercent) FROM SystemSample` now emits `timeseries avg(dt.host.cpu.usage)` rather than preserving the NR metric name literally. The map is exported as `DEFAULT_METRIC_MAP` and covers CPU / memory / disk / network / load-average metrics plus the process-level equivalents. Consumer-supplied `metricMap` options still override the defaults.

### Added (Phase 05 — ingestion expansion)

- `OpenTelemetryCollectorTransformer` — NR OTLP collector config → DT OTLP exporter (grpc/http) + `builtin:otel.ingest-mappings` settings stub. API token scopes (`openTelemetryTrace.ingest`, `metrics.ingest`, `logs.ingest`) flagged for re-provisioning.
- `PrometheusTransformer` — NR Prometheus remote_write or scrape config → DT remote-write endpoint (`/api/v2/metrics/ingest/prometheus`) + `builtin:prometheus.scrape` targets list.
- `StatsDTransformer` — NR StatsD ingestion → `builtin:statsd.ingest` via ActiveGate extension. Tag mappings preserved as dimensionMappings.

### Added (Phase 04 — alert completeness + compiler corpus)

- `NonNrqlAlertConditionTransformer` — NR APM / APM_APP / INFRA_METRIC / INFRA_PROCESS / SYNTHETIC / BROWSER / MOBILE / EXTERNAL_SERVICE conditions (no NRQL source) → Gen3 Metric Events on mapped `builtin:*` metrics with per-product entity dimensions. Unmapped metrics emit a disabled placeholder with warning. Wires into AlertTransformer Workflows via `nr-migrated` entity tag.
- `BaselineAlertTransformer` — NR BASELINE / OUTLIER conditions → `builtin:davis.anomaly-detectors`. Direction (LOWER_ONLY / UPPER_ONLY / UPPER_AND_LOWER) maps to BELOW / ABOVE / BOTH; sensitivity preserved; training window translates to P`<days>`D. Original NRQL is embedded as a DQL comment for compile-through.
- `MaintenanceWindowTransformer` — NR maintenance windows (ONCE / DAILY / WEEKLY / MONTHLY) + mute rules → `builtin:alerting.maintenance-window` with schedule recurrence + suppression mode. MUTE_RULE kind emits NRQL as a TODO `filterSegmentDql` with a warning that DT has no direct "mute on matching NRQL" equivalent.
- **NRQL real-world regression corpus** (`tests/compiler/real-world-corpus.test.ts`) — 22 curated patterns spanning APM / Browser / Mobile / Infra / Logs / Synthetics / Spans / Operators, each asserted to compile with confidence ≥ MEDIUM and matching expected DQL substrings.

### Added (Phase 03 — new Gen3 transformers)

- `BrowserRUMTransformer` — NR Browser app config → `builtin:rum.web.app-detection` + OpenPipeline bizevents mapping (PageView/PageAction/BrowserInteraction/AjaxRequest/JavaScriptError → rum.*). Core Web Vitals note. Manual steps: RUM JS agent deployment, CSP allowlist, Session Replay activation.
- `MobileRUMTransformer` — NR Mobile app config → `builtin:mobile.app-detection` across 8 platforms (Android, iOS, React Native, Flutter, Xamarin, Unity, Cordova, Capacitor) with per-platform SDK-swap guidance. Event mapping covers MobileSession/Crash/HandledException/Request/RequestError.
- `CustomEventTransformer` — NR `recordCustomEvent` / Event API → `builtin:bizevents.http.incoming.rules` ingest rule + OpenPipeline processing + DQL rewrite sample. Attributes accepted explicitly or inferred from a sample payload.
- `CloudIntegrationTransformer` — NR AWS / Azure / GCP integrations → `builtin:cloud.aws` / `.azure` / `.gcp` with per-provider service name mapping and IAM re-provisioning steps.
- `LambdaTransformer` — NR Lambda function config → `builtin:serverless.function-detection` with per-runtime layer swap instructions (nodejs/python/java/dotnet/go/ruby/custom).
- `KubernetesTransformer` — NR K8s integration → DynaKube CR (apiVersion `dynatrace.com/v1beta2`, kind `DynaKube`) with cloudNativeFullStack + ActiveGate kubernetes-monitoring. Namespace include/exclude translate to In/NotIn match expressions.
- `IdentityTransformer` — NR users/teams/roles/SAML → DT user stubs + `builtin:ownership.teams` + Gen3 IAM v2 policy statements + SAML IdP config stub. Permission map covers apm/logs/dashboards/alerts read+admin tiers; unmapped permissions emit TODO placeholders.
- `ChangeTrackingTransformer` — NR change events → DT `/api/v2/events/ingest` payload (`CUSTOM_DEPLOYMENT` / `CUSTOM_CONFIGURATION` / `CUSTOM_INFO`) + Workflow trigger stub for Davis correlation.
- `AIOpsTransformer` — NR AIOps workflows (enrichments + destinations + muting rules) → Gen3 Workflow with `dynatrace.automations:run-query` enrichment tasks and notification task stubs. NRQL enrichments emit TODO DQL placeholders.
- `LogObfuscationTransformer` — NR PII/PAN masking rules → OpenPipeline masking stage (`builtin:openpipeline.logs.pipelines`, stage `masking`) with built-in patterns for EMAIL/SSN/CREDIT_CARD/PHONE/IP_ADDRESS plus CUSTOM regex support. Advanced PCRE features (lookbehind, backreferences) flagged for review.
- `LookupTableTransformer` — NR lookup tables → Grail resource-store upload manifest (JSONL content + `lookup:upload` endpoint path) plus DQL `lookup` subquery usage example.

All Phase 03 transformers emit `manualSteps` arrays alongside warnings enumerating non-automatable work (agent deployment, SDK swap, secret re-provisioning, IAM design) per `docs/OUT-OF-SCOPE.md`.

## [1.0.0] - 2026-04-14

### BREAKING

- All four Gen2-emitting transformers now default to Gen3 output. Callers needing the previous Gen2 shapes must switch to the new `Legacy*` classes, each of which emits a warning on every call.
  - `AlertTransformer`: default output changed from `{ alertingProfile, metricEvents: Record<...>[] }` to `{ workflow: DTWorkflow, metricEvents: DTMetricEvent[] }`. Legacy shape available via `LegacyAlertTransformer`.
  - `NotificationTransformer`: default output changed from `{ integrationType, config }` to `DTWorkflowTask { name, action, description, active, input }`. Legacy shape available via `LegacyNotificationTransformer`.
  - `TagTransformer`: default output changed from `DTAutoTagRule[]` to `DTOpenPipelineEnrichmentRule[]`. Legacy shape available via `LegacyTagTransformer`.
  - `WorkloadTransformer`: default output changed from `DTManagementZone` to `DTSegment`. Legacy shape available via `LegacyWorkloadTransformer`.

### Added

- **Gen3 Workflow Alert path** — `AlertTransformer` emits a Davis-problem-triggered Workflow paired with one Metric Event per NRQL condition. Both sides carry an `nr-migrated=<slug>` entity tag so the workflow fires only on problems raised by its companion Metric Events.
- **Gen3 Notification tasks — 10 channels** — `NotificationTransformer` emits `DTWorkflowTask` configs ready to embed in a Workflow. Native actions for email, slack, pagerduty, jira, servicenow; HTTP-action fallbacks for webhook, opsgenie, xmatters, teams, victorops. Problem payload placeholders follow the Gen3 `{{ event()['event.name'] }}` convention.
- **Gen3 OpenPipeline enrichment tags** — `TagTransformer` emits enrichment rules (schemaId `builtin:openpipeline.logs.pipelines`) that add tag fields to matching records via DPL `matchesValue()` conditions. Pipeline binding (logs/spans/bizevents/metrics) is derived from the NR entity type.
- **Gen3 filter segments for Workloads** — `WorkloadTransformer` emits `builtin:segment` filter trees (Group / Statement nodes) best-effort-translated from the Workload collection or entity-search queries, plus a `manualSteps` array and warnings enumerating the IAM / bucket-scoping work the customer must complete.
- **Opt-in `Legacy*` transformers** — for customers needing parity with previous Dynatrace tenants that still use Gen2 objects (Alerting Profiles, Management Zones, Auto-Tag Rules, classic Problem Notifications). Every legacy call emits a warning.
- **Phase 01 coverage plan** — `docs/COVERAGE.md` maps every NR surface to its Gen3 target, engine module, and status (`✅` covered / `🟡` partial / `🔴` gap / `⚫` not convertible). `docs/OUT-OF-SCOPE.md` documents capabilities intentionally excluded (host ops, secrets, platform features, historical data, customer code rewrites).

## [0.3.1] - 2026-04-10

### Fixed
- Add `typesVersions` to package.json for TypeScript consumers using older `moduleResolution: "node"` (e.g., dt-app bundler v1.7.0) that don't read the `exports` field for type resolution

## [0.3.0] - 2026-04-10

### Added
- Conditional `exports` in package.json for browser-safe subpath imports
  - `./compiler` — NRQL-to-DQL compiler (no Node.js deps)
  - `./validators` — DQL syntax validator + auto-fixer + utils (no Node.js deps)
  - `./transformers` — 10 entity transformers + mapping rules (no Node.js deps)
- Dynatrace app consumers can now `import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine/compiler'` without pulling in Node.js-only modules (clients, config, registry, migration)

## [0.2.1] - 2026-04-10

### Fixed
- Make dotenv import conditional (Node.js only) so the package works in browser/Vite builds
- Dynatrace app consumers no longer fail on unresolvable Node.js built-ins (fs, path, os, crypto)

## [0.2.0] - 2026-04-10

### Added
- Entity mapping rules tests: 51 tests for EntityMapper, value maps, and nested access (mapping-rules.test.ts)
- NRQL mapping rules tests: 62 tests for EVENT_TYPE_MAP, FUNC_MAP, and FIELD_MAP (nrql-mapping-rules.test.ts)
- SLO auditor tests: 13 tests for metric extraction, DQL validation, and synonym groups (slo-auditor.test.ts)
- Utils validators module: 5 validation functions for NR/DT config and entity structures (utils-validators.ts)
- Utils validators tests: 35 tests for config and entity validation (utils-validators.test.ts)
- Test count: 677 → 838 tests (Python parity, excluding 56 N/A CLI/exporter tests)

## [0.1.0] - 2026-04-09

### Added
- AST-based NRQL-to-DQL compiler with 292 tested patterns (lexer, parser, emitter, orchestrator)
- TranslationNotes and confidenceScore on CompileResult for nrql-translator compatibility
- DQL syntax validator with 20+ invalid pattern checks and anti-pattern detection
- DQL auto-fixer with 22 fix methods (quotes, operators, null checks, LIKE patterns, etc.)
- 10 entity transformers: Dashboard, Alert, Notification, Synthetic, SLO, Workload, Infrastructure, LogParsing, Tag, DropRule
- RegexToDPL converter for capture() function support
- NewRelic NerdGraph API client with pagination and rate limiting
- Dynatrace API client (v2 + config v1 + Documents API) with rate limiting
- Configuration management with zod schemas and dotenv
- DTEnvironmentRegistry for live metric/entity/dashboard/synthetic location validation
- SLO auditor for validating and auto-fixing DQL in Dynatrace SLOs
- Migration state management: RollbackManifest, EntityIdMap, MigrationCheckpoint, IncrementalState
- Failed entity retry with FailedEntities class
- Diff/preview with DiffReport for migration planning
- 677 tests across 16 test files
- Project infrastructure: TypeScript 5+ strict mode, ESM, vitest, tsup
