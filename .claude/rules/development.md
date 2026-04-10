# Development

## Setup

```bash
git clone https://github.com/timstewart-dynatrace/nrql-engine.git
cd nrql-engine
npm install
cp .env.example .env  # Only needed for clients/registry (API credentials)
```

## Common Tasks

| Task | Command |
|------|---------|
| Run all tests | `npm test` |
| Type-check | `npm run typecheck` |
| Watch tests | `npm run test:watch` |
| Coverage | `npm run test:coverage` |
| Build | `npm run build` |
| Clean | `npm run clean` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ / TypeScript 5+ |
| Config | zod + dotenv |
| Logging | pino |
| HTTP | axios |
| Testing | vitest |
| Build | tsc (ESM) |

## Publishing

```bash
npm run build         # tsc → dist/
npm publish           # Runs prepublishOnly: typecheck + test + build
```

Requires `.npmrc` with GitHub Packages auth token (not committed).

## Module Dependencies

Modules can be used independently. Browser-safe subpath imports avoid Node.js built-ins:

```typescript
// Browser-safe subpath imports (no Node.js deps)
import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine/compiler';
import { DQLSyntaxValidator, DQLFixer } from '@timstewart-dynatrace/nrql-engine/validators';
import { DashboardTransformer } from '@timstewart-dynatrace/nrql-engine/transformers';

// Full import (Node.js only — includes clients, config, registry, migration)
import { NewRelicClient, DynatraceClient, DashboardTransformer } from '@timstewart-dynatrace/nrql-engine';
```
