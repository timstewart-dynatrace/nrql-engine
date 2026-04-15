# Phase 13 — Documentation overhaul (full revalidation)
Status: ACTIVE

## Goal
Revalidate every markdown file against the actual shipped code and
update/rewrite for accuracy. Strike inconsistencies (stale test
counts, wrong transformer counts, outdated phase references, obsolete
TODOs). Ensure README, CHANGELOG, CLAUDE.md, COVERAGE.md,
MIGRATABILITY.md, OUT-OF-SCOPE.md, and project-structure docs form a
coherent set.

## Tasks
- [ ] Inventory all .md files in the repo (excluding node_modules)
- [ ] Compute ground-truth metrics: test count, transformer count,
      compiler test count, phase statuses
- [ ] Revalidate each .md file against ground truth; list drift
- [ ] Rewrite / update each drifted file
- [ ] Ensure cross-references between docs are coherent
- [ ] Verify all phase files point at the right `-done.md` / `-active.md`
- [ ] Commit the overhaul
