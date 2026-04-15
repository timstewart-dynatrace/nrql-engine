# Phase 09 — Net-new translators (completeness)
Status: PENDING

## Goal
Close the remaining 🔴 rows in COVERAGE.md that Phase 08 depth passes
don't touch. These are surfaces where a transformer does not yet exist.

## Tasks

- [ ] **P09-01** KeyTransactionTransformer
  - NR Key Transactions → `critical-service` entity tag + companion SLO + Workflow
  - Acceptance: 10 tests; ties to existing AlertTransformer via `nr-migrated` tag
- [ ] **P09-02** Service Levels v3 API shape in SLOTransformer
  - v3 uses `NrqlQuery` + `timeWindow.rolling.count`; add a second input type to SLOTransformer
  - Acceptance: v1/v2 still pass; v3 round-trips
- [ ] **P09-03** Recurring maintenance-window rrule translator
  - Today: ONCE / DAILY / WEEKLY / MONTHLY only. Target: RFC 5545 rrule strings (`FREQ=WEEKLY;BYDAY=...`)
  - Acceptance: 8 recurrence patterns tested
- [ ] **P09-04** Incident Intelligence enrichment full DQL translation
  - AIOpsTransformer emits TODO DQL placeholders for enrichment queries today; compile them through nrql-engine on the way through
  - Acceptance: 15 enrichment queries auto-compile with confidence ≥ MEDIUM
- [ ] **P09-05** OpenTelemetry metrics pipeline (direct OTLP, non-collector)
  - Distinct from otel-collector: direct OTLP metric push with DT semconv mapping
  - Acceptance: emit `builtin:otel.metrics.ingest` settings + mapping rules
- [ ] **P09-06** SCIM filter syntax translator (inside IdentityTransformer)
  - NR SCIM v2 filter expressions → DT SCIM filter syntax
  - Acceptance: 10 filter patterns tested
- [ ] **P09-07** Custom entities → DT custom-device API
  - NR custom entities → DT custom-device entity POST shape
  - Acceptance: 6 tests
- [ ] **P09-08** Synthetic Certificate Check + Broken Links
  - Two variants currently unsupported; emit HTTP monitor with cert validation rules + DQL+alert pair for broken links
  - Acceptance: 8 tests across both

## Acceptance Criteria (Phase)
- All 8 items land or have a documented deferral
- COVERAGE.md 🔴 rows scheduled for Phase 09 flip to ✅
- CHANGELOG entry
- Full suite + typecheck green
