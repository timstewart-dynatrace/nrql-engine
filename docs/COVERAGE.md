# nrql-engine Coverage Matrix

> **Purpose:** Operational status dashboard — every New Relic surface, mapped to its Gen3 Dynatrace equivalent and the engine module responsible. Tracks what is convertible today, what is partial, what is a gap, and what is not convertible.
>
> **Rule:** Gen3 output only. No Alerting Profiles, Management Zones, Auto-Tag Rules (classic), classic notification channels, or classic dashboards. See `.claude/phases/` for the migration plan to reach zero 🔴 rows.
>
> **Companion docs:**
> - `MIGRATABILITY.md` — full reasoning layer ("why" each surface is in its current band, A/B/C/D classification)
> - `OUT-OF-SCOPE.md` — exclusion list with ownership pointers
>
> **Audit status:** Last full re-evaluation 2026-04-15 (Phase 07). `*` next to a ✅ status = the schema is emitted but has not been validated against live DT schemas / lacks deep per-field coverage; Phase 08 schedules depth passes.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Covered end-to-end in engine with tests, Gen3 output |
| 🟡 | Partial: engine emits Gen2, scaffold only, or missing fields |
| 🔴 | Gap: no engine support yet |
| ⚫ | Not convertible: no Gen3 equivalent, or outside library scope (see OUT-OF-SCOPE.md) |

## Engine-Side Module Status Summary

| Module | Tests | Gen3 Verdict |
|--------|-------|--------------|
| compiler | 292 | ✅ Gen3 — emits DQL only |
| validators | 129 | ✅ Gen3 — DQL syntax + auto-fix |
| transformers/dashboard | — | ✅ Gen3 (Grail DATA_EXPLORER / DQL) |
| transformers/drop-rule | — | ✅ Gen3 (OpenPipeline ingest rules) |
| transformers/infrastructure | — | ✅ Gen3 (`builtin:anomaly-detection.metric-events`) |
| transformers/log-parsing | — | ✅ Gen3 (OpenPipeline DPL ATTRIBUTE_EXTRACTION) |
| transformers/slo | — | ✅ Gen3 (`builtin:monitoring.slo`) |
| transformers/synthetic | — | ✅ Gen3 (`builtin:synthetic_test`) |
| transformers/alert | — | ✅ Gen3 Workflow + Metric Event default; `LegacyAlertTransformer` preserves Alerting Profile (opt-in, warns) |
| transformers/notification | — | ✅ Gen3 Workflow task (10 channels) default; `LegacyNotificationTransformer` preserves classic Problem Notification (opt-in, warns) |
| transformers/tag | — | ✅ Gen3 OpenPipeline enrichment default; `LegacyTagTransformer` preserves Auto-Tag Rule (opt-in, warns) |
| transformers/workload | — | ✅ Gen3 `builtin:segment` default with manual-step warnings; `LegacyWorkloadTransformer` preserves Management Zone (opt-in, warns) |

## 1. APM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| `FROM Transaction` / `Span` / `TransactionError` | `fetch spans` | compiler | ✅ |
| Service Map (user annotations) | Smartscape (auto-inferred) | — | ⚫ platform feature, no config to migrate |
| Distributed tracing / PurePath | DT distributed tracing | compiler (query) | ✅ |
| Key Transactions | critical-service flag + Workflow + DQL SLO | — | 🔴 Phase 09 |
| Apdex score | `countIf()` buckets in DQL | compiler | 🟡 LOW-confidence translation |
| Deployment markers (APM deployment API) | DT deployment events API | transformers/change-tracking | ✅ |
| Error profiles | Davis Problems | — | ⚫ platform feature |
| Thread profiler / X-Ray | DT code profiling | — | ⚫ platform feature |
| APM agent uninstall + OneAgent install (per language) | OneAgent deployment | — | ⚫ out-of-scope (host ops; see OUT-OF-SCOPE.md) |
| Custom instrumentation (`newrelic.*()`) | OneAgent SDK / OTel SDK | — | 🔴 Phase 10 AST translator |
| `newrelic.recordCustomEvent()` | `bizevent.ingest` | transformers/custom-event | ✅ |
| `newrelic.addCustomAttribute()` | OneAgent SDK CRA | — | 🔴 Phase 10 |
| `newrelic.recordMetric()` | OTel Meter API | — | 🔴 Phase 10 |
| `newrelic.noticeError()` | OneAgent SDK error / OTel | — | 🔴 Phase 10 |
| `newrelic.setTransactionName()` | DT request naming rules | — | 🔴 Phase 10 |
| `newrelic.startSegment()/endSegment()` | OTel span API | — | 🔴 Phase 10 |

