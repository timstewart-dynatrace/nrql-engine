# Architecture

## Module Dependency Graph

```
index.ts (barrel export)
  └── compiler/       ← no deps (consumes EXTENDED_METRIC_MAP + DEFAULT_METRIC_MAP)
  └── validators/     ← regex only
  └── transformers/   ← depends on compiler (Phase 19 uplift + enrichment compile-through)
  └── clients/        ← depends on config, axios, utils/http-retry
  └── config/         ← depends on zod, dotenv
  └── registry/       ← depends on clients
  └── migration/      ← depends on transformers, utils/provenance
  └── tools/          ← depends on nothing (pure-data)
  └── utils/          ← depends on axios (for http-retry); otherwise dep-free
```

## NRQL Compiler Pipeline

```
NRQL string
  → Lexer (tokenize)
  → Token[]
  → Parser (recursive descent)
  → AST (Query node with SelectItems, Conditions, etc.)
  → DQLEmitter (walk AST, emit DQL, consult merged metric map:
               EXTENDED_METRIC_MAP < DEFAULT_METRIC_MAP < caller overrides)
  → Validator (syntax check + auto-fix)
  → applyPhase19Uplift() (positive-signal confidence raiser)
  → CompileResult { dql, confidence, confidenceScore, warnings, fixes, notes }
```

**Python reference:** `/Users/Shared/GitHub/PROJECTS/Dynatrace-NewRelic/compiler/` (the engine diverged substantially from the Python baseline across Phases 01–16; see `.claude/phases/` for history)

## Phase 16 Split Client Stack

```
                        HttpTransport
                     (auth injection +
                      rate limit + retry)
                             ^
                             |
        ┌────────────────────┼────────────────────┐
        |                    |                    |
SettingsV2Client     DocumentClient       AutomationClient
 (Api-Token default;  (OAuth2 default;     (OAuth2 default;
  preferOauth route)   preferOauth route)   preferOauth route)
        ^                    ^                    ^
        └────────────────────┴────────────────────┘
                             |
                       DynatraceClient
                    (existing monolith —
                     back-compat surface)
```

`OAuth2PlatformTokenProvider` supplies `AuthHeaderProvider` for the
OAuth2 path with 60 s refresh margin and concurrent-caller mutex.
`apiTokenAuthProvider(token)` supplies the classic Api-Token header.

### AST Node Design

Use TypeScript discriminated unions instead of a Python-style class hierarchy:

```typescript
type ASTNode =
  | { type: 'star' }
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'field'; name: string }
  | { type: 'function'; name: string; args: ASTNode[]; where?: Condition }
  | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'unaryMinus'; expr: ASTNode }
  | { type: 'timeInterval'; value: number; unit: string }
```

## Transformer Interface

Every transformer returns a `TransformResult<T>`:

```typescript
interface TransformResult<T> {
  success: boolean;
  data?: T;
  warnings: string[];
  errors: string[];
}

interface Transformer<TInput, TOutput> {
  transform(input: TInput): TransformResult<TOutput>;
  transformAll(inputs: TInput[]): TransformResult<TOutput>[];
}
```

Some transformers expose additional methods beyond the core contract (e.g. `transformV2()` for newer NR API shapes, `transformAllV2()` for batch, specialized upgrade methods on `DashboardWidgetUpgradeTransformer`). Consumers should prefer the factory for uniform routing:

```typescript
const t = createTransformer('alert');                 // Gen3 default
const legacy = createTransformer('alert', { legacy: true }); // Gen2 opt-in
```

## Gen3 Entity Mapping (default output)

The following table covers the **Gen3 default** mapping. Legacy output is documented separately under `docs/COVERAGE.md` (each row with a Legacy sibling carries that note) and opt-in via `createTransformer(kind, { legacy: true })`.

