# nrql-engine — Shared NRQL-to-DQL Engine

## Project Goal

Shared TypeScript engine for NR-to-DT migration. Published as `@timstewart-dynatrace/nrql-engine` on GitHub Packages. Consumed by front-end apps like nrql-translator. No CLI or exporters — those live in consuming projects.

Originally ported from the Python NR-to-DT migration tool at `/Users/Shared/GitHub/PROJECTS/Dynatrace-NewRelic/` and has since extended well beyond the Python baseline. See `.claude/phases/` for the 12-phase evolution history.

## Essential Commands

```bash
npm test              # 1295 tests across 62 test files
npm run typecheck     # tsc --noEmit
npm run build         # tsc → dist/
npm publish           # typecheck + test + build + publish
```

## Architecture

```
src/
├── index.ts                    # Barrel export (library entry point)
├── compiler/                   # NRQL-to-DQL AST compiler + Phase 19 uplift
├── validators/                 # DQL syntax validator + auto-fixer
├── transformers/               # 46 Gen3 + 7 Legacy + factory + helpers
├── clients/                    # NR NerdGraph + DT API (with preflight probes)
├── config/                     # Settings (zod + dotenv)
├── registry/                   # Live DT environment validation
└── migration/                  # State management + checkpoint + diff
```

## Module Status (1295 tests across 62 files)

| Module                                                     | Tests |
| ---------------------------------------------------------- | ----- |
| Compiler (lexer, parser, emitter, Phase 19 uplift, corpus) | 300+  |
| Validators (DQL syntax validator + auto-fixer + utils)     | 129   |
| Transformers (46 Gen3 + 7 Legacy + factory + helpers)      | 700+  |
| Clients (NR NerdGraph + DT API + preflight probes)         | 60+   |
| Config (zod schemas + settings)                            | 19    |
| Registry (DTEnvironmentRegistry + SLO auditor)             | 39    |
| Migration (state, checkpoint, retry, diff)                 | 31    |

Phase history: all 12 phases of the implementation plan complete. See
`.claude/phases/PHASE-NN-done.md` for the per-phase work record and
`docs/COVERAGE.md` / `docs/MIGRATABILITY.md` for the current coverage
status.

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

### Always active

@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/dynatrace-dql/SKILL.md
@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/nrql-to-dql/SKILL.md
@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/dynatrace-apis/SKILL.md
@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/dynatrace-document-api/SKILL.md
@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/dynatrace-monaco/SKILL.md
@/Users/Shared/GitHub/PROJECTS/VisualCode-AI-Template/SKILLS/dynatrace-terraform/SKILL.md
