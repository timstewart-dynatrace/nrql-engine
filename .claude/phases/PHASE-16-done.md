# Phase 16 — Remaining Python parity + OAuth2/split client
Status: ACTIVE

## Goal
Close the last Python parity items. OAuth2 + split-client is BREAKING
but acceptable since v2.0.0 is all-encompassing.

## Scheduled
- [ ] P15-04 `CanaryPlan.split(bucket)` with `canaryPercent` +
      `minCanarySize` + injected approval gate
- [ ] P15-08 `FailedEntities.filterTransformedData()` — batch rebuild
      helper for resume runs
- [ ] P15-11 NRDB archive helper (pure-data; `runQuery` + cursor I/O
      injected by caller)
- [ ] P15-10 `nrql_mapping_rules.py` line-by-line diff + port missing
      METRIC_MAP / ATTR_MAP / EVENT_TYPE_MAP entries
- [ ] P15-06 OAuth2 platform-token provider + split DT client
      (`HttpTransport`, `OAuth2PlatformTokenProvider`, `SettingsV2Client`,
      `DocumentClient`, `AutomationClient` composed by `DynatraceClient`).
      BREAKING — authorized for v2.0.0.

## Acceptance Criteria
- All 5 items landed with tests
- OAuth2 + split-client work integrates `withRetry` from P15-07
- BREAKING release notes updated in CHANGELOG for Phase 16
- Typecheck + tests green
- Commit + push (no merge)
