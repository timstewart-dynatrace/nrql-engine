# Phase 11 — Dynatrace-NewRelic back-ports
Status: DONE

## Goal
Back-port library-appropriate capabilities identified in the
`/Users/Shared/GitHub/PROJECTS/Dynatrace-NewRelic/` Python project
survey (2026-04-15).

## Scheduled (this phase)

- [ ] **P11-01** Phase 19 confidence uplift — positive-signal compiler confidence raiser
- [ ] **P11-02** `CustomInstrumentationTransformer` — `newrelic.*()` → OneAgent SDK / OTel / bizevent suggestions
- [ ] **P11-03** `VulnerabilityManagementTransformer` — RVA settings + muting rules
- [ ] **P11-04** `NpmTransformer` — SNMP / NetFlow envelopes
- [ ] **P11-05** `AiMonitoringTransformer` — AI Observability model registry + bizevent mapping
- [ ] **P11-06** `preflightGen3()` + `preflightNewRelic()` on client classes

## Deferred (follow-ups)
- P11-07 Uniform `createTransformer(kind, { legacy })` factory
- P11-08 Port 5 missing Legacy v1 transformers
- P11-09 `toMonacoYaml(envelope)` pure-data helper
- P11-10 `getOtelEnvForDt()` data helper

## Out of scope (confirmed)
- NRDB archive (host I/O; sibling CLI territory)
- Agents orchestrator host-ops actions
- Monaco/Terraform file emitters

## Acceptance Criteria
- All 6 scheduled items landed with tests
- CHANGELOG [Unreleased] Phase 11 entry
- COVERAGE.md rows flipped for Vulnerability / NPM / AI Monitoring
- Typecheck + tests green