## 2. Browser RUM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Browser application (entity) | DT RUM application | transformers/browser-rum | ✅* Phase 08 depth pass scheduled (schema not validated against live DT) |
| PageView / BrowserInteraction / AjaxRequest / JavaScriptError | `fetch bizevents` (RUM) | compiler + transformers/browser-rum | ✅ |
| Core Web Vitals (LCP/FID/CLS/INP/TTFB/FCP) | DT RUM Core Web Vitals metrics | transformers/browser-rum | ✅ auto-captured by DT RUM agent once injected |
| Session Replay | DT Session Replay | — | ⚫ feature activation, not config migration |
| SPA monitoring | DT SPA support | transformers/browser-rum | ✅ |
| Custom browser events | DT RUM custom events API | transformers/browser-rum | ✅ |
| Browser allow/deny lists | DT RUM domain allowlist | transformers/browser-rum | ✅ |
| Domain aliasing | DT application naming rules | transformers/browser-rum | ✅ |

## 3. Mobile RUM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Mobile application (entity) | DT Mobile application | transformers/mobile-rum | 🟡 stub: emits detection record + canned per-platform sentences; no per-platform config diffing (Phase 08) |
| Android / iOS / React Native / Flutter / Xamarin / Unity / Cordova / Capacitor agents | DT Mobile SDK per platform | transformers/mobile-rum | 🟡 config emitted + per-platform SDK-swap instructions; actual code swap is build-pipeline work |
| MobileSession / MobileCrash / MobileRequest / handled exceptions | DT mobile session data via `fetch bizevents` | transformers/mobile-rum | ✅ |
| Custom mobile events | DT mobile SDK events | transformers/mobile-rum | ✅ |
| App launch / device info | DT mobile dimensions | transformers/mobile-rum | ✅ |
| Crash symbolication (dSYM, ProGuard/R8) | DT symbolication upload | — | ⚫ build-pipeline op |

## 4. Infrastructure

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| `SystemSample` / `ProcessSample` / `NetworkSample` / `StorageSample` | `timeseries` on `dt.host.*` / `dt.process.*` | compiler (DEFAULT_METRIC_MAP) | ✅ metric names auto-rewritten |
| AWS integration config | DT AWS cloud integration (settings) | transformers/cloud-integration | 🟡 thin per-provider shell; no per-service polling freq / metric-stream vs polling / namespace allow-list (Phase 08) |
| Azure integration config | DT Azure integration | transformers/cloud-integration | 🟡 (Phase 08 — resource-group scope, subscription allowlist) |
| GCP integration config | DT GCP integration | transformers/cloud-integration | 🟡 (Phase 08 — multi-project, service-account details) |
| AWS Lambda integration | DT Lambda extension config | transformers/lambda | 🟡 per-runtime layer pointer; no IAM / per-region layer-ARN table (Phase 08) |
| On-host integrations (MySQL, Postgres, Redis, …) | DT extensions / OneAgent plugins | — | 🔴 Phase 10 |
| CloudWatch Metric Streams (Kinesis) | DT AWS Metric Streams ingest | — | 🔴 Phase 08 |
| Kubernetes integration | DT DynaKube | transformers/kubernetes | 🟡 emits DynaKube stub; no CSI / privileged / namespace-filter / resource-limits (Phase 08) |
| Prometheus integration | DT Prometheus ingestion | transformers/prometheus | 🟡 remote-write + scrape; relabel rules not translated (Phase 08) |
| StatsD ingestion | DT StatsD ingestion | transformers/statsd | 🟡 minimal ActiveGate pointer; no tag mapping detail (Phase 08) |
| OpenTelemetry collector config | DT OTLP ingestion | transformers/otel-collector | 🟡 endpoint swap; no processor-pipeline translation (attributes / filter / batch / memory_limiter) (Phase 08) |
| OpenTelemetry metrics pipeline (direct OTLP, non-collector) | DT OTLP metrics ingest + semconv mapping | — | 🔴 Phase 09 |
| NR Flex (custom scripts) | OneAgent extensions / OTel collector | — | ⚫ script rewrite, not automatable |
| Infra-agent log collection | OneAgent log collection | — | 🟡 reconfigure at forwarder level |

