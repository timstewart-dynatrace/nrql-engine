# NR → DT Migratability (Exhaustive Inventory)

> **Purpose:** The definitive "can we migrate this?" catalog for every
> known New Relic surface. For each entry, classify migratability into
> one of four bands, name the Dynatrace Gen3 target, point at the
> implementing engine module (or the phase that will add it), and —
> critically — explain the reasoning so future reviewers can sanity-check
> without re-deriving the mapping.
>
> **Relation to siblings:**
> - `COVERAGE.md` is the operational status dashboard (tracks ✅/🟡/🔴/⚫ and the transformer file that implements it).
> - `OUT-OF-SCOPE.md` holds the reasoned exclusion list with ownership pointers.
> - This file (`MIGRATABILITY.md`) is the reasoning layer underneath both: it explains *why* each NR surface ended up in its current band.

## Classification Bands

| Band | Label | Meaning |
|------|-------|---------|
| **A** | Fully migratable (config) | NR artifact has a 1:1 Gen3 equivalent; the engine emits the full Gen3 shape without loss. Manual work limited to secret re-provisioning. |
| **B** | Structurally migratable, manual finish | The Gen3 shape is emitted but some parts require human decisions (IAM scope, filter segment tuning, SDK choice). Warnings enumerate every open decision. |
| **C** | Indirect migration | No direct artifact migrates; the *behavior* is achievable in Gen3 through a different mechanism (example: NR mute rules → Workflow problem-filter + maintenance window combo). The engine emits the closest stand-in plus a warning. |
| **D** | Not migratable (reason documented) | Either (a) no DT equivalent exists, (b) the artifact is a secret / license-scoped item that must be re-provisioned, (c) the work requires host / build / pipeline access and belongs in a separate CLI, or (d) it is a platform-automatic behavior (nothing to migrate). See `OUT-OF-SCOPE.md`. |

A mapping with an asterisk (`*`) indicates the implementation was a stub when originally written. As of Phase 08 depth passes, all `✅*` rows have been upgraded to plain `✅`. The asterisks below appear only for historical context and are tracked via the engine's `COVERAGE.md` dashboard for current status.

> **State as of Phase 13 (2026-04-15):** Every `→ planned P08/P09/P10` or `(future)` pointer below has since landed. Specifically:
> - All 11 Phase 08 depth passes (cloud-integration / kubernetes / lambda / prometheus / otel-collector / log-obfuscation / drop-rule-v2 / notification-routing / cloudwatch-metric-streams / aiops-v2) shipped with plain-✅ fidelity.
> - All 8 Phase 09 translators (`KeyTransactionTransformer`, `CustomEntityTransformer`, SLO v3, rrule, SCIM filter, AIOps enrichment compile-through, direct-OTLP metrics, cert-check + broken-links synthetic) shipped.
> - All 23 Phase 10 specialized + stretch items shipped (DB / Security / On-host / Log Archive / Data Plus / Metric Normalization / widget upgrades / multi-location synthetic / notebook / davis tuning); items P10-01 / P10-02 / P10-04 / P10-06..11 were absorbed into Phase 11 back-ports.
> - Phase 11 back-ported Phase 19 confidence uplift, custom-instrumentation translator, Vulnerability / NPM / AI Monitoring transformers, and `preflightGen3()` + `preflightNewRelic()` client probes.
> - Phase 12 shipped the deferred P11 follow-ups: `createTransformer` factory, Legacy dashboard / SLO / synthetic variants, `toMonacoYaml`, `getOtelEnvForDt`.
>
> The per-row references below still say `→ planned P08/P09/P10` where the original audit placed the work item — that language is historical. For the live verdict, check `COVERAGE.md`.

## 1. APM (Application Performance Monitoring)

### What migrates

