# DMA NewRelic — NRQL Engine (Shared Library)

## Project Goal

Shared TypeScript engine for NR-to-DT migration. Consumed by front-end apps like nrql-translator. No CLI or exporters — those live in consuming projects.

Ported from the Python NR-to-DT migration tool at `/Users/Shared/GitHub/Dynatrace-NewRelic/` (v1.2.0).

## Source Project Reference

**Python source:** `/Users/Shared/GitHub/Dynatrace-NewRelic/`

Read the Python source files to understand what each module does before porting. The Python project has:
- AST-based NRQL→DQL compiler (292 tested patterns): `compiler/` directory
- 10 entity transformers: `transformers/` directory
- DTEnvironmentRegistry for live DT validation: `registry/` directory
- Migration infrastructure (rollback, checkpoint, retry, diff, reports): `migration/` directory
- Monaco + Terraform exporters: `exporters/` directory
- API clients (NR NerdGraph + DT APIs): `clients/` directory
- 894 tests across 25 files

## Tech Stack

| Layer | Technology | Python Equivalent |
|-------|-----------|-------------------|
| Runtime | Node.js 18+ / TypeScript 5+ | Python 3.9+ |
| Config | zod + dotenv | Pydantic |
| Logging | pino | structlog |
| HTTP | axios | requests |
| Testing | vitest | pytest |
| Linting | ESLint + Prettier | ruff |
| Build | tsup (ESM) | setuptools |

## Architecture

```
src/
├── index.ts                    # Barrel export (library entry point)
├── compiler/                   # NRQL-to-DQL AST compiler
│   ├── tokens.ts               # TokenType enum, Token interface
│   ├── lexer.ts                # NRQLLexer class
│   ├── ast-nodes.ts            # AST node types (use discriminated unions)
│   ├── parser.ts               # NRQLParser (recursive descent)
│   ├── emitter.ts              # DQLEmitter (context-aware DQL generation)
│   └── compiler.ts             # NRQLCompiler (orchestrator)
├── validators/                 # DQL syntax validator + auto-fixer
├── transformers/               # 10 entity transformers
├── clients/                    # API clients (NR NerdGraph + DT)
├── config/                     # Settings (zod + dotenv)
├── registry/                   # Live DT environment validation
└── migration/                  # State management + checkpoint + diff
```

## Module Status (all complete)

| # | Module | Tests | Status |
|---|--------|-------|--------|
| 1 | Compiler (lexer, parser, emitter, orchestrator) | 292 | Done |
| 2 | Validators (DQL syntax validator + auto-fixer) | 94 | Done |
| 3 | Transformers (10 entities + converters) | 157 | Done |
| 4 | Clients (NR NerdGraph + DT API) | 58 | Done |
| 5 | Config (zod schemas + settings) | 19 | Done |
| 6 | Registry (DTEnvironmentRegistry + SLO auditor) | 26 | Done |
| 7 | Migration (state, checkpoint, retry, diff) | 31 | Done |
| | **Total** | **677** | |

**Not ported (by design — front-ends own these):** CLI, Exporters, Reports.

## TypeScript Conventions

- `strict: true` in tsconfig.json
- ES modules (`"type": "module"` in package.json)
- kebab-case file names (e.g., `ast-nodes.ts`, `dashboard.transformer.ts`)
- PascalCase for classes/interfaces/types, camelCase for functions/variables
- No `any` — use `unknown` and narrow
- Discriminated unions for AST nodes (not class hierarchies)
- Use `interface` for data shapes, `class` for stateful objects
- `readonly` on properties that shouldn't change after construction

## Testing

- Use vitest with `describe`/`it` blocks
- Test file convention: `*.test.ts` in `tests/` mirroring `src/` structure
- Port ALL 292 compiler test patterns from the Python `test_compiler.py`
- Mock HTTP with `vi.mock()` or msw
- Aim for same or better coverage as Python (894 tests)

## Key Differences from Python

- Python's `dataclass` → TypeScript `interface` + factory function or `class`
- Python's `Optional[X]` → TypeScript `X | undefined`
- Python's `Dict[str, Any]` → TypeScript `Record<string, unknown>`
- Python's `re.match` → TypeScript `RegExp.exec()`
- Python f-strings → TypeScript template literals
- Python's `structlog` context → pino child loggers
- Python's `click.testing.CliRunner` → vitest with mock stdio or execa

## Rules

@.claude/rules/architecture.md
@.claude/rules/typescript.md
@.claude/rules/testing.md
