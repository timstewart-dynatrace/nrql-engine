# Phase 06 — Compiler metric-name rewriting for infra
Status: ACTIVE

## Goal
Close the compiler quality gap the Phase 04 corpus surfaced: NRQL
queries against SystemSample / ProcessSample emit the NR metric name
literally (`avg(cpuPercent)`) rather than the DT builtin metric
(`avg(dt.host.cpu.usage)`). Fix it at the compiler so every consumer
benefits, not just alert transformers.

## Tasks
- [ ] Locate the emitter path that handles `timeseries` aggregations
- [ ] Add INFRA_METRIC_MAP lookup at emit time (SystemSample / ProcessSample field → DT metric key)
- [ ] Ensure existing 292 compiler tests stay green (may need expectation updates)
- [ ] Update tests/compiler/real-world-corpus.test.ts to assert the rewritten metric
- [ ] CHANGELOG entry + COVERAGE row flip for the Apdex/Infra 🟡 rows where applicable

## Acceptance Criteria
- `SELECT average(cpuPercent) FROM SystemSample` → `timeseries avg(dt.host.cpu.usage)` (or equivalent DT metric)
- No regression in compiler test suite
- Corpus stays green
