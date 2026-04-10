# nrql-engine — Shared NRQL-to-DQL Engine

## Project Goal

Shared TypeScript engine for NR-to-DT migration. Published as `@timstewart-dynatrace/nrql-engine` on GitHub Packages. Consumed by front-end apps like nrql-translator. No CLI or exporters — those live in consuming projects.

Ported from the Python NR-to-DT migration tool at `/Users/Shared/GitHub/Dynatrace-NewRelic/` (v1.2.0).

## Essential Commands

```bash
npm test              # 838 tests
npm run typecheck     # tsc --noEmit
npm run build         # tsc → dist/
npm publish           # typecheck + test + build + publish
```

## Architecture

```
src/
├── index.ts                    # Barrel export (library entry point)
├── compiler/                   # NRQL-to-DQL AST compiler (292 patterns)
├── validators/                 # DQL syntax validator + auto-fixer
├── transformers/               # 10 entity transformers + converters
├── clients/                    # API clients (NR NerdGraph + DT)
├── config/                     # Settings (zod + dotenv)
├── registry/                   # Live DT environment validation
└── migration/                  # State management + checkpoint + diff
```

## Module Status (all complete — 838 tests)

| Module | Tests |
|--------|-------|
| Compiler (lexer, parser, emitter, orchestrator) | 292 |
| Validators (DQL syntax validator + auto-fixer + utils) | 129 |
| Transformers (10 entities + converters + mapping rules) | 270 |
| Clients (NR NerdGraph + DT API) | 58 |
| Config (zod schemas + settings) | 19 |
| Registry (DTEnvironmentRegistry + SLO auditor) | 39 |
| Migration (state, checkpoint, retry, diff) | 31 |

## Consumers

- **nrql-translator** — standalone library + CLI + Dynatrace app (PR #1)
- Future projects import from `@timstewart-dynatrace/nrql-engine`

## Decision Log

See `.claude/DECISIONS.md` for architectural decisions and rationale.

## Rules

@.claude/rules/architecture.md
@.claude/rules/typescript.md
@.claude/rules/testing.md
@.claude/rules/development.md
@.claude/rules/deployment.md
