# Out of Scope for nrql-engine

> **Purpose:** Document NR capabilities that are intentionally **not** converted by this library and explain why. Consumers (CLIs, Dynatrace apps) or adjacent projects (e.g., `Dynatrace-NewRelic` Python CLI) may address them.
>
> This file complements `COVERAGE.md`. A ⚫ entry there links back to a reason here.

## Categories

### 1. Host / Build-Pipeline Operations

The engine is a pure library: no network side effects, no host access, no long-running state. Anything that requires executing commands on customer hosts, in CI, or against build artifacts is out of scope.

| Capability | Reason | Where it belongs |
|-----------|--------|------------------|
| APM agent uninstall + OneAgent install (Java / .NET / Node / Python / Ruby / PHP / Go) | Requires package-manager + filesystem access on customer hosts | `Dynatrace-NewRelic` (Python CLI) — see that repo's `agents/` module proposal |
| Mobile SDK swap (Android / iOS / React Native / Flutter / Xamarin / Unity / Cordova / Capacitor) | Requires modifying build scripts, Gradle/CocoaPods/npm, rebuilding apps | Customer build pipeline; tooling belongs in a separate CLI |
| Crash symbolication upload (dSYM / ProGuard / R8) | Requires build-artifact access | Customer build pipeline |
| Private synthetic location / minion deployment | Requires ActiveGate deployment on customer infrastructure | Infrastructure tooling |
| NR Flex custom scripts | Custom scripts must be rewritten against OneAgent extensions or OTel — no generic translator exists | Customer engineering |

### 2. Secrets, Tokens, and Credentials

Secrets do not migrate. Any API key, ingest key, license key, OAuth client secret, webhook URL with embedded tokens, or credential vault entry must be **re-provisioned** in Dynatrace; the engine can only emit the shape, not the value.

| Capability | Reason |
|-----------|--------|
| User API keys / Ingest keys / License keys / Browser keys / Mobile keys | Security — tokens are not transferable and are revocable by issuer |
| Secure credentials (NR credential vault) | Vault contents don't migrate; re-enter in DT credentials vault |
| Integration auth (AWS IAM role ARNs, Azure app secrets, GCP service-account JSON) | Customer must re-grant in Dynatrace; role/secret identities differ between clouds' NR and DT integrations |
| Webhook URLs with embedded tokens | Must be regenerated for DT |

### 3. Platform Features (No Config to Migrate)

If a capability is a Dynatrace platform feature that activates automatically or is replaced by a different platform behavior, there is nothing to migrate.

| Capability | DT Equivalent | Reason |
|-----------|---------------|--------|
| Service Map custom annotations | Smartscape (auto-inferred) | Topology is auto-discovered, not user-annotated |
| Error profiles | Davis Problems | Automatic root-cause analysis |
| Error grouping | Fingerprinting | Automatic |
| Error assignments / comments | — | No direct equivalent |
| Thread profiler / X-Ray sessions | DT code profiling | Feature, not a migrable artifact |
| Log patterns (auto-clustering) | DT log pattern recognition | Automatic |
| Live tail | DT log live view | UI feature, no config |
| Entity golden signals | Davis service signals | Automatic |
| Entity health status | Problem severity | Automatic |
| Entity relationships | Smartscape | Auto-discovered |
| NR Decisions (correlation rules) | Davis causal engine | Replaced by automatic correlation |
| Proactive detection (APM auto-baselines) | Davis adaptive baselines | Automatic |
| Issues & incidents | Davis Problems | Automatic |
| Changes dashboard | DT Problems / events correlation | Automatic |
| Change intelligence | Davis causal engine | Automatic |
| Data ingest tracking / usage dashboards / cost tracking | DT DPS usage queries / usage app / bucket attribution | Platform-provided, not a config artifact |

### 4. Historical Data

NRDB event history does not migrate to Grail. Customers who need continuity must run both platforms in parallel during transition, or export NR data to cold storage (S3, BigQuery, Azure Blob) before decommissioning NR.

