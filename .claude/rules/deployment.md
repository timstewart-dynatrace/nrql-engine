# Deployment

## Release Checklist

- [ ] All tests pass: `npm test` (838 tests)
- [ ] Type-check clean: `npm run typecheck`
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated
- [ ] Feature branch merged to main with `--no-ff`
- [ ] Tagged: `git tag -a vX.Y.Z -m "vX.Y.Z: description"`
- [ ] Published: `npm publish`
- [ ] Consumers updated (nrql-translator, etc.)

## Version Bumping

Follow semver:
- **PATCH** (0.1.X): Bug fixes, test additions, doc updates
- **MINOR** (0.X.0): New features, new modules, new patterns
- **MAJOR** (X.0.0): Breaking API changes (CompileResult shape, method signatures)

## Publishing to GitHub Packages

Requires `.npmrc` with auth:
```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
@timstewart-dynatrace:registry=https://npm.pkg.github.com
```

The `prepublishOnly` script ensures quality:
1. `npm run typecheck` — zero type errors
2. `npm test` — 677 tests pass
3. `npm run build` — clean `tsc` compilation

## Consumer Update Process

After publishing a new version:
1. In nrql-translator: `npm update @timstewart-dynatrace/nrql-engine`
2. Run nrql-translator's tests: `npm test` (133 tests)
3. Fix any assertion changes (engine output may differ slightly)
4. Bump nrql-translator version
