# Testing

## Framework
- vitest with `describe`/`it` blocks
- Test files: `tests/**/*.test.ts` mirroring `src/` structure

## Running Tests
```bash
npx vitest run              # All 1562 tests across 78 files
npx vitest run compiler     # Compiler tests only
npx vitest run tag          # Tests for a specific transformer
npx vitest --watch          # Watch mode
npx vitest --coverage       # Coverage report
```

## Test Naming
```typescript
describe('NRQLCompiler', () => {
  describe('core conversions', () => {
    it('should convert SELECT count(*) FROM Transaction', () => {
      // ...
    });
  });
});
```

## Corpus Regression Harness

`tests/compiler/real-world-corpus.test.ts` holds a curated list of real-world NRQL patterns spanning APM / Browser / Mobile / Infra / Logs / Synthetics / Spans / Operators. Each entry asserts compile confidence ≥ MEDIUM plus expected DQL substrings. Add new problematic patterns here when the compiler is extended.

## Adding a New Transformer

Every new transformer (e.g. `src/transformers/foo.transformer.ts`) gets a matching `tests/transformers/foo.transformer.test.ts`. Minimum cases:

- happy-path success for the most common input
- failure case (invalid input)
- any warning-emitting branch
- defaults for unset optional fields
- `transformAll` batch path if defined

When adding a transformer that has a Legacy sibling, add it to `createTransformer`'s switch (in `factory.ts`) and include it in `LEGACY_SUPPORTED_KINDS`.

## Coverage Target

- All 1562 tests must pass before commit
- `npm run typecheck` must be clean (no `any`, strict mode)
- New modules ship with tests in the same commit
- Phase gate: tests + docs + COVERAGE.md updates required before each phase commit
