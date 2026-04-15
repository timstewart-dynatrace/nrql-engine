# Phase 17 — Doc overhaul pass for Phases 15 + 16
Status: ACTIVE

## Goal
Revalidate every markdown file against Phase 15 + 16 deliverables.
Bump test counts (1295 → 1434), transformer counts, module tables;
add the new Phase 15 utilities (`WarningCode`, `looksMigrated`,
`withRetry`, `runAudit`, `ConversionReport`) and Phase 16 modules
(`HttpTransport`, `OAuth2PlatformTokenProvider`, `SettingsV2Client`,
`DocumentClient`, `AutomationClient`, `CanaryPlan`, `runNrdbArchive`,
`EXTENDED_METRIC_MAP`).

## Files to update
- `README.md` — counts + new helper tables
- `.claude/CLAUDE.md` — counts + module table
- `.claude/rules/architecture.md` — add Phase 15/16 sections
- `.claude/rules/testing.md` — counts
- `.claude/rules/deployment.md` — counts
- `docs/COVERAGE.md` — header banner (16 phases)
- `docs/MIGRATABILITY.md` — Phase 17 banner