| NR Surface | Band | Gen3 Target | Engine | Reasoning |
|-----------|------|-------------|--------|-----------|
| Transaction / TransactionError / Span event queries | A | `fetch spans` | compiler | 292 tested patterns + corpus regression suite; field map covers response time, error, appName, duration, http.* |
| Distributed tracing / PurePath | A | DT distributed tracing | compiler | PurePath = DT's native tracing model; spans query maps cleanly |
| Apdex | B | `countIf()` decomposed buckets | compiler (LOW confidence) | `apdex(threshold)` is decomposed into satisfied/tolerable countIf aggregations; LOW confidence because NR's auto-computed T-value does not round-trip precisely |
| Service dependencies | A | Smartscape (auto) | none required | DT discovers service graph automatically once OneAgent is attached |
| Custom instrumentation calls (`newrelic.*`) | D (secondary translator planned P09) | OneAgent SDK / OTel SDK | (future, language-specific) | AST-level code rewriting; cannot be done from NR API exports |
| APM agent install/uninstall per-language | D | OneAgent install | external CLI | Host-side filesystem + package-manager operations; out of library scope |
| Key Transactions | C → planned P08 | `critical-service` entity tag + dedicated SLO + Workflow | (future `key-transaction.transformer.ts`) | NR's "Key Transaction" is a named SLA wrapper; DT has no direct equivalent but can be synthesized from tag + SLO + Workflow |
| Thread profiler / X-Ray sessions | D | DT code profiler | — | Platform feature; activation, not migration |

### What does not migrate

| NR Surface | Band | Reason |
|-----------|------|--------|
| Service Map user annotations | D | Smartscape is auto-inferred; annotations are a UI affordance with no persistable analogue |
| Error inbox status (resolved/ignored/assigned) | D | DT Problem resolution does not carry per-record comment / assignee state in a migratable form |

## 2. Browser RUM

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Browser app detection config | A* | `builtin:rum.web.app-detection` | browser-rum |
| Event type mapping (PageView/PageAction/BrowserInteraction/AjaxRequest/JavaScriptError) | A | `rum.*` bizevent names | browser-rum |
| Core Web Vitals monitoring | A | auto-captured by DT RUM agent | browser-rum (notes-only) |
| Custom browser events | B* | OpenPipeline bizevents mapping | browser-rum |
| Allow/deny domain lists | A | DT RUM domain allowlist | browser-rum |
| SPA support flag | A | DT SPA support | browser-rum |
| **Runtime**: agent snippet + CSP + Session Replay activation | D | — | — |
| **Symbolication upload** | D | build-pipeline | — |

`*` current implementation is structurally correct but has not been validated against the live DT schema; Phase 08 deep-fidelity pass is scheduled.

## 3. Mobile RUM

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Mobile app detection per 8 platforms (Android/iOS/RN/Flutter/Xamarin/Unity/Cordova/Capacitor) | B* | `builtin:mobile.app-detection` | mobile-rum |
| Mobile event mapping (Session/Crash/HandledException/Request/RequestError) | A | `rum.mobile.*` bizevents | mobile-rum |
| Custom mobile events | A | bizevents | mobile-rum |
| SDK swap | D | build pipeline (customer) | — |
| Crash symbolication (dSYM / ProGuard) | D | DT symbolication upload (build pipeline) | — |

## 4. Infrastructure

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| SystemSample / ProcessSample / NetworkSample / StorageSample queries | A | `timeseries` with `dt.host.*` / `dt.process.*` metrics | compiler (`DEFAULT_METRIC_MAP`) |
| AWS integration | B* | `builtin:cloud.aws` | cloud-integration |
| Azure integration | B* | `builtin:cloud.azure` | cloud-integration |
| GCP integration | B* | `builtin:cloud.gcp` | cloud-integration |
| Lambda | B* | `builtin:serverless.function-detection` | lambda |
| Kubernetes (DynaKube manifest) | B* | DynaKube CR | kubernetes |
| Prometheus (remote-write + scrape) | B* | `builtin:prometheus.scrape` + remote-write | prometheus |
| StatsD | B | `builtin:statsd.ingest` via ActiveGate | statsd |
| OTel collector config | B | DT OTLP endpoints | otel-collector |
| CloudWatch Metric Streams | C → planned P08 | DT AWS Metric Streams ingest | (future) |
| On-host integrations (MySQL / Postgres / Redis / …) | C → planned P10 | DT extensions / OneAgent plugins | (future) |
| NR Flex custom scripts | D | OneAgent extensions / OTel collector (customer rewrite) | — |

