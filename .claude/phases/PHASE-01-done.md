# Phase 01 — Coverage Audit & Gen2 Inventory
Status: ACTIVE

## Goal
Produce `docs/COVERAGE.md` mapping every NR surface to its engine status (✅/🟡/🔴/⚫) and identify every Gen2 emission in the current 10 transformers.

## Tasks
- [ ] Read all 10 transformers, record DT output shape (Gen2 vs Gen3)
- [ ] Cross-reference with `topics/nrlc/docs/COVERAGE-MATRIX.md` row set
- [ ] Write `docs/COVERAGE.md` — one row per NR surface
- [ ] Write `docs/OUT-OF-SCOPE.md` — capabilities outside library scope (agent orchestration, archive export, host operations)
- [ ] List every Gen2 output path with file:line references — this drives Phase 02

## Acceptance Criteria
- COVERAGE.md lists every row from NRLC COVERAGE-MATRIX with engine status
- Every existing transformer has a documented Gen2/Gen3 verdict
- Phase 02 scope (Gen2 removal) is concrete with file-level targets
- No code changes yet — audit only

## Decisions Made This Phase
(append as we go)