| New Relic | Dynatrace Gen3 | Transformer |
|-----------|----------------|-------------|
| Alert Policy + NRQL conditions | Workflow (davis_problem) + Metric Event | `AlertTransformer` |
| APM / Infra / Synth / Browser / Mobile / External Service condition | Metric Event on mapped `builtin:*` | `NonNrqlAlertConditionTransformer` |
| NRQL baseline / outlier condition | `builtin:davis.anomaly-detectors` | `BaselineAlertTransformer` |
| Maintenance window + mute rule | `builtin:alerting.maintenance-window` (rrule supported) | `MaintenanceWindowTransformer` |
| Notification channel (10 providers) | Workflow task config | `NotificationTransformer` |
| Proactive-detection suppression | `builtin:anomaly-detection.davis` | `DavisTuningTransformer` |
| Dashboard | Grail Document | `DashboardTransformer` |
| Heatmap / event-feed / funnel widget | Honeycomb / table / markdown+DQL | `DashboardWidgetUpgradeTransformer` |
| SLO v1 / v2 / v3 | `builtin:monitoring.slo` | `SLOTransformer` |
| Key Transaction | critical-service tag + SLO + Workflow | `KeyTransactionTransformer` |
| Workload | `builtin:segment` (best-effort) | `WorkloadTransformer` |
| Saved filter set / Data App | Notebook payload | `SavedFilterNotebookTransformer` |
| Browser app | `builtin:rum.web.app-detection` | `BrowserRUMTransformer` |
| Mobile app (8 platforms) | `builtin:mobile.app-detection` | `MobileRUMTransformer` |
| Custom event type | Bizevent ingest rule | `CustomEventTransformer` |
| Custom entity | Custom-device POST | `CustomEntityTransformer` |
| `newrelic.*()` call sites | OneAgent SDK / OTel / bizevent suggestions | `CustomInstrumentationTransformer` |
| AWS / Azure / GCP integration | `builtin:cloud.aws` / `.azure` / `.gcp` | `CloudIntegrationTransformer` |
| CloudWatch Metric Streams | `builtin:aws.metric-streams` + Firehose spec | `CloudWatchMetricStreamsTransformer` |
| Kubernetes integration | DynaKube CR | `KubernetesTransformer` |
| Lambda function | `builtin:serverless.function-detection` (per-region ARN) | `LambdaTransformer` |
| Prometheus remote-write / scrape | DT remote-write + `builtin:prometheus.scrape` + relabel rules | `PrometheusTransformer` |
| StatsD | `builtin:statsd.ingest` | `StatsDTransformer` |
| OTel collector | DT OTLP + processor pipeline | `OpenTelemetryCollectorTransformer` |
| OTel direct metrics | DT OTLP metrics + semconv guidance | `OpenTelemetryMetricsTransformer` |
| On-host integration (10 kinds) | Per-extension config | `OnHostIntegrationTransformer` |
| Database monitoring (10 engines) | DT DB extensions + `dt.services.database.*` | `DatabaseMonitoringTransformer` |
| Log parsing rule (Grok) | OpenPipeline DPL extraction | `LogParsingTransformer` |
| Obfuscation rule | OpenPipeline masking + PCRE→DPL | `LogObfuscationTransformer` |
| Log Live Archive + streaming export | Grail bucket + OpenPipeline egress | `LogArchiveTransformer` |
| Drop rule v1 + v2 | OpenPipeline filter / attribute-drop | `DropRuleTransformer` |
| Metric normalization | OpenPipeline metric transforms | `MetricNormalizationTransformer` |
| Lookup table | Grail resource-store upload | `LookupTableTransformer` |
| Synthetic monitor | `builtin:synthetic_test` | `SyntheticTransformer` |
| Certificate check | HTTP monitor with cert validation | `SyntheticCertificateCheckTransformer` |
| Broken links | Browser crawl + DQL detection | `SyntheticBrokenLinksTransformer` |
| Multi-location condition | DQL countDistinctExact(location.id) | `MultiLocationSyntheticTransformer` |
| AIOps workflow (v1 + v2) | Gen3 Workflow with enrichments | `AIOpsTransformer` |
| Users / teams / roles / SAML | DT users + teams + IAM v2 + SAML | `IdentityTransformer` |
| Change events + deployment markers | DT events API payload | `ChangeTrackingTransformer` |
| Infra condition | Metric Event + Workflow | `InfrastructureTransformer` |
| Entity tags | OpenPipeline enrichment | `TagTransformer` |
| Vulnerability Management | RVA + muting + license runbook | `VulnerabilityManagementTransformer` |
| NPM / DDI | SNMP + NetFlow envelopes | `NpmTransformer` |
| AI Monitoring / MLM | AI Observability + bizevent renames | `AiMonitoringTransformer` |
| Security signals | Security Investigator bizevent rules | `SecuritySignalsTransformer` |

## Pure-Data Helpers

Exported from `@timstewart-dynatrace/nrql-engine/transformers`:

| Helper | Purpose |
|--------|---------|
| `createTransformer(kind, { legacy })` | Uniform factory routing to Gen3 or Legacy class |
| `hasLegacyVariant(kind)` | Whether a transformer kind has a Legacy sibling |
| `toMonacoYaml(envelope[], opts?)` | Settings 2.0 envelope → Monaco configuration-as-code YAML |
| `getOtelEnvForDt(options)` | Map of `OTEL_*` env vars for DT OTLP ingest |
| `formatOtelEnvAsDotenv(env)` | `KEY=VALUE` dotenv rendering |
| `pcreToDpl(pattern)` | PCRE regex → DPL/RE2 (with feature-support warnings) |
| `parseRrule(rrule, collector)` | RFC 5545 RRULE → recurrence + daysOfWeek |
| `translateScimFilter(filter)` | NR SCIM v2 filter → DT SCIM attribute renames |
| `applyPhase19Uplift(result, nrql)` | Post-compile positive-signal confidence raiser |
