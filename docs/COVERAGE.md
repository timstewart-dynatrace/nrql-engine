# nrql-engine Coverage Matrix

> **Purpose:** Exhaustive inventory of every New Relic surface, mapped to its Gen3 Dynatrace equivalent and the engine module responsible. Tracks what is convertible today, what is partial, what is a gap, and what is not convertible.
>
> **Rule:** Gen3 output only. No Alerting Profiles, Management Zones, Auto-Tag Rules (classic), classic notification channels, or classic dashboards. See `.claude/phases/` for the migration plan to reach zero 🔴 rows.

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
| transformers/alert | — | 🟡 **Gen2** — emits `alertingProfile`; must emit Workflow + Metric Event |
| transformers/notification | — | 🟡 **Gen2** — emits classic `{ProblemTitle}` Problem Notification shape; must emit Workflow action config |
| transformers/tag | — | 🟡 **Gen2** — emits `autoTagRule`; must emit OpenPipeline enrichment |
| transformers/workload | — | 🟡 **Gen2** — emits `managementZone`; must emit `builtin:segment` + bucket-scoped IAM |

## 1. APM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| `FROM Transaction` / `Span` / `TransactionError` | `fetch spans` | compiler | ✅ |
| Service Map (user annotations) | Smartscape (auto-inferred) | — | ⚫ platform feature, no config to migrate |
| Distributed tracing / PurePath | DT distributed tracing | compiler (query) | ✅ |
| Key Transactions | critical-service flag + Workflow + DQL SLO | — | 🔴 |
| Apdex score | `countIf()` buckets in DQL | compiler | 🟡 LOW-confidence translation |
| Deployment markers (APM deployment API) | DT deployment events API | — | 🔴 → ChangeTrackingTransformer (Phase 03) |
| Error profiles | Davis Problems | — | ⚫ platform feature |
| Thread profiler / X-Ray | DT code profiling | — | ⚫ platform feature |
| APM agent uninstall + OneAgent install (per language) | OneAgent deployment | — | ⚫ out-of-scope (host ops; see OUT-OF-SCOPE.md) |
| Custom instrumentation (`newrelic.*()`) | OneAgent SDK / OTel SDK | — | 🔴 AST translator (Phase 04) |
| `newrelic.recordCustomEvent()` | `bizevent.ingest` | — | 🔴 CustomEventTransformer (Phase 03) |
| `newrelic.addCustomAttribute()` | OneAgent SDK CRA | — | 🔴 Phase 04 |
| `newrelic.recordMetric()` | OTel Meter API | — | 🔴 Phase 04 |
| `newrelic.noticeError()` | OneAgent SDK error / OTel | — | 🔴 Phase 04 |
| `newrelic.setTransactionName()` | DT request naming rules | — | 🔴 Phase 04 |
| `newrelic.startSegment()/endSegment()` | OTel span API | — | 🔴 Phase 04 |

## 2. Browser RUM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Browser application (entity) | DT RUM application | — | 🔴 BrowserRUMTransformer (Phase 03) |
| PageView / BrowserInteraction / AjaxRequest / JavaScriptError | `fetch bizevents` (RUM) | compiler (field map) | 🟡 event-type map exists, RUM config not emitted |
| Core Web Vitals (LCP/FID/CLS/INP/TTFB/FCP) | DT RUM Core Web Vitals metrics | — | 🔴 Phase 03 |
| Session Replay | DT Session Replay | — | ⚫ feature activation, not config migration |
| SPA monitoring | DT SPA support | — | 🔴 Phase 03 |
| Custom browser events | DT RUM custom events API | — | 🔴 Phase 03 |
| Browser allow/deny lists | DT RUM domain allowlist | — | 🔴 Phase 03 |
| Domain aliasing | DT application naming rules | — | 🔴 Phase 03 |

## 3. Mobile RUM

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Mobile application (entity) | DT Mobile application | — | 🔴 MobileRUMTransformer (Phase 03) |
| Android / iOS / React Native / Flutter / Xamarin / Unity / Cordova / Capacitor agents | DT Mobile SDK per platform | — | ⚫ SDK swap is host/build op (see OUT-OF-SCOPE.md) |
| MobileSession / MobileCrash / MobileRequest / handled exceptions | DT mobile session data via `fetch bizevents` | compiler (field map) | 🔴 source mapping missing |
| Custom mobile events | DT mobile SDK events | — | 🔴 Phase 03 |
| App launch / device info | DT mobile dimensions | — | 🔴 Phase 03 |
| Crash symbolication (dSYM, ProGuard/R8) | DT symbolication upload | — | ⚫ build-pipeline op |

