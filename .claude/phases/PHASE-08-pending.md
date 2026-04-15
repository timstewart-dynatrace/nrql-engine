# Phase 08 — Depth passes on shipped transformers
Status: PENDING

## Goal
Upgrade structurally-shipped transformers flagged in the 2026-04-15 audit
from ✅* / 🟡 to a real ✅ with per-field translation, validated against
live DT schemas.

## Source
Phase 07 audit (see `docs/MIGRATABILITY.md`) identified these as
"schema-level ship only — need depth pass." Sorted by priority.

## Tasks (P0 first)

- [ ] **P08-01** Cloud integration deep fidelity (AWS/Azure/GCP)
  - Per-service polling interval, metric-stream vs polling selector, namespace allowlists, AWS region sets, Azure resource-group scopes, GCP multi-project support
  - Acceptance: 15 real NR integration configs round-trip with field-level fidelity
- [ ] **P08-02** Prometheus relabel-rule translator
  - Translate NR `metric_relabel_configs` / `write_relabel_configs` → DT OpenPipeline metric transforms
  - Acceptance: 10 relabel patterns tested
- [ ] **P08-03** OTel collector processor-pipeline translator
  - Handle `processors: [attributes, filter, batch, memory_limiter, ...]` pipelines; emit DT equivalent chain
  - Acceptance: yaml round-trip test + confidence score
- [ ] **P08-04** DynaKube CR full fidelity
  - `privileged`, `hostNetwork`, `csiDriver`, namespace filters, resource limits, `tolerations`, `nodeSelector`
  - Acceptance: kubectl apply --dry-run=server passes; parity table vs NR K8s integration
- [ ] **P08-05** Lambda per-region layer-ARN table
  - Bake a per-region DT layer-ARN lookup so emitted instructions are specific to the function's region
  - Acceptance: all US + EU + APAC regions represented
- [ ] **P08-06** Log obfuscation PCRE→DPL translator
  - Today: customer regex rules pass through unchanged. Target: translate common PCRE constructs to DPL-compatible patterns; flag unsupported features explicitly
  - Acceptance: 20 NR customer rule patterns tested end-to-end
- [ ] **P08-07** Drop Filter Rules v2 (attribute-scoped)
  - Net-new: NR v2 drop rules compile to OpenPipeline attribute-drop processors
  - Acceptance: 12 tests covering attribute-key filtering
- [ ] **P08-08** NR Workflows v2 input shape in AIOpsTransformer
  - v2 (new UI) has different input shape from classic; handle both
  - Acceptance: both shapes accepted; 10 tests per shape
- [ ] **P08-09** CloudWatch Metric Streams (Kinesis) translator
  - Net-new: AWS metric-stream config → DT AWS Metric Streams ingest settings
  - Acceptance: config round-trips + IAM guidance in manualSteps
- [ ] **P08-10** Notification Policies v2 per-policy destination routing
  - Extend NotificationTransformer so each destination can filter on policy name / entity tags
  - Acceptance: routing filter surfaces on each emitted Workflow task

## Acceptance Criteria (Phase)
- All ten work items landed with tests (or explicitly deferred with reason)
- Every COVERAGE.md row previously labeled ✅* or 🟡 for these items flips to plain ✅
- CHANGELOG [Unreleased] entry for Phase 08
- `npm test` green; `npm run typecheck` clean
