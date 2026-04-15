# nrql-engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Disclaimer:** This project is not officially supported by Dynatrace. Community use only.

A shared TypeScript engine for converting New Relic monitoring configurations to Dynatrace Gen3. Designed to be consumed by front-end applications like [nrql-translator](https://github.com/timstewart-dynatrace/nrql-translator) and sibling CLIs.

## What This Is

This is a **library/engine**, not a standalone application. It provides:

- **AST-based NRQL-to-DQL compiler** with positive-signal Phase 19 confidence uplift (`apdex` / `COMPARE WITH` / `rate()` / `percentage()`)
- **DQL syntax validator and auto-fixer**
- **46 Gen3 entity transformers** spanning every documented New Relic product surface (APM, RUM, mobile, infra, cloud, synthetics, logs, alerts, AIOps, security, SLOs, dashboards, identity, …)
- **7 opt-in Legacy transformers** emitting classic Gen2 shapes for tenant parity
- **Pure-data helpers** — `createTransformer` factory, `toMonacoYaml`, `getOtelEnvForDt`, `pcreToDpl`, `parseRrule`, `translateScimFilter`
- **API clients** for New Relic NerdGraph and Dynatrace APIs (with `preflightGen3()` + `preflightNewRelic()` capability probes)
- **Live DT environment registry** with metric / entity / dashboard lookups
- **Migration state management** (checkpoint, retry, diff, rollback)

Front-ends (CLI, web UI, Dynatrace app) are provided by consuming projects.

## Usage

```typescript
// Full import (Node.js — includes clients, config, registry, migration)
import { NRQLCompiler, createTransformer } from '@timstewart-dynatrace/nrql-engine';

// Browser-safe subpath imports (no Node.js built-ins)
import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine/compiler';
import { DQLSyntaxValidator, DQLFixer } from '@timstewart-dynatrace/nrql-engine/validators';
import {
  DashboardTransformer,
  createTransformer,
  toMonacoYaml,
  getOtelEnvForDt,
} from '@timstewart-dynatrace/nrql-engine/transformers';
```

```typescript
const compiler = new NRQLCompiler();
const result = compiler.compile(
  "SELECT count(*) FROM Transaction WHERE appName = 'my-api' TIMESERIES",
);

console.log(result.dql);
// // Original NRQL: ...
// fetch spans
// | filter service.name == "my-api"
// | makeTimeseries count()

console.log(result.confidence);      // 'HIGH'
console.log(result.confidenceScore); // 100
console.log(result.notes);           // categorized translation notes
```

### Gen3 default with opt-in Legacy output

```typescript
// Gen3 default — emits a davis_problem-triggered Workflow + Metric Event
const alert = createTransformer('alert');

// Classic Gen2 — emits an Alerting Profile + Metric Event (warns on every call)
const legacyAlert = createTransformer('alert', { legacy: true });
```

## Installation

```bash
npm install @timstewart-dynatrace/nrql-engine
# or, working from source:
npm install
cp .env.example .env  # only needed for clients / registry
```

## Development

```bash
npm test              # Run all 1295 tests
npm run typecheck     # Type-check with tsc
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Architecture

```
NRQL string → Lexer → Parser → AST → DQL Emitter → DQL string
                                  ↓
                            Validators (syntax check + auto-fix)
                                  ↓
                            Phase 19 confidence uplift

NR NerdGraph API → Transformers → DT API clients
                               → Migration state (checkpoint, retry, diff)
                               → DT Environment Registry (live validation)
```

## Modules

| Module | Description | Tests |
|--------|-------------|-------|
| `compiler/` | NRQL-to-DQL AST compiler (lexer, parser, emitter, Phase 19 uplift) | 300+ |
| `validators/` | DQL syntax validator + auto-fixer + utils | 129 |
| `transformers/` | 46 Gen3 transformers + 7 Legacy + factory + pure-data helpers | 700+ |
| `clients/` | NR NerdGraph + DT API clients with preflight probes | 60+ |
| `config/` | Settings with zod + dotenv | 19 |
| `registry/` | DTEnvironmentRegistry + SLO auditor | 39 |
| `migration/` | State, checkpoint, retry, diff | 31 |
| **Total** | **62 test files** | **1295** |

## Entity Transformer Catalog

The engine ships 46 Gen3-default transformer classes. The table below groups them by the NR product surface they cover. See [`docs/COVERAGE.md`](docs/COVERAGE.md) for per-row status and [`docs/MIGRATABILITY.md`](docs/MIGRATABILITY.md) for the classification reasoning.

### Alerting + Notifications
| Transformer | Purpose |
|-------------|---------|
| `AlertTransformer` | NR policy + NRQL conditions → Gen3 Workflow + Metric Event |
| `NonNrqlAlertConditionTransformer` | APM/Infra/Synth/Browser/Mobile/ExternalService conditions → Metric Events |
| `BaselineAlertTransformer` | BASELINE / OUTLIER conditions → Davis anomaly detectors |
| `MaintenanceWindowTransformer` | Scheduled + recurring maintenance windows (with RFC 5545 rrule) |
| `NotificationTransformer` | 10 channels → Gen3 Workflow task configs (policy-routed via v2 `routing`) |
| `DavisTuningTransformer` | Proactive-detection suppression + Golden-Signal tuning |

### Dashboards, SLOs, Workloads
| Transformer | Purpose |
|-------------|---------|
| `DashboardTransformer` | Multi-page dashboards → Grail Document tiles (DQL) |
| `DashboardWidgetUpgradeTransformer` | Heatmap / event-feed / funnel widget upgrades |
| `SLOTransformer` | NR SLO v1 + v2 + v3 → `builtin:monitoring.slo` |
| `KeyTransactionTransformer` | Key Transactions → critical-service tag + SLO + Workflow |
| `WorkloadTransformer` | Workloads → `builtin:segment` (best-effort) |
| `SavedFilterNotebookTransformer` | Saved filter sets + Data Apps → Notebook payloads |

### RUM + mobile + instrumentation
| Transformer | Purpose |
|-------------|---------|
| `BrowserRUMTransformer` | Browser apps → `builtin:rum.web.app-detection` + event mapping |
| `MobileRUMTransformer` | 8 mobile platforms → `builtin:mobile.app-detection` |
| `CustomEventTransformer` | `recordCustomEvent` → bizevent ingest rule |
| `CustomEntityTransformer` | Custom entities → DT custom-device POST |
| `CustomInstrumentationTransformer` | `newrelic.*()` call sites (JS/TS/Python/Java) → SDK suggestions |

### Infrastructure + cloud + ingestion
| Transformer | Purpose |
|-------------|---------|
| `CloudIntegrationTransformer` | AWS / Azure / GCP integration config (per-service fidelity) |
| `CloudWatchMetricStreamsTransformer` | CloudWatch Metric Streams → DT Kinesis Firehose |
| `KubernetesTransformer` | DynaKube CR (full fidelity: CSI / privileged / resources / tolerations) |
| `LambdaTransformer` | Lambda functions with per-region DT layer ARN resolver |
| `PrometheusTransformer` | Remote-write + scrape + all 7 relabel actions |
| `StatsDTransformer` | StatsD ingest via ActiveGate |
| `OpenTelemetryCollectorTransformer` | Collector config + processor pipeline |
| `OpenTelemetryMetricsTransformer` | Direct-OTLP metrics exporter + semconv guidance |
| `OnHostIntegrationTransformer` | 10 on-host integrations (nginx/kafka/postgres/…) |
| `DatabaseMonitoringTransformer` | 10 DB engines → DT DB extensions + `dt.services.database.*` |

### Logs + data management
| Transformer | Purpose |
|-------------|---------|
| `LogParsingTransformer` | Grok → OpenPipeline DPL extraction |
| `LogObfuscationTransformer` | PII/PAN masking + PCRE→DPL translator |
| `LogArchiveTransformer` | Live Archive + streaming exports + Data Plus compliance tags |
| `DropRuleTransformer` | v1 NRQL drop + v2 attribute-scoped (drop/keep-attributes) |
| `MetricNormalizationTransformer` | Rename / scale / convert_unit / derive |
| `LookupTableTransformer` | Lookup tables → Grail resource-store |

### Synthetics
| Transformer | Purpose |
|-------------|---------|
| `SyntheticTransformer` | HTTP / Browser / Scripted API / Scripted Browser monitors |
| `SyntheticCertificateCheckTransformer` | Certificate-check monitors with cert validation rules |
| `SyntheticBrokenLinksTransformer` | Broken-links crawl + DQL detection + Metric Event |
| `MultiLocationSyntheticTransformer` | Multi-location condition (location-count logic) |

### AIOps + identity + change-tracking + specialized
| Transformer | Purpose |
|-------------|---------|
| `AIOpsTransformer` | NR AIOps workflows (v1 + v2) → DT Gen3 Workflows |
| `IdentityTransformer` | Users / teams / roles / SAML + `translateScimFilter` helper |
| `ChangeTrackingTransformer` | Change events + deployment markers → DT events API |
| `InfrastructureTransformer` | Legacy infra conditions → Metric Events wired to Workflow |
| `TagTransformer` | Entity tags → OpenPipeline enrichment |
| `VulnerabilityManagementTransformer` | NR Vuln Mgmt → DT RVA + muting + license runbook |
| `NpmTransformer` | NR NPM / DDI → SNMP + NetFlow envelopes |
| `AiMonitoringTransformer` | NR AI Monitoring / MLM → DT AI Observability |
| `SecuritySignalsTransformer` | NR Security Signals → Security Investigator bizevent rules |

### Legacy (Gen2) opt-in classes

Consumers needing classic Gen2 output (Alerting Profiles, Management Zones, Auto-Tag Rules, classic Problem Notifications, classic dashboards / SLOs / synthetic monitors) select via:

```typescript
createTransformer('alert', { legacy: true });
```

Legacy classes: `LegacyAlertTransformer`, `LegacyNotificationTransformer`, `LegacyTagTransformer`, `LegacyWorkloadTransformer`, `LegacyDashboardTransformer`, `LegacySLOTransformer`, `LegacySyntheticTransformer`. Every legacy call emits a warning.

## CompileResult Interface

```typescript
interface CompileResult {
  success: boolean;
  dql: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number;   // 0-100
  warnings: string[];
  fixes: string[];            // includes phase19: entries when uplift fires
  notes: TranslationNotes;    // Categorized for human review
  error: string;
  ast: Query | undefined;
  originalNrql: string;
}

interface TranslationNotes {
  dataSourceMapping: string[];
  fieldExtraction: string[];
  keyDifferences: string[];
  performanceConsiderations: string[];
  dataModelRequirements: string[];
  testingRecommendations: string[];
}
```

## License

MIT