## 4. Infrastructure

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| `SystemSample` / `ProcessSample` / `NetworkSample` / `StorageSample` | `timeseries` on `dt.host.*` / `dt.process.*` | compiler | ✅ |
| AWS integration config | DT AWS cloud integration (settings) | — | 🔴 CloudIntegrationTransformer (Phase 03) |
| Azure integration config | DT Azure integration | — | 🔴 Phase 03 |
| GCP integration config | DT GCP integration | — | 🔴 Phase 03 |
| AWS Lambda integration | DT Lambda extension config | — | 🔴 LambdaTransformer (Phase 03) |
| On-host integrations (MySQL, Postgres, Redis, …) | DT extensions / OneAgent plugins | — | 🔴 Phase 03 (bundle with Cloud) |
| Kubernetes integration | DT DynaKube | — | 🔴 KubernetesTransformer (Phase 03) |
| Prometheus integration | DT Prometheus ingestion | — | 🔴 Phase 03 |
| StatsD ingestion | DT StatsD ingestion | — | 🔴 Phase 03 |
| OpenTelemetry collector config | DT OTel ingestion | — | 🔴 Phase 03 |
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
| Drop rules | OpenPipeline filter processors | transformers/drop-rule | ✅ |
| Parsing rules (Grok) | OpenPipeline DPL parsers | transformers/log-parsing | ✅ |
| Obfuscation rules (PII / PAN masking) | OpenPipeline masking processors | — | 🔴 LogObfuscationTransformer (Phase 03) |
| Log patterns (auto-clustering) | DT log pattern recognition | — | ⚫ platform feature |
| Log alerting (NRQL on logs) | Metric Event on DQL over `fetch logs` | compiler + alert | 🟡 depends on alert Gen3 rewrite (Phase 02) |
| Log partitions (data partitions) | Grail buckets | — | 🟡 documented, no auto-creation |
| Live tail | DT log live view | — | ⚫ platform feature |
| Log-to-metric rules | OpenPipeline metric extraction | — | 🟡 partial |

## 7. Alerts & Notifications

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Alert Policy | Gen3 Workflow (`trigger.event.config.davis_problem`) | transformers/alert | 🟡 **Gen2 leak** — currently emits Alerting Profile. Phase 02 rewrite |
| NRQL Condition (static threshold) | Metric Event (`builtin:anomaly-detection.metric-events`) with DQL | transformers/alert | 🟡 shape correct, must be wired to Workflow not Alerting Profile |
| NRQL Condition (baseline) | Davis adaptive baseline (`builtin:davis.anomaly-detectors`) | — | 🔴 Phase 04 |
| NRQL Condition (outlier) | Davis outlier detection | — | 🔴 Phase 04 |
| APM Condition | Davis adaptive baseline | — | 🟡 flag-as-manual |
| Infrastructure Condition | Metric Event + Workflow | — | 🔴 non-NRQL condition translator (Phase 04) |
| Synthetic Condition | Metric Event on synthetic results | — | 🔴 Phase 04 |
| External Service Condition | Metric Event on service deps | — | 🔴 Phase 04 |
| Mobile / Browser Condition | Metric Event on RUM metrics | — | 🔴 Phase 04 |
| Multi-location Synthetic Condition | Metric Event w/ location-count | — | 🔴 Phase 04 |
| Lookup tables (WHERE IN) | DQL `lookup` subquery | — | 🔴 LookupTableTransformer (Phase 03) |
| Notification Channel — Email | Workflow task `dynatrace.email:email-action` | transformers/notification | 🟡 **Gen2 leak** — currently emits classic Problem Notification. Phase 02 |
| Notification Channel — Slack | Workflow task `dynatrace.slack:slack-action` | transformers/notification | 🟡 Phase 02 |
| Notification Channel — PagerDuty | Workflow task `dynatrace.pagerduty:pagerduty-action` | transformers/notification | 🟡 Phase 02 |
| Notification Channel — Webhook | Workflow task `dynatrace.http:http-action` | transformers/notification | 🟡 Phase 02 |
| Notification Channel — OpsGenie / xMatters / Jira / ServiceNow / Teams / VictorOps | Workflow HTTP task | — | 🔴 extend NotificationTransformer (Phase 02 scope) |
| Incident preferences (PER_POLICY/CONDITION/TARGET) | Workflow trigger filters + grouping | — | 🔴 Phase 02 |
| Mute rules (NRQL-based) | Metric Event w/ embedded filter | — | 🔴 Phase 04 (with maintenance windows) |
| Maintenance windows (scheduled, recurring) | `dynatrace_maintenance` (Gen3) | — | 🔴 MaintenanceWindowTransformer (Phase 04) |

