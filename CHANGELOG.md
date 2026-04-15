# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
