# Phase 14 — Gen2 fallbacks for D-band items
Status: ACTIVE

## Goal
Close `⚫` / D-band rows in COVERAGE / MIGRATABILITY where classic
Dynatrace (pre-Gen3) offers a path even though Gen3 does not. Ships
as a new family of `Legacy*` transformers that consumers opt into via
the existing `createTransformer(kind, { legacy: true })` factory.

## Scheduled (priority order)
- [ ] P14-01 `LegacyErrorInboxTransformer` — NR Errors-Inbox status /
      comments / assignees → DT classic Problem comments +
      acknowledgements via /api/v2/problems/{id}/comments
- [ ] P14-02 `LegacyNonNrqlAlertConditionTransformer` — APM / Infra /
      Synth / Browser / Mobile / ExternalService conditions →
      Alerting Profile + Metric Event (no Gen3 Workflow wrap)
- [ ] P14-03 `LegacyRequestNamingTransformer` —
      `newrelic.setTransactionName` → `builtin:request-naming.request-naming-rules`
- [ ] P14-04 `LegacyCloudIntegrationTransformer` — classic
      `/api/config/v1/aws/*` / `.../azure/*` / `.../gcp/*` shapes
- [ ] P14-05 `LegacyApdexTransformer` — NR Apdex T-value →
      `builtin:apdex.service-apdex-calculation` per-service override
      (lifts the current LOW-confidence Apdex compiler path)

## Deferred (stretch)
- P14-06 LegacyServiceDetectionTransformer — NR Service-Map
  annotations → `builtin:custom.service-detection-rule`
- P14-07 LegacySavedFilterTransformer — classic v1 dashboard
  saved-filter-set JSON

## Acceptance Criteria
- 5 scheduled transformers shipped with tests
- Each routed through `createTransformer(kind, { legacy: true })`
  where a matching kind exists; new kinds added to the factory for
  error-inbox / request-naming / apdex
- CHANGELOG `[Unreleased]` Phase 14 entry
- COVERAGE.md rows flipped from ⚫ to 🟡 (partial — via legacy-only
  path) with explicit "Gen3: no equivalent; Gen2 legacy covers X"
  footnote
- MIGRATABILITY.md D-band reclassified for the 5 items
- Typecheck + tests green