## 8. AIOps / Applied Intelligence

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Issues & incidents | Davis Problems | — | ⚫ auto-detected; concept mapping only |
| Decisions (correlation rules) | Davis causal engine | — | ⚫ Davis replaces manual decisions |
| NR Workflows (for incident routing) | DT Gen3 Workflows | — | 🔴 AIOpsTransformer (Phase 03) |
| Destinations (webhook targets) | Workflow tasks | — | 🟡 overlaps with NotificationTransformer |
| Enrichments (NRQL-based context injection) | Workflow enrichment steps | — | 🔴 Phase 03 |
| Proactive detection (APM auto-baselines) | Davis adaptive baselines | — | ⚫ platform feature |
| Anomaly detection settings | Davis anomaly detection | — | 🔴 Phase 04 |

## 9. Service Level Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| SLO (v1 / v2) | `builtin:monitoring.slo` | transformers/slo | ✅ |
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
| Saved filter sets | Document saved views | — | 🔴 |

## 11. Users, Teams, Access

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Users | DT Users | — | 🔴 IdentityTransformer (Phase 03) |
| Teams | `builtin:ownership.teams` + IAM Groups | — | 🔴 Phase 03 |
| User types (Full / Core / Basic) | DT license types | — | ⚫ licensing, not config |
| Authentication domains | DT auth settings | — | 🔴 Phase 03 |
| SAML SSO | DT SAML IdP config | — | 🔴 Phase 03 |
| SCIM provisioning | DT SCIM | — | 🔴 Phase 03 |
| Default roles | DT built-in policies | — | 🔴 Phase 03 |
| Custom roles | DT custom IAM policies (bucket-scoped) | — | 🔴 Phase 03 |
| Product-level permissions | DT scoped policies | — | 🔴 Phase 03 |
| API keys (User / Ingest / License / Browser / Mobile) | DT tokens / OAuth clients | — | ⚫ secrets don't migrate |
| Service accounts | DT service users / OAuth clients | — | 🔴 Phase 03 |

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
| Error status (resolved, ignored) | DT Problem comments / resolution | — | 🔴 |
| Error assignments | Problem ownership tags | — | 🔴 |
| Comments on errors | — | — | ⚫ no equivalent |
| Issue tracker integration (Jira, …) | Workflow → Jira | — | 🟡 overlaps NotificationTransformer |

## 14. Workloads & Entity Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Workload | `builtin:segment` + bucket-scoped IAM | transformers/workload | 🟡 **Gen2 leak** — currently emits Management Zone. Phase 02 |
| Entity tags | OpenPipeline enrichment (DPL) | transformers/tag | 🟡 **Gen2 leak** — currently emits Auto-Tag Rule. Phase 02 |
| Entity golden signals | Davis signals | — | ⚫ platform feature |
| Entity health status | Problem severity / Davis | — | ⚫ platform feature |
| Entity relationships | Smartscape | — | ⚫ auto-discovered |
| Custom entities | DT custom device entities | — | 🔴 Phase 03 |

## 15. Data Management

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Data partitions (default + custom) | Grail buckets | — | 🟡 documented, no auto-creation |
| Data retention settings | Per-bucket retention | — | 🟡 manual (Terraform) |
| Event type metadata | — | — | ⚫ DT event types fixed |
| Metric normalization rules | OpenPipeline metric processing | — | 🔴 Phase 03 |
| Custom event types (via Event API) | `bizevent.ingest` | — | 🔴 CustomEventTransformer (Phase 03) |
| Historical data (NRDB) | — | — | ⚫ not migratable to Grail |
| Archive / export (pre-decommission) | NR export via API | — | ⚫ out-of-scope (host ops, long-running; see OUT-OF-SCOPE.md) |

## 16. Specialized Products

| NR Surface | Gen3 Target | Engine Module | Status |
|-----------|-------------|---------------|--------|
| Kubernetes navigator / Cluster explorer | DT Kubernetes app | — | 🔴 KubernetesTransformer (Phase 03) |
| Lambda / serverless monitoring | DT serverless / Lambda extension | — | 🔴 LambdaTransformer (Phase 03) |
| Vulnerability Management | DT Application Security | — | 🔴 Phase 03 |
| Network Performance Monitoring | DT Network monitoring | — | 🔴 Phase 03 (stretch) |
| Model / AI monitoring | DT AI Observability | — | 🔴 Phase 03 (stretch) |
| IoT / Embedded | OTel | — | ⚫ no direct equivalent |
| Security signals | DT Security Investigator | — | 🔴 Phase 03 (stretch) |
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
