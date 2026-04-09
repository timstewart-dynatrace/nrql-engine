# DMA NewRelic — TypeScript Migration Tool

## Project Goal

Port the Python NR-to-DT migration tool from `/Users/Shared/GitHub/Dynatrace-NewRelic/` to TypeScript. The Python project (v1.2.0) is the **specification** — match its architecture, features, and test coverage.

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
| CLI | Commander.js | Click |
| Output | chalk + cli-table3 | Rich |
| Config | zod + dotenv | Pydantic |
| Logging | pino | structlog |
| HTTP | axios | requests |
| Testing | vitest | pytest |
| Linting | ESLint + Prettier | ruff |
| Build | tsup (ESM) | setuptools |

## Architecture

```
src/
├── index.ts                    # CLI entry point (Commander)
├── cli/                        # Command handlers
├── compiler/                   # NRQL-to-DQL AST compiler (PORT FIRST)
│   ├── tokens.ts               # TokenType enum, Token interface
│   ├── lexer.ts                # NRQLLexer class
│   ├── ast-nodes.ts            # AST node types (use discriminated unions)
│   ├── parser.ts               # NRQLParser (recursive descent)
│   ├── emitter.ts              # DQLEmitter (context-aware DQL generation)
│   └── compiler.ts             # NRQLCompiler (orchestrator)
├── clients/                    # API clients
├── transformers/               # 10 entity transformers
├── validators/                 # DQL syntax validator + auto-fixer
├── registry/                   # Live DT environment validation
├── migration/                  # State management + reports
├── exporters/                  # Monaco + Terraform
├── config/                     # Settings
└── utils/                      # Logging, auth, helpers
```

## Porting Order (do one at a time, with tests)

1. **Compiler** — tokens, lexer, AST nodes, parser, emitter, compiler. This is the core with no external deps. Port the 292 test patterns.
2. **Validators** — DQL validator + fixer. Uses regex only.
3. **Transformers** — Start with types.ts (shared result interfaces), then port each transformer.
4. **Clients** — NR + DT API clients with axios.
5. **Config** — Settings with zod + dotenv.
6. **CLI** — Commander commands.
7. **Registry** — DTEnvironmentRegistry + SLO auditor.
8. **Migration** — State, reports, retry, diff.
9. **Exporters** — Monaco + Terraform.

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