## 5. Synthetic Monitoring

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Simple Ping / Browser / Scripted API / Scripted Browser / Step | A / B | `builtin:synthetic_test` variants | synthetic |
| Certificate Check | C → planned P10 | HTTP monitor with cert validation rules | (future) |
| Broken Links | C → planned P10 | Custom DQL + alert pair | (future) |
| Secure credentials | D | DT credentials vault (secrets do not migrate) | — |
| Public locations | A | DT public locations | synthetic |
| Private locations / minions | D | ActiveGate synthetic capability (infra deploy) | — |

## 6. Logs

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Log ingest (Fluent Bit / Fluentd / Filebeat) | B | DT log ingest or OneAgent (reconfigure) | — (doc-level) |
| Log API (HTTP POST) | B | DT Generic Log Ingest | — |
| Drop rules (v1) | A | OpenPipeline filter processors | drop-rule |
| **Drop Filter Rules v2** (attribute-scoped) | C → planned P08 | OpenPipeline attribute-drop processors | (future) |
| Parsing rules (Grok) | A | OpenPipeline DPL parsers | log-parsing |
| Obfuscation / PII masking | A* | OpenPipeline masking stage | log-obfuscation |
| **Log Live Archive** | C → planned P10 | Grail cold bucket + retention | (future) |
| **Streaming Exports** (AWS Kinesis / Azure EH / GCP PubSub) | C → planned P10 | Grail → OpenPipeline HTTP egress | (future) |
| Log patterns (auto-clustering) | D | DT log pattern recognition (platform feature) | — |
| Log alerting (NRQL on logs) | A | Metric Event on DQL over `fetch logs` | compiler + alert |
| Log partitions (data partitions) | B | Grail buckets (manual creation) | — |
| Log-to-metric rules | B → planned P08 | OpenPipeline metric extraction | (future) |
| Live tail | D | DT log live view (platform feature) | — |

## 7. Alerts & Notifications

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Alert Policy | A | Gen3 Workflow (davis_problem trigger) | alert |
| NRQL Condition (static threshold) | A | Metric Event (`builtin:anomaly-detection.metric-events`) + Workflow wiring | alert |
| NRQL Condition (baseline) | A | Davis anomaly detector (`builtin:davis.anomaly-detectors`) | baseline-alert |
| NRQL Condition (outlier) | A | Davis outlier detector | baseline-alert |
| APM / Infra / Synthetic / Browser / Mobile / ExternalService Condition | A | Metric Event on mapped `builtin:*` metric | non-nrql-alert |
| Multi-location Synthetic Condition (location-count logic) | C → planned P10 | custom DQL + Metric Event | (extension of SYNTHETIC path) |
| Lookup tables (WHERE IN) | A | DQL `lookup` subquery + resource-store upload | lookup-table |
| Notification channels — 10 providers | A | Workflow tasks (`dynatrace.email` / `.slack` / `.pagerduty` / `.jira` / `.servicenow` / HTTP-action for OpsGenie/xMatters/Teams/VictorOps/Webhook) | notification |
| Mute rules (NRQL-based) | C | Maintenance window with `filterSegmentDql` TODO + Workflow suppression (warned) | maintenance-window |
| Maintenance windows (scheduled + recurring) | A | `builtin:alerting.maintenance-window` | maintenance-window |
| Incident preferences (PER_POLICY / CONDITION / TARGET) | B | Workflow trigger filters + grouping | alert + aiops |
| **Notification Policies v2** (per-policy destination routing) | B → planned P08 | Per-trigger task subset per Workflow | (extension of notification) |
| Gen2 parity (legacy): Alerting Profile / classic channel | A | classic Gen2 shapes | legacy-* classes (opt-in, warn) |

