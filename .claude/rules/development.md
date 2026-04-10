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

Modules can be used independently. Only import what you need:

```typescript
// Just the compiler (no HTTP, no config)
import { NRQLCompiler } from '@timstewart-dynatrace/nrql-engine';

// Just the validators
import { DQLSyntaxValidator, DQLFixer } from '@timstewart-dynatrace/nrql-engine';

// Full migration pipeline
import { NewRelicClient, DynatraceClient, DashboardTransformer } from '@timstewart-dynatrace/nrql-engine';
```