## 5. Synthetic Monitoring

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Simple Ping / Browser / Scripted API | `builtin:synthetic_test` (HTTP / Browser / Multi-step) | transformers/synthetic | ✅ |
| Scripted Browser | DT Browser Monitor (clickpath) | transformers/synthetic | 🟡 scaffold only — manual rebuild |
| Step Monitor (legacy) | DT Browser Monitor | transformers/synthetic | 🟡 scaffold |
| Certificate Check | DT HTTP Monitor w/ cert validation | — | 🔴 extend SyntheticTransformer (Phase 03) |
| Broken Links | reformulate as custom DQL + alert | — | 🔴 Phase 03 |
| Secure credentials | DT credentials vault | — | ⚫ secrets don't migrate |
| Public locations | DT public locations (region map) | transformers/synthetic | ✅ |
| Private locations / minions | DT ActiveGate synthetic capability | — | ⚫ infrastructure deployment |

## 6. Logs

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Log ingest (Fluent Bit / Fluentd / Filebeat) | DT log ingest / OneAgent | — | 🟡 reconfigure forwarders (doc-level) |
| Log API (HTTP POST) | DT Generic Log Ingest API | — | 🟡 endpoint change |
| Drop rules (v1 NRQL) | OpenPipeline filter processors | transformers/drop-rule | ✅ |
| Drop Filter Rules v2 (attribute-scoped) | OpenPipeline attribute-drop | — | 🔴 Phase 08 |
| Log Live Archive (tiered long-term) | Grail cold bucket + retention | — | 🔴 Phase 10 |
| Streaming Exports (AWS Kinesis / Azure EH / GCP PubSub) | Grail → OpenPipeline HTTP egress | — | 🔴 Phase 10 |
| Parsing rules (Grok) | OpenPipeline DPL parsers | transformers/log-parsing | ✅ |
| Obfuscation rules (PII / PAN masking) | OpenPipeline masking processors | transformers/log-obfuscation | 🟡 fixed pattern list; customer regex rules pass-through only — need PCRE→DPL translator (Phase 08) |
| Log patterns (auto-clustering) | DT log pattern recognition | — | ⚫ platform feature |
| Log alerting (NRQL on logs) | Metric Event on DQL over `fetch logs` | compiler + alert | 🟡 depends on alert Gen3 rewrite (Phase 02) |
| Log partitions (data partitions) | Grail buckets | — | 🟡 documented, no auto-creation |
| Live tail | DT log live view | — | ⚫ platform feature |
| Log-to-metric rules | OpenPipeline metric extraction | — | 🟡 partial |