## 8. AIOps / Applied Intelligence

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Classic AIOps workflows (incident routing) | A | Gen3 Workflow with enrichments + destinations | aiops |
| **Workflows v2** (new NR workflows UI) | B → planned P08 | Gen3 Workflow | (extension of aiops) |
| Enrichments (NRQL-based context injection) | B | `dynatrace.automations:run-query` tasks with compile-through TODO | aiops |
| Destinations (webhook/Slack/etc.) | A | Workflow tasks | aiops + notification |
| Muting rules (NRQL) | C | DQL comments on Workflow + maintenance window | aiops + maintenance-window |
| Issues & incidents | D | Davis Problems (auto) | — |
| Decisions (correlation rules) | D | Davis causal engine (auto) | — |
| Proactive detection (APM auto-baselines) | D | Davis adaptive baselines (auto) | — |
| **Suppression / Golden Signal tuning** | C → planned P10 | Davis anomaly detection settings | (future) |

## 9. Service Level Management

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| SLO v1 / v2 | A | `builtin:monitoring.slo` | slo |
| **Service Levels v3 API (SL v3)** | B → planned P08 | `builtin:monitoring.slo` v2 schema | (extension of slo) |
| SLI (NRQL) | A | DQL metric expression | slo + compiler |
| Error budget burn-rate alerts | B | Burn-rate Metric Event on SLI | (requires alert Gen3 — present) |

## 10. Dashboards & Visualization

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Dashboard (multi-page) | A | DT Documents (one per page) | dashboard |
| Widgets (line/area/bar/pie/table/billboard/histogram/markdown/JSON) | A | DT Grail DATA_EXPLORER variants | dashboard |
| Heatmap widget | B → planned P10 | DT honeycomb / table | dashboard (upgrade planned) |
| Event-feed widget | B → planned P10 | DT table (event sort) | dashboard (upgrade planned) |
| Funnel widget | C → planned P10 | Markdown + pre-built DQL | dashboard (upgrade planned) |
| Nerdpack widgets | D | DT custom visualizations (rewrite) | — |
| Dashboard variables (enum / NRQL / string) | A | DT Document variables | dashboard |
| Cascading variables | B | DT cascading variables | dashboard |
| Dashboard permissions | B | Document sharing | — (doc-level) |
| **Saved query / Data Apps** | C → planned P10 | DT Notebooks | (future) |

## 11. Users, Teams, Access

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Users | B* | DT Users (stubs for IAM binding) | identity |
| Teams | A | `builtin:ownership.teams` | identity |
| Auth domains | B | DT auth settings | identity |
| SAML SSO | B | DT SAML IdP config | identity |
| SCIM provisioning | B → planned P10 | DT SCIM + filter translator | (extension of identity) |
| Default roles | A | DT built-in policies | identity |
| Custom roles | B | Gen3 IAM v2 policies | identity |
| Scoped permissions | B | DT scoped policies | identity |
| API keys (User / Ingest / License / Browser / Mobile) | D | DT tokens / OAuth clients (secrets do not migrate) | — |
| Service accounts | B | DT service users / OAuth clients | identity (stubs) |
| User types (Full / Core / Basic) | D | DT licensing (not config) | — |

## 12. Change Tracking / Deployments

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Change events | A | DT events API (`CUSTOM_DEPLOYMENT` / `CUSTOM_CONFIGURATION`) | change-tracking |
| Deployment markers (APM deployment API) | A | DT deployment events | change-tracking |
| Change Tracking API | A | DT events API | change-tracking |
| Changes dashboard / correlation | D | Davis causal engine (auto) | — |

## 13. Errors Inbox

| NR Surface | Band | Reason |
|-----------|------|--------|
| Error occurrences via span query | A | Covered by compiler via `fetch spans | filter isNotNull(error)` |
| Error fingerprinting | D | DT platform-automatic |
| Error status / comments / assignments | D | No direct equivalent; captured in OUT-OF-SCOPE |
| Issue tracker integrations | B | Workflow → Jira / ServiceNow covered by notification |

