# nrql-engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Disclaimer:** This project is not officially supported by Dynatrace. Community use only.

A shared TypeScript engine for converting New Relic monitoring configurations to Dynatrace. Designed to be consumed by front-end applications like [nrql-translator](https://github.com/timstewart-dynatrace/nrql-translator).

## What This Is

This is a **library/engine**, not a standalone application. It provides:

- **AST-based NRQL-to-DQL compiler** (292 tested patterns)
- **DQL syntax validator and auto-fixer**
- **10 entity transformers** (dashboards, alerts, synthetics, SLOs, etc.)
- **API clients** for New Relic NerdGraph and Dynatrace APIs
- **Live DT environment registry** with metric/entity/dashboard lookups
- **Migration state management** (checkpoint, retry, diff, rollback)

Front-ends (CLI, web UI, Dynatrace app) are provided by consuming projects.

## Usage

```typescript
// Full import (Node.js — includes clients, config, registry, migration)
import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine';

// Browser-safe subpath imports (no Node.js built-ins)
import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine/compiler';
import { DQLSyntaxValidator, DQLFixer } from '@timstewart-dynatrace/nrql-engine/validators';
import { DashboardTransformer } from '@timstewart-dynatrace/nrql-engine/transformers';
```

```typescript
const compiler = new NRQLCompiler();
const result = compiler.compile("SELECT count(*) FROM Transaction WHERE appName = 'my-api' TIMESERIES");

console.log(result.dql);
// // Original NRQL: SELECT count(*) FROM Transaction WHERE appName = 'my-api' TIMESERIES
// fetch spans
// | filter service.name == "my-api"
// | makeTimeseries count()

console.log(result.confidence);     // 'HIGH'
console.log(result.confidenceScore); // 100
console.log(result.notes);          // { dataSourceMapping: [...], ... }
```

## Installation

```bash
npm install
cp .env.example .env  # Edit with your API credentials (for clients/registry)
```

## Development

```bash
npm test              # Run all 838 tests
npm run typecheck     # Type-check with tsc
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Architecture

```
NRQL string → Lexer → Parser → AST → DQL Emitter → DQL string
                                  ↓
                            Validators (syntax check + auto-fix)

NR NerdGraph API → 10 Transformers → DT API clients
                                   → Migration state (checkpoint, retry, diff)
                                   → DT Environment Registry (live validation)
```

## Modules

| Module | Description | Tests |
|--------|-------------|-------|
| `compiler/` | NRQL-to-DQL AST compiler (lexer, parser, emitter) | 292 |
| `validators/` | DQL syntax validator + auto-fixer + utils | 129 |
| `transformers/` | 10 entity transformers + converters + mapping rules | 270 |
| `clients/` | NR NerdGraph + DT API clients (axios) | 58 |
| `config/` | Settings with zod + dotenv | 19 |
| `registry/` | DTEnvironmentRegistry + SLO auditor | 39 |
| `migration/` | State, checkpoint, retry, diff | 31 |
| **Total** | | **838** |

## Entity Transformers

| New Relic | Dynatrace | Transformer |
|-----------|-----------|-------------|
| Dashboard | Dashboard | `DashboardTransformer` |
| Alert Policy | Alerting Profile + Metric Event | `AlertTransformer` |
| Notification Channel | Problem Notification | `NotificationTransformer` |
| Synthetic Monitor | HTTP/Browser Monitor | `SyntheticTransformer` |
| SLO | SLO | `SLOTransformer` |
| Workload | Management Zone | `WorkloadTransformer` |
| Infra Condition | Metric Event | `InfrastructureTransformer` |
| Log Parsing Rule | Processing Rule | `LogParsingTransformer` |
| Tags | Auto-Tag Rules | `TagTransformer` |
| Drop Rules | Ingest Rules | `DropRuleTransformer` |

## CompileResult Interface

```typescript
interface CompileResult {
  success: boolean;
  dql: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number;       // 0-100
  warnings: string[];
  fixes: string[];
  notes: TranslationNotes;       // Categorized for human review
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
