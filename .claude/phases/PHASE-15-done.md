# Phase 15 — Safety + observability parity with Python CLI
Status: DONE

## Goal
Absorb the "safety / observability" cluster from the Python
Dynatrace-NewRelic project. 6 items in dependency order.

## Scheduled (MVP)
- [ ] P15-01 `WarningCode` / `ErrorCode` enum + optional `warningCodes`
      field on `TransformResult` / `CompileResult` (back-compat)
- [ ] P15-12 `migrated.from=newrelic` provenance stamping on every
      Gen3 transformer output (enables P15-02)
- [ ] P15-02 `runAudit()` — post-migration drift detector
      (RENAMED / DELETED / MODIFIED / EXTRA) with `_looksMigrated`
      heuristic
- [ ] P15-03 Diff ORPHAN action + `getOrphans()` accessor
- [ ] P15-07 HTTP retry adapter on DT + NR clients (429 / 5xx +
      exponential backoff)
- [ ] P15-05 `ConversionReport` — JSON + HTML writer (pure-string;
      consumers decide where to write)

## Deferred
- P15-04 CanaryPlan.split() — separate phase
- P15-06 OAuth2 platform-token + split DT client — after v2.0.0 cut
- P15-08 FailedEntities.filterTransformedData() — separate phase
- P15-09 Legacy v1 depth audit — separate phase
- P15-10 nrql_mapping_rules diff — separate phase
- P15-11 NRDB archive — separate phase

## Closed as out-of-scope (Python-only by design)
- P15-13 Agent orchestrators (host ops)
- P15-14 Terraform HCL exporter (consumer territory)

## Acceptance Criteria
- All 6 items landed with tests
- Back-compat: existing `warnings: string[]` remains unchanged
- COVERAGE.md / CHANGELOG updated
- Typecheck + tests green