## 7. Alerts & Notifications

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Alert Policy | Gen3 Workflow (`trigger.event.config.davis_problem`) | transformers/alert | ✅ Gen3 default (legacy opt-in) |
| NRQL Condition (static threshold) | Metric Event (`builtin:anomaly-detection.metric-events`) with DQL | transformers/alert | ✅ wired via `entity_tags` to companion Workflow |
| NRQL Condition (baseline) | Davis adaptive baseline (`builtin:davis.anomaly-detectors`) | transformers/baseline-alert | ✅ |
| NRQL Condition (outlier) | Davis outlier detection | transformers/baseline-alert | ✅ |
| APM Condition | Metric Event on mapped builtin:service.* | transformers/non-nrql-alert | ✅ |
| Infrastructure Condition | Metric Event + Workflow | transformers/non-nrql-alert | ✅ |
| Synthetic Condition | Metric Event on synthetic results | transformers/non-nrql-alert | ✅ |
| External Service Condition | Metric Event on service deps | transformers/non-nrql-alert | ✅ |
| Mobile / Browser Condition | Metric Event on RUM metrics | transformers/non-nrql-alert | ✅ |
| Multi-location Synthetic Condition | Metric Event w/ location-count | — | 🟡 covered via SYNTHETIC condition path; location-count logic requires manual DQL |
| Lookup tables (WHERE IN) | DQL `lookup` subquery | transformers/lookup-table | ✅ |
| Notification Channel — Email | Workflow task `dynatrace.email:email-action` | transformers/notification | ✅ Gen3 default (legacy opt-in) |
| Notification Channel — Slack | Workflow task `dynatrace.slack:slack-action` | transformers/notification | ✅ |
| Notification Channel — PagerDuty | Workflow task `dynatrace.pagerduty:pagerduty-action` | transformers/notification | ✅ |
| Notification Channel — Webhook | Workflow task `dynatrace.http:http-action` | transformers/notification | ✅ |
| Notification Channel — OpsGenie | Workflow HTTP task (`GenieKey` header) | transformers/notification | ✅ |
| Notification Channel — xMatters | Workflow HTTP task | transformers/notification | ✅ |
| Notification Channel — Jira | Workflow task `dynatrace.jira:create-issue-action` | transformers/notification | ✅ |
| Notification Channel — ServiceNow | Workflow task `dynatrace.servicenow:incident-action` | transformers/notification | ✅ |
| Notification Channel — Teams | Workflow HTTP task | transformers/notification | ✅ |
| Notification Channel — VictorOps | Workflow HTTP task | transformers/notification | ✅ |
| Incident preferences (PER_POLICY/CONDITION/TARGET) | Workflow trigger filters + grouping | transformers/alert + transformers/aiops | 🟡 aggregation via entity-tag match is emitted; PER_TARGET grouping semantics require manual Workflow grouping step |
| Mute rules (NRQL-based) | Maintenance window + filter segment / Workflow suppression | transformers/maintenance-window | ✅ emits filterSegmentDql TODO — NRQL is preserved for compile-through |
| Maintenance windows (scheduled, recurring) | `builtin:alerting.maintenance-window` | transformers/maintenance-window | ✅ |

## 8. AIOps / Applied Intelligence

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Issues & incidents | Davis Problems | — | ⚫ auto-detected; concept mapping only |
| Decisions (correlation rules) | Davis causal engine | — | ⚫ Davis replaces manual decisions |
| NR Workflows (for incident routing, classic) | DT Gen3 Workflows | transformers/aiops | ✅ |
| NR Workflows v2 (new UI, different shape) | DT Gen3 Workflows | transformers/aiops | 🟡 v2 input shape not handled (Phase 08) |
| Suppression / Golden Signal tuning | Davis anomaly settings | — | 🔴 Phase 10 |
| Destinations (webhook targets) | Workflow tasks | transformers/aiops + transformers/notification | ✅ |
| Enrichments (NRQL-based context injection) | Workflow enrichment steps | transformers/aiops | ✅ emits `dynatrace.automations:run-query` tasks with NRQL-to-DQL TODO placeholders |
| Proactive detection (APM auto-baselines) | Davis adaptive baselines | — | ⚫ platform feature |
| Anomaly detection settings | Davis anomaly detection | transformers/baseline-alert | ✅ |

