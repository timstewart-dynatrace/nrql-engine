# Phase 10 — Specialized products + stretch (final completeness)
Status: PENDING

## Goal
Close the remaining "stretch" 🔴 rows — specialized NR products and
customer-code rewriting paths that require deeper domain work.

## Tasks (specialized products)

- [ ] **P10-01** AI Monitoring / MLM → DT AI Observability mapper
  - Model registry + signal mapping stub; flag token/model rotation as manual
- [ ] **P10-02** Network Performance Monitoring / NPM / DDI → DT Network extensions
  - Topology probe config shape; note that NPM vs DT Network differ in scope
- [ ] **P10-03** Database Monitoring (NRDM) → DT DB extensions + `dt.services.database.*` metric mapping
  - Query-sample migration + metric mapping in compiler's `default-metric-map.ts`
- [ ] **P10-04** Vulnerability Management → DT Application Security (RVA) config
  - Config shell only; vulnerability data itself does not migrate
- [ ] **P10-05** Security signals → DT Security Investigator config

## Tasks (code-translation — out-of-library-scope if too invasive)

- [ ] **P10-06** Custom instrumentation AST translator for Node.js + Python
  - `newrelic.*()` calls → OneAgent SDK / OTel SDK equivalents
  - Acceptance: 80% of calls in a 500-LOC fixture auto-translate; remainder flagged with line-accurate TODOs
- [ ] **P10-07** `newrelic.recordMetric` → OTel Meter API codemod (Node + Python)
- [ ] **P10-08** `newrelic.setTransactionName` → DT request-naming rules emission
- [ ] **P10-09** `newrelic.addCustomAttribute` → OneAgent SDK CRA calls
- [ ] **P10-10** `newrelic.noticeError` → OneAgent SDK error / OTel span event
- [ ] **P10-11** `newrelic.startSegment` / `endSegment` → OTel span API

## Tasks (data management + archive)

- [ ] **P10-12** On-host integrations (MySQL, Postgres, Redis, RabbitMQ, NGINX, Kafka…)
  - NR on-host-agent config → DT extensions / OneAgent plugin config
- [ ] **P10-13** Log Live Archive → Grail cold bucket + retention config
- [ ] **P10-14** Streaming Exports (Kinesis / EH / PubSub) → Grail HTTP egress stub
- [ ] **P10-15** Data Plus tier (retention + HIPAA/PCI/FedRAMP compliance tags)
- [ ] **P10-16** Per-bucket retention + compliance metadata transformer
- [ ] **P10-17** Metric normalization rules → OpenPipeline metric processing

## Tasks (dashboard widget upgrades)

- [ ] **P10-18** Dashboard heatmap widget → DT honeycomb
- [ ] **P10-19** Dashboard event-feed widget → DT table (event sort)
- [ ] **P10-20** Dashboard funnel widget → markdown with pre-built DQL
- [ ] **P10-21** Multi-location synthetic condition location-count logic
- [ ] **P10-22** Saved filter sets + Data Apps → DT Notebooks

## Tasks (specialized alert scenarios)

- [ ] **P10-23** Suppression / Golden Signal tuning → Davis anomaly settings transformer

## Acceptance Criteria (Phase)
- Each P10-NN item lands or is explicitly promoted to ⚫ with reasoning in OUT-OF-SCOPE.md
- No remaining 🔴 rows in COVERAGE.md (every row is ✅, 🟡 with documented plan, or ⚫)
- docs/MIGRATABILITY.md exit-criteria section marks project complete
- v2.0.0 release tagged; companion CLI (Dynatrace-NewRelic Python) updated