| Capability | Reason |
|-----------|--------|
| Historical NRDB data | Storage format incompatibility; not bulk-transferable |
| NRDB archive / export (pre-decommission snapshot) | Requires NR Data Export API + long-running state + customer storage target — belongs in a separate tool, not a library |

### 5. Customer-Specific Code Rewrites

Anything that requires translating customer business logic — not just configuration — is out of scope for automation.

| Capability | Reason |
|-----------|--------|
| Nerdpacks (custom NR One apps) | Full React/TS app rewrite against Dynatrace AppEngine |
| Custom NR visualizations | Rewrite as DT custom viz |
| `nr1` CLI workflows | Developer tooling, not config |
| NerdGraph client scripts | Customer code targeting NR API |
| CI/CD pipelines that call NR APIs | Pipeline rewrite against DT APIs |

### 6. No Equivalent on Dynatrace Side

A small set of NR-specific features have no Gen3 equivalent.

| Capability | Notes |
|-----------|-------|
| NR Browser Pro features | No DT equivalent |
| IoT / Embedded agents | Use OTel (customer instrumentation rewrite) |
| Error comments (threaded discussions on errors) | No equivalent |
| Error status (resolved / ignored) per occurrence | DT Problem resolution does not carry per-record resolution state in a migratable form |
| Error assignments / ownership | No per-occurrence assignee concept; use Davis problem ownership tags at a coarser grain |
| User license types (Full / Core / Basic) | DT licensing model differs; not a config migration |
| APM 360 (NR service-level overview UI) | DT Services app is automatic; nothing to migrate |
| NR-Grafana plugin | Use the Dynatrace Grafana datasource directly; no NR-specific migration artifact |
| NR Saved filter sets / favorites / pinned dashboards | UI preferences; not exposed by NR API in a migratable form |
| Changes dashboard / change-intelligence correlation | Davis causal engine is automatic |
| Issue tracker inline comments | Use Workflow → Jira / ServiceNow task (covered by `notification`) |

### 7. Consolidated Secrets Ownership

All of the following share one rule — **secrets do not migrate**. Re-provision the DT-side equivalent and feed the new value into whatever consumes it.

| NR Surface | DT Equivalent (re-provision) |
|-----------|------------------------------|
| User API keys | DT API token (user-scoped) |
| Ingest keys | DT ingest token |
| License keys | OneAgent token |
| Browser keys | DT RUM application ID |
| Mobile keys | DT Mobile application ID |
| SAML signing certificates | DT SAML IdP certificate |
| SCIM tokens | DT SCIM token |
| Integration auth (AWS IAM role ARN, Azure app secret, GCP service-account JSON) | New DT-side role / registration / service account |
| Webhook URLs with embedded tokens | Regenerate against DT |

If a consumer asks why the engine "lost" a token on migration, point here.

### 8. Pre-Decommission Data Export (Ownership Clarification)

Historical NRDB data cannot be ingested into Grail (schema + storage incompatibility). Customers who need continuity must either:

1. **Run both platforms in parallel** during the transition window, or
2. **Export NR data to cold storage** (S3 / GCS / Azure Blob / BigQuery) before decommissioning.

The export itself is a long-running, stateful, credential-holding operation. It lives in the companion **`Dynatrace-NewRelic` Python CLI**, not in this library. This repo intentionally does not accept PRs that add `nrdb-export`-style commands — that surface would couple the library to host I/O and long-running state.

## Recommended Ownership Map

| Scope | Owner |
|-------|-------|
| Pure library: compilers, transformers, validators | **nrql-engine** (this repo) |
| Interactive CLIs for agent orchestration, host operations, export | **Dynatrace-NewRelic** (Python) or new CLI repo |
| Dynatrace app front-end, user flows | **nrql-translator** and future apps |
| IaC emission (Terraform HCL, Monaco YAML) | Consuming CLI; uses this library's transformer output as input |
| Customer build-pipeline tooling (mobile SDK swap, symbolication) | Customer engineering |
