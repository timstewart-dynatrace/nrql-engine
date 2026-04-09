# DMA NewRelic — Dynatrace Migration Assistant

[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Disclaimer:** This project is not officially supported by Dynatrace. Community use only.

A TypeScript migration framework for converting New Relic monitoring configurations to Dynatrace. Includes an AST-based NRQL-to-DQL compiler.

## Quick Start

```bash
npm install
cp .env.example .env  # Edit with your credentials

# Compile a single NRQL query
npx dma compile "SELECT count(*) FROM Transaction"

# Interactive REPL
npx dma compile --interactive

# Full migration (dry run)
npx dma migrate --dry-run
```

## Architecture

```
Export (NR NerdGraph) → Transform (10 transformers) → Import (DT APIs)
                                                    → Export (Monaco / Terraform)

NRQL Compiler: NRQL → Lexer → Parser → AST → Emitter → DQL
```

## Status

TypeScript port of [Dynatrace-NewRelic](https://github.com/timstewart-dynatrace/Dynatrace-NewRelic) (Python v1.2.0).

| Module | Status |
|--------|--------|
| Compiler (292 patterns) | Pending |
| Validators | Pending |
| Transformers (10) | Pending |
| Clients (NR + DT) | Pending |
| Registry | Pending |
| Migration infra | Pending |
| Exporters (Monaco + TF) | Pending |
| CLI | Pending |

## License

MIT