## 9. Service Level Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| SLO (v1 / v2) | `builtin:monitoring.slo` | transformers/slo | ✅ |
| Service Levels v3 API (SL v3) | `builtin:monitoring.slo` v2 schema | transformers/slo | 🟡 v3 input shape not yet round-tripped (Phase 09) |
| SLI query (NRQL) | DT SLO metric expression (DQL) | transformers/slo + compiler | ✅ |
| Error budget burn-rate alerts | Burn-rate Metric Event on SLI | — | 🟡 requires alert Gen3 (Phase 02) |

## 10. Dashboards

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Dashboard (multi-page) | DT Documents (one per page) | transformers/dashboard | ✅ |
| Widgets: line / area / bar / pie / table / billboard / histogram / markdown / JSON | DT Grail DATA_EXPLORER tile variants | transformers/dashboard | ✅ |
| Widget: heatmap | DT honeycomb / table | transformers/dashboard | 🟡 |
| Widget: event feed | DT table | transformers/dashboard | 🟡 |
| Widget: funnel | DT markdown placeholder | transformers/dashboard | 🔴 manual |
| Nerdpack widget | no DT equivalent | — | ⚫ |
| Dashboard variables (enum / NRQL / string) | DT Document variables | transformers/dashboard | ✅ |
| Cascading variables | DT cascading variables | transformers/dashboard | 🟡 |
| Dashboard permissions | Document sharing | — | 🟡 manual mapping |
| Saved filter sets | Document saved views | — | 🔴 Phase 10 |
| Saved query / Data Apps | DT Notebooks | — | 🔴 Phase 10 |

## 11. Users, Teams, Access

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Users | DT Users | transformers/identity | 🟡 stubs only for IAM binding; users auto-create on first SSO sign-in (Phase 09 SCIM filter translator) |
| Teams | `builtin:ownership.teams` + IAM Groups | transformers/identity | ✅ |
| User types (Full / Core / Basic) | DT license types | — | ⚫ licensing, not config |
| Authentication domains | DT auth settings | transformers/identity | ✅ |
| SAML SSO | DT SAML IdP config | transformers/identity | ✅ |
| SCIM provisioning | DT SCIM | — | 🟡 flagged as manual follow-up per IdentityTransformer warnings |
| Default roles | DT built-in policies | transformers/identity | ✅ |
| Custom roles | DT custom IAM policies (bucket-scoped) | transformers/identity | ✅ common permissions mapped; unmapped permissions emit TODO placeholders |
| Product-level permissions | DT scoped policies | transformers/identity | ✅ |
| API keys (User / Ingest / License / Browser / Mobile) | DT tokens / OAuth clients | — | ⚫ secrets don't migrate |
| Service accounts | DT service users / OAuth clients | transformers/identity | 🟡 emitted as user stubs; DT OAuth client setup is manual |

## 12. Change Tracking / Deployments

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Change events | DT events API (`CUSTOM_DEPLOYMENT` / `CUSTOM_CONFIGURATION`) | — | 🔴 ChangeTrackingTransformer (Phase 03) |
| Deployment markers (APM deployment API) | DT deployment events | — | 🔴 Phase 03 |
| Changes dashboard | DT Problems / events correlation | — | ⚫ platform feature |
| Change intelligence | Davis causal engine | — | ⚫ platform feature |

## 13. Errors Inbox

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Error occurrences | DT exceptions / span errors | compiler | ✅ via span query |
| Error grouping | DT error fingerprinting | — | ⚫ platform feature |
| Error status (resolved, ignored) | — | — | ⚫ no direct equivalent — see OUT-OF-SCOPE.md |
| Error assignments | — | — | ⚫ no direct equivalent — see OUT-OF-SCOPE.md |
| Comments on errors | — | — | ⚫ no equivalent |
| Issue tracker integration (Jira, …) | Workflow → Jira | — | 🟡 overlaps NotificationTransformer |

## 14. Workloads & Entity Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Workload | `builtin:segment` + bucket-scoped IAM | transformers/workload | ✅ Gen3 segment default (best-effort; manual IAM + bucket scoping flagged in warnings) |
| Entity tags | OpenPipeline enrichment (DPL) | transformers/tag | ✅ Gen3 default (legacy opt-in) |
| Entity golden signals | Davis signals | — | ⚫ platform feature |
| Entity health status | Problem severity / Davis | — | ⚫ platform feature |
| Entity relationships | Smartscape | — | ⚫ auto-discovered |
| Custom entities | DT custom device entities | — | 🔴 Phase 03 |

