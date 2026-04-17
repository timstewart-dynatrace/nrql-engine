# Deployment

## Release Checklist

- [ ] All tests pass: `npm test` (currently 1562 across 78 files)
- [ ] Type-check clean: `npm run typecheck`
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated — move `[Unreleased]` entries under the new version heading with today's date
- [ ] Feature branch merged to main with `--no-ff`
- [ ] Tagged: `git tag -a vX.Y.Z -m "vX.Y.Z: description"`
- [ ] Published: `npm publish`
- [ ] Consumers updated (nrql-translator, etc.)

## Version Bumping

Follow semver:
- **PATCH** (0.0.X): Bug fixes, test additions, doc updates
- **MINOR** (0.X.0): New features, new modules, new patterns, new transformers (additive)
- **MAJOR** (X.0.0): Breaking API changes (CompileResult shape, default transformer output shape, removed exports)

The branch currently carries accumulated BREAKING output-shape changes in four transformers (alert / notification / tag / workload — see the Phase 02 CHANGELOG entry). The next published version must be v2.0.0.

## Publishing to GitHub Packages

Requires `.npmrc` with auth:
```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
@timstewart-dynatrace:registry=https://npm.pkg.github.com
```

The `prepublishOnly` script ensures quality:
1. `npm run typecheck` — zero type errors
2. `npm test` — all 1562 tests pass
3. `npm run build` — clean `tsc` compilation

## Consumer Update Process

After publishing a new version:
1. In nrql-translator: `npm update @timstewart-dynatrace/nrql-engine`
2. Run the consumer's tests
3. Fix any assertion changes. Consumers that depended on the previous Gen2 output shapes for alert / notification / tag / workload must either:
   - Switch to the Gen3 shape (preferred; see CHANGELOG Phase 02)
   - Opt into legacy via `createTransformer(kind, { legacy: true })`
4. Bump the consumer version
