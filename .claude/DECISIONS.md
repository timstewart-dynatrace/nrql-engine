# Decisions

This file tracks all non-trivial technical decisions made during this project.

---

## 2026-04-09 — Discriminated unions for AST nodes instead of class hierarchy

**Chosen:** TypeScript discriminated unions (`type ASTNode = { type: 'star' } | { type: 'literal'; value: ... } | ...`)
**Alternatives:** Class hierarchy (Python original), interface + `instanceof` checks
**Why:** Better TypeScript ergonomics — exhaustive switch, no runtime overhead, works with `readonly` properties. Pattern matching is more natural than `instanceof` chains.
**Trade-offs:** Slightly more verbose object construction (`{ type: 'function', name, args }` vs `new FunctionCall(name, args)`)
**Revisit if:** Need polymorphic behavior on AST nodes (visitor pattern would favor classes)

---

## 2026-04-09 — ESM-only package (no CJS dual build)

**Chosen:** Pure ESM (`"type": "module"`, `.js` extensions in imports)
**Alternatives:** Dual CJS/ESM with tsup, CJS-only
**Why:** All consumers (nrql-translator, DT app) use modern bundlers that handle ESM. Simpler build (just `tsc`). No conditional exports complexity.
**Trade-offs:** Can't be `require()`'d from CJS. Jest in consumers needs `transformIgnorePatterns` config.
**Revisit if:** A consumer genuinely needs CJS (unlikely for DT ecosystem)

---

## 2026-04-09 — tsc build instead of tsup/esbuild

**Chosen:** Plain `tsc` for compilation
**Alternatives:** tsup (esbuild + dts), rollup
**Why:** tsup failed on TypeScript 6's deprecated `baseUrl` option during DTS generation. `tsc` produces correct `.js` + `.d.ts` + source maps without bundler complexity. Library consumers don't need tree-shaking (they import specific modules).
**Trade-offs:** Output is not minified/bundled — larger `dist/` (938KB unpacked). Multiple files instead of single bundle.
**Revisit if:** Package size becomes a concern for browser consumers

---

## 2026-04-09 — Publish under @timstewart-dynatrace scope

**Chosen:** `@timstewart-dynatrace/nrql-engine` on GitHub Packages
**Alternatives:** `@bhdynatrace/nrql-engine` (Brett's scope), public npmjs.org
**Why:** Don't have write access to `@bhdynatrace` GitHub account. Own scope gives full control. GitHub Packages matches existing nrql-translator publishing pattern.
**Trade-offs:** Different scope than nrql-translator (`@bhdynatrace`). Consumers need `.npmrc` with registry config.
**Revisit if:** Get added to `@bhdynatrace` org, or want to consolidate under one scope

---

## 2026-04-09 — Engine-only library, no CLI/exporters

**Chosen:** Library package with no CLI, no Monaco/Terraform exporters, no report generation
**Alternatives:** Full port of Python project including CLI and exporters
**Why:** Code reuse strategy — nrql-translator provides CLI and UI, future projects provide their own front-ends. Eliminates duplicate CLI/UI code across consumers.
**Trade-offs:** Can't run standalone. Consumers must wrap the engine.
**Revisit if:** Need a quick standalone translation tool (could add a minimal CLI later)

---

## 2026-04-09 — CompileResult includes TranslationNotes for nrql-translator compatibility

**Chosen:** Add `TranslationNotes` and `confidenceScore` to `CompileResult` interface
**Alternatives:** Keep minimal CompileResult, let consumers compute notes/scores
**Why:** nrql-translator's `TranslationResult` interface expects `notes: TranslationNotes`. Matching this shape in the engine means the adapter is trivial (~10 lines of mapping). The scoring logic belongs near the compiler where warning context is available.
**Trade-offs:** Engine has knowledge of consumer-specific interface shapes. Slightly coupled.
**Revisit if:** Multiple consumers need different note/scoring formats