## 14. Workloads & Entity Management

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Workload | B | `builtin:segment` + IAM + Grail bucket scope (warnings enumerate manual steps) | workload |
| Entity tags | A | OpenPipeline enrichment (DPL) | tag |
| Entity relationships | D | Smartscape (auto) | — |
| Custom entities | C → planned P10 | DT custom-device entities | (future) |
| Golden signals / health status | D | Davis (auto) | — |

## 15. Data Management

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Data partitions (default + custom) | B | Grail buckets | — (doc-level) |
| Retention settings | B → planned P10 | Per-bucket retention | (future) |
| **Data Plus tier features** (longer retention, PCI / HIPAA / FedRAMP) | C → planned P10 | Grail retention + bucket compliance tags | (future) |
| Custom event types | A | Bizevent ingest rule + OpenPipeline processing | custom-event |
| Drop Filter Rules v1 | A | OpenPipeline filter processor | drop-rule |
| **Drop Filter Rules v2** (attribute-scoped) | C → planned P08 | OpenPipeline attribute-drop | (future) |
| Metric normalization rules | C → planned P10 | OpenPipeline metric processing | (future) |
| Historical NRDB | D | Not transferable (storage format incompatibility) | — |
| Archive / export (pre-decommission) | D | Companion CLI (Dynatrace-NewRelic Python) owns this | — |

## 16. Specialized Products

| NR Surface | Band | Reason / Plan |
|-----------|------|---------------|
| Kubernetes navigator / Cluster explorer | A | Covered by `kubernetes` DynaKube emitter |
| Lambda / Serverless | A | Covered by `lambda` per-runtime emitter |
| Vulnerability Management | C → planned P10 | DT Application Security (Runtime Vulnerability Analytics) |
| Network Performance Monitoring / NPM / DDI | C → planned P10 | DT Network monitoring + extensions |
| **AI Monitoring / MLM** | C → planned P10 | DT AI Observability |
| **Database Monitoring (NRDM)** | C → planned P10 | DT DB extensions + `dt.services.database.*` |
| **APM 360** | D | DT Services app (auto) |
| **NR-Grafana plugin** | D | Use DT Grafana datasource |
| IoT / Embedded | D | Use OTel |
| Security signals | C → planned P10 | DT Security Investigator |

## 17. Programmability / Extensions

| NR Surface | Band | Reason |
|-----------|------|--------|
| Nerdpacks (custom NR One apps) | D | DT AppEngine (full rewrite) |
| Custom visualizations | D | DT custom viz (rewrite) |
| `nr1` CLI | D | Developer tooling, not config |
| NerdGraph client scripts | D | Customer code against NR API |

## 18. Observability as Code

| NR Surface | Band | Gen3 Target | Engine |
|-----------|------|-------------|--------|
| Terraform `newrelic` provider | D (owner: consuming CLI) | `dynatrace-oss/dynatrace` provider (HCL emission) | out of library scope |
| Dashboards-as-code | A | DT Documents API | dashboard |
| Alerts-as-code | A | DT Workflows + Metric Events | alert |
| CI/CD pipeline migration | D | Customer rewrite |

## 19. FinOps / Cost

| NR Surface | Band | Reason |
|-----------|------|--------|
| Data ingest tracking / usage dashboards / cost tracking | D | DT platform features (DPS usage queries, usage app, bucket attribution) |

## Exit Criteria for 100% Migratability Claim

For the project to claim "everything migratable is covered," all of:

1. No A-band entry is missing a transformer (or compiler path).
2. Every B-band entry emits the Gen3 shape plus enumerated warnings covering every manual decision.
3. Every C-band entry emits the closest Gen3 stand-in plus a warning that names the workaround (Workflow filter, maintenance window, bucket, Notebook, etc.).
4. Every D-band entry has a row in `OUT-OF-SCOPE.md` with a reason, ownership pointer, and (where applicable) external-CLI name.

**As of Phase 13 (2026-04-15) all four exit criteria are met.** Every A and B band entry has a shipped transformer; every C-band entry emits its documented stand-in; every D-band entry has a matching row in `OUT-OF-SCOPE.md`. Historical `→ planned P08/P09/P10` references are preserved for traceability but the underlying work is complete — see `COVERAGE.md` for the live status dashboard.
