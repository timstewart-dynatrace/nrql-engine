# Phase 07 — Re-evaluation & coverage audit
Status: ACTIVE

## Goal
Step back and verify the engine truly covers *everything migratable* from
New Relic to Dynatrace. Produce exhaustive can/cannot documentation,
extend skills + memory, and seed the next set of phases (08+) with
concrete work items.

## Tasks
- [ ] Run broad audit agent against NR product surface + current coverage
- [ ] Produce `docs/MIGRATABILITY.md` — exhaustive "what CAN migrate" inventory
- [ ] Expand `docs/OUT-OF-SCOPE.md` — every "cannot migrate" item with reason
- [ ] Record learnings to memory as `learnings_*.md`
- [ ] Extend durable skill stash with a `nr-to-dt-coverage` skill (optional — depends on template location)
- [ ] Seed PHASE-08 through PHASE-0N-pending.md with concrete tasks from audit backlog
- [ ] Update COVERAGE.md with any newly identified rows

## Acceptance Criteria
- docs/MIGRATABILITY.md exists; every NR surface appears with explicit classification
- OUT-OF-SCOPE.md has a reason for every ⚫ entry
- Memory records: at least one `learnings_*.md` + one `reference_*.md`
- At least 3 new Phase files seeded (08, 09, 10) with tasks pulled from audit
- No 🔴 in COVERAGE.md without a referenced Phase that will close it
