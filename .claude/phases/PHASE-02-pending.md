# Phase 02 — Gen2 Removal (breaking)
Status: PENDING

## Goal
Rewrite all Gen2-emitting transformers to emit Gen3 only. Bump to v1.0.0.

## Tasks (concrete list produced by Phase 01)
- [ ] AlertTransformer → Workflow + Metric Event (Davis anomaly)
- [ ] WorkloadTransformer → bucket-scoped IAM + Grail segments (or ⚫)
- [ ] TagTransformer → OpenPipeline enrichment
- [ ] NotificationTransformer → Workflow action configs
- [ ] DashboardTransformer → verify Grail-native DQL dashboards
- [ ] LogParsingTransformer → verify OpenPipeline processing
- [ ] InfrastructureTransformer → Metric Event wired to Workflow
- [ ] DropRuleTransformer → OpenPipeline drop stage
- [ ] SyntheticTransformer → verify Gen3 monitor shape
- [ ] SLOTransformer → verify Gen3 SLO shape
- [ ] Update tests; delete Gen2 assertions
- [ ] Grep gate: no `alertingProfile|managementZone|autoTag|notificationChannel` in `src/`

## Acceptance Criteria
- `npm test` green with 0 Gen2 output fixtures
- CHANGELOG entry for 1.0.0 with BREAKING notes
- Consumer (nrql-translator) impact documented in release notes
