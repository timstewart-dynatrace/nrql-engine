# Phase 04 — Compiler Gap Fill & Non-NRQL Alert Translation
Status: DONE

## Goal
Close remaining NRQL pattern gaps and add non-NRQL alert condition support (Infra/Synth/Browser/Mobile → DQL + Metric Event + Workflow).

## Tasks
- [ ] Non-NRQL alert condition translator (E-09)
- [ ] Baseline / outlier alert translation (E-14)
- [ ] Maintenance window + mute rule → Workflow suppression (E-16)
- [ ] Run compiler against real-world NRQL corpus; add patterns until coverage plateaus

## Acceptance Criteria
- COVERAGE.md shows 0 🔴 rows (remaining are ⚫ not-convertible with documented reasons)
- Compiler corpus tests capture added patterns
