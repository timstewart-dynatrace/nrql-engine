# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-04-10

### Added
- Conditional `exports` in package.json for browser-safe subpath imports
  - `./compiler` — NRQL-to-DQL compiler (no Node.js deps)
  - `./validators` — DQL syntax validator + auto-fixer + utils (no Node.js deps)
  - `./transformers` — 10 entity transformers + mapping rules (no Node.js deps)
- Dynatrace app consumers can now `import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine/compiler'` without pulling in Node.js-only modules (clients, config, registry, migration)

## [0.2.1] - 2026-04-10

### Fixed
- Make dotenv import conditional (Node.js only) so the package works in browser/Vite builds
- Dynatrace app consumers no longer fail on unresolvable Node.js built-ins (fs, path, os, crypto)

## [0.2.0] - 2026-04-10

### Added
- Entity mapping rules tests: 51 tests for EntityMapper, value maps, and nested access (mapping-rules.test.ts)
- NRQL mapping rules tests: 62 tests for EVENT_TYPE_MAP, FUNC_MAP, and FIELD_MAP (nrql-mapping-rules.test.ts)
- SLO auditor tests: 13 tests for metric extraction, DQL validation, and synonym groups (slo-auditor.test.ts)
- Utils validators module: 5 validation functions for NR/DT config and entity structures (utils-validators.ts)
- Utils validators tests: 35 tests for config and entity validation (utils-validators.test.ts)
- Test count: 677 → 838 tests (Python parity, excluding 56 N/A CLI/exporter tests)

## [0.1.0] - 2026-04-09

### Added
- AST-based NRQL-to-DQL compiler with 292 tested patterns (lexer, parser, emitter, orchestrator)
- TranslationNotes and confidenceScore on CompileResult for nrql-translator compatibility
- DQL syntax validator with 20+ invalid pattern checks and anti-pattern detection
- DQL auto-fixer with 22 fix methods (quotes, operators, null checks, LIKE patterns, etc.)
- 10 entity transformers: Dashboard, Alert, Notification, Synthetic, SLO, Workload, Infrastructure, LogParsing, Tag, DropRule
- RegexToDPL converter for capture() function support
- NewRelic NerdGraph API client with pagination and rate limiting
- Dynatrace API client (v2 + config v1 + Documents API) with rate limiting
- Configuration management with zod schemas and dotenv
- DTEnvironmentRegistry for live metric/entity/dashboard/synthetic location validation
- SLO auditor for validating and auto-fixing DQL in Dynatrace SLOs
- Migration state management: RollbackManifest, EntityIdMap, MigrationCheckpoint, IncrementalState
- Failed entity retry with FailedEntities class
- Diff/preview with DiffReport for migration planning
- 677 tests across 16 test files
- Project infrastructure: TypeScript 5+ strict mode, ESM, vitest, tsup
