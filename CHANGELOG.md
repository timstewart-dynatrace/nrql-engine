# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
