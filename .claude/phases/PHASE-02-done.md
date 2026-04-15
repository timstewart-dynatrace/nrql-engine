# Phase 02 — Gen3 Default + Opt-in Legacy (breaking)
Status: PENDING

## Goal
Default every transformer to Gen3 output. Preserve Gen2 shapes only as opt-in ("legacy" mode) for special-request parity. Expand notification channel coverage. Bump to v1.0.0.

## Design

- **Default = Gen3** for every transformer. No caller change → Gen3 output.
- **Opt-in legacy** via either:
  - A `{ legacy: true }` option on `transform()`, or
  - A sibling class (e.g., `LegacyAlertTransformer`) exporting the old shape
  - Pick one convention for the whole module and apply consistently. Working default: **paired classes** (`AlertTransformer` / `LegacyAlertTransformer`) — simpler tree-shaking for browser consumers, clearer typing of output shapes. Confirm during implementation.
- **Legacy output** always emits a `warning` on `TransformResult` so consumers know they received Gen2.
- **Partial Gen3 mappings** (e.g., Workload → Segment): convert what maps, emit warnings enumerating the manual steps the customer must complete (IAM policy design, bucket scoping, etc.).

## Tasks

### Gen2-leaking transformers (rewrite default to Gen3)
- [ ] AlertTransformer → Gen3 Workflow (`trigger.event.config.davis_problem`) + Metric Event (`builtin:anomaly-detection.metric-events`) wired into the Workflow
  - [ ] LegacyAlertTransformer retains Alerting Profile + Metric Event shape
- [ ] NotificationTransformer → Gen3 Workflow task configs
  - [ ] Existing: email (`dynatrace.email:email-action`), slack (`dynatrace.slack:slack-action`), pagerduty, webhook (`dynatrace.http:http-action`)
  - [ ] **New channels:** OpsGenie, xMatters, Jira, ServiceNow, Teams, VictorOps (all as Workflow HTTP or first-class action types where available)
  - [ ] LegacyNotificationTransformer retains classic `{ProblemTitle}` Problem Notification shape
- [ ] TagTransformer → Gen3 OpenPipeline enrichment (`builtin:openpipeline.logs.pipelines` enrichment stage with DPL expressions)
  - [ ] LegacyTagTransformer retains Auto-Tag Rule shape
- [ ] WorkloadTransformer → best-effort Gen3: `builtin:segment` filter + warnings enumerating manual IAM policy + bucket-scoping work
  - [ ] Warnings categorized under `TranslationNotes.dataModelRequirements`
  - [ ] LegacyWorkloadTransformer retains Management Zone shape

### Gen3-clean transformers (verify only, no default change)
- [ ] DashboardTransformer — confirm all tile types are Grail DATA_EXPLORER with DQL
- [ ] DropRuleTransformer — confirm OpenPipeline ingest rule shape
- [ ] InfrastructureTransformer — confirm Metric Event wired to Workflow (not Alerting Profile)
- [ ] LogParsingTransformer — confirm OpenPipeline ATTRIBUTE_EXTRACTION with DPL
- [ ] SLOTransformer — confirm `builtin:monitoring.slo` shape
- [ ] SyntheticTransformer — confirm `builtin:synthetic_test` shape

### Tests
- [ ] New Gen3 fixtures for every rewritten transformer
- [ ] Retain Gen2 fixtures, re-point to `Legacy*` transformers
- [ ] Assert warning emitted when legacy mode is used
- [ ] Coverage for 6 new notification channels

### Guardrails
- [ ] Grep gate on default transformers: `alertingProfile|managementZone|autoTag|notificationChannel` returns 0 matches in non-legacy source
- [ ] `index.ts` barrel export lists `Legacy*` transformers explicitly so tree-shaking works
- [ ] COVERAGE.md updated: 🟡 Gen2-leak rows → ✅ with "Gen3 default, legacy opt-in" footnote

### Release
- [ ] CHANGELOG entry for 1.0.0 with BREAKING notes + migration guide
- [ ] Document the `Legacy*` opt-in in README
- [ ] Publish 1.0.0 after nrql-translator compatibility verified (Phase 05 covers coordinated release)

## Acceptance Criteria
- Default transformers emit Gen3 only; 0 Gen2 in default output fixtures
- Legacy transformers pass existing Gen2 fixtures unchanged (so consumers can migrate at their own pace)
- All 10 notification channels covered in Gen3 mode
- Every partial-Gen3 conversion emits explicit manual-effort warnings
- `npm test` green
- Consumer migration path documented

## Decisions Made This Phase
(append as we go)