## 15. Data Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Data partitions (default + custom) | Grail buckets | — | 🟡 documented, no auto-creation |
| Data Plus tier features (retention, PCI / HIPAA / FedRAMP) | Grail retention + bucket compliance tags | — | 🔴 Phase 10 |
| Data retention settings | Per-bucket retention | — | 🟡 manual (Terraform) |
| Event type metadata | — | — | ⚫ DT event types fixed |
| Metric normalization rules | OpenPipeline metric processing | — | 🔴 Phase 03 |
| Custom event types (via Event API) | `bizevent.ingest` | transformers/custom-event | ✅ |
| Historical data (NRDB) | — | — | ⚫ not migratable to Grail |
| Archive / export (pre-decommission) | NR export via API | — | ⚫ out-of-scope (host ops, long-running; see OUT-OF-SCOPE.md) |

## 16. Specialized Products

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Kubernetes navigator / Cluster explorer | DT Kubernetes app | transformers/kubernetes | ✅ emits DynaKube CR |
| Lambda / serverless monitoring | DT serverless / Lambda extension | transformers/lambda | ✅ per-runtime layer guidance |
| Vulnerability Management | DT Application Security | — | 🔴 Phase 10 (stretch) |
| Network Performance Monitoring / NPM / DDI | DT Network monitoring + extensions | — | 🔴 Phase 10 (stretch) |
| AI Monitoring / MLM | DT AI Observability | — | 🔴 Phase 10 (stretch) |
| Database Monitoring (NRDM) | DT DB extensions + `dt.services.database.*` | — | 🔴 Phase 10 |
| IoT / Embedded | OTel | — | ⚫ no direct equivalent |
| Security signals | DT Security Investigator | — | 🔴 Phase 10 (stretch) |
| APM 360 (service-level overview UI) | DT Services app (auto) | — | ⚫ platform feature |
| NR-Grafana plugin | Grafana DT datasource | — | ⚫ no migratable artifact |
| NR Prometheus Agent | DT Prometheus remote write | — | 🔴 Phase 03 |
| NR Browser Pro features | — | — | ⚫ no equivalent |

## 17. Programmability / Extensions

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Nerdpacks (custom NR One apps) | DT AppEngine apps | — | ⚫ customer rewrite |
| Custom visualizations | DT custom visualizations | — | ⚫ customer rewrite |
| nr1 CLI | DT developer tools | — | ⚫ tooling, not config |
| NerdGraph scripts | DT API clients | — | ⚫ customer rewrite |

## 18. Observability as Code

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Terraform `newrelic` provider | `dynatrace-oss/dynatrace` provider | consumer concern (export from consuming CLI) | ⚫ out-of-scope for library; emitted by consumers |
| Dashboards-as-code | DT Documents API | transformers/dashboard | ✅ |
| Alerts-as-code | DT Workflows + Metric Events | transformers/alert | 🟡 Phase 02 |
| CI/CD pipeline migration | — | — | ⚫ customer rewrite |

## 19. FinOps / Cost

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Data ingest tracking | DPS usage queries | — | ⚫ platform feature |
| Usage dashboards | DT usage app | — | ⚫ platform feature |
| Cost & spend tracking | Bucket attribution | — | ⚫ platform feature |

## Exit Criteria

- 0 🔴 rows (every remaining gap is ⚫ with a reason in this file or OUT-OF-SCOPE.md)
- 0 🟡 rows with Gen2 leak — all covered transformers emit Gen3 only
- Every ✅ row has ≥1 test in `tests/`
- `grep -rn 'alertingProfile\|managementZone\|autoTag\|notificationChannel' src/` returns 0 matches in emitted shapes (input-side NR field names may remain)
