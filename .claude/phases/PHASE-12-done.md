# Phase 12 — Phase 11 back-port follow-ups
Status: ACTIVE

## Goal
Execute the deferred items from the Phase 11 survey.

## Scheduled
- [ ] P11-07 Uniform `createTransformer(kind, { legacy })` factory
- [ ] P11-08 Audit + port legacy variants (only for shapes that have a meaningful Gen2 form)
- [ ] P11-09 `toMonacoYaml(envelope)` pure-data helper
- [ ] P11-10 `getOtelEnvForDt(tenant, token, service, options?)` helper

## Notes
- Phase 01 audit found that drop-rule / infrastructure / log-parsing
  were Gen3-native from the start (no meaningful Gen2 shape exists);
  only transformers that previously *emitted* Gen2 (alert, notification,
  tag, workload) were given Legacy* classes in Phase 02. P11-08 adds
  legacy shapes for dashboard / slo / synthetic where the classic
  Gen2 JSON differs enough to be useful for parity scenarios.
