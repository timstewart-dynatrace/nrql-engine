# nrql-engine — Shared NRQL-to-DQL Engine

## Project Goal

Shared TypeScript engine for NR-to-DT migration. Published as `@timstewart-dynatrace/nrql-engine` on GitHub Packages. Consumed by front-end apps like nrql-translator. No CLI or exporters — those live in consuming projects.

Originally ported from the Python NR-to-DT migration tool at `/Users/Shared/GitHub/PROJECTS/Dynatrace-NewRelic/` and has since extended well beyond the Python baseline. See `.claude/phases/` for the 16-phase evolution history (plus Phase 17 doc overhaul).

## Essential Commands

```bash
npm test              # 1434 tests across 82 test files
npm run typecheck     # tsc --noEmit
npm run build         # tsc → dist/
npm publish           # typecheck + test + build + publish
```

## Architecture

```
src/
├── index.ts                    # Barrel export (library entry point)
├── compiler/                   # NRQL→DQL AST compiler + Phase 19 uplift
│                               # + DEFAULT_METRIC_MAP + EXTENDED_METRIC_MAP (232 entries)
├── validators/                 # DQL syntax validator + auto-fixer
├── transformers/               # 46 Gen3 + 12 Legacy / Gen2-only + factory + helpers
├── clients/                    # NR NerdGraph + DT API
│                               # + Phase 16 split stack (HttpTransport,
│                               #   OAuth2PlatformTokenProvider, SettingsV2Client,
│                               #   DocumentClient, AutomationClient)
├── config/                     # Settings (zod + dotenv)
├── registry/                   # Live DT environment validation + SLO auditor
├── migration/                  # State + checkpoint + retry + diff (with ORPHAN)
│                               # + Phase 15 runAudit + ConversionReport
│                               # + Phase 16 CanaryPlan
├── tools/                      # NRDB archive helper (pure-data)
└── utils/                      # Phase 15 safety stack — WarningCode / ErrorCode
                                # taxonomies + looksMigrated + withRetry
```

## Module Status (1434 tests across 82 files)

| Module                                                                                        | Tests |
| --------------------------------------------------------------------------------------------- | ----- |
| Compiler (lexer, parser, emitter, Phase 19 uplift, EXTENDED_METRIC_MAP, corpus)                | 325+  |
| Validators (DQL syntax validator + auto-fixer + utils)                                        | 129   |
| Transformers (46 Gen3 + 12 Legacy / Gen2-only + factory + pure-data helpers)                  | 770+  |
| Clients (NR NerdGraph + DT API + preflight probes + Phase 16 HttpTransport / OAuth2 / split)  | 90+   |
| Config (zod schemas + settings)                                                               | 19    |
| Registry (DTEnvironmentRegistry + SLO auditor)                                                | 39    |
| Migration (state, checkpoint, retry, diff + ORPHAN, runAudit, ConversionReport, CanaryPlan)   | 65+   |
| Utils (WarningCode / ErrorCode taxonomy + looksMigrated + withRetry)                          | 35+   |
| Tools (NRDB archive helper)                                                                   | 8     |

Phase history: all 16 phases of the implementation plan complete plus
a Phase 17 doc overhaul. See `.claude/phases/PHASE-NN-done.md` for the
per-phase work record and `docs/COVERAGE.md` / `docs/MIGRATABILITY.md`
for the current coverage status.

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
