# Architecture

## Module Dependency Graph

```
CLI (Commander)
  └── compiler/       ← no deps, port first
  └── validators/     ← regex only
  └── transformers/   ← depends on compiler, validators
  └── clients/        ← depends on config, axios
  └── config/         ← depends on zod, dotenv
  └── registry/       ← depends on clients
  └── migration/      ← depends on transformers
  └── exporters/      ← depends on transformers
```

## NRQL Compiler Pipeline

```
NRQL string
  → Lexer (tokenize)
  → Token[]
  → Parser (recursive descent)
  → AST (Query node with SelectItems, Conditions, etc.)
  → DQLEmitter (walk AST, emit DQL)
  → DQL string
```

**Python source reference:** `/Users/Shared/GitHub/Dynatrace-NewRelic/compiler/`

### AST Node Design

Use TypeScript discriminated unions instead of Python class hierarchy:

```typescript
type ASTNode =
  | { type: 'star' }
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'field'; name: string }
  | { type: 'function'; name: string; args: ASTNode[]; where?: Condition }
  | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'unaryMinus'; expr: ASTNode }
  | { type: 'timeInterval'; value: number; unit: string }
```

## Transformer Interface

All transformers follow this pattern (same as Python):

```typescript
interface TransformResult<T> {
  success: boolean;
  data?: T;
  warnings: string[];
  errors: string[];
}

interface Transformer<TInput, TOutput> {
  transform(input: TInput): TransformResult<TOutput>;
  transformAll(inputs: TInput[]): TransformResult<TOutput>[];
}
```

## Entity Mapping (same as Python)

| New Relic | Dynatrace | Transformer |
|-----------|-----------|-------------|
| Dashboard | Dashboard | DashboardTransformer |
| Alert Policy | Alerting Profile | AlertTransformer |
| Notification | Problem Notification | NotificationTransformer |
| Synthetic Monitor | HTTP/Browser Monitor | SyntheticTransformer |
| SLO | SLO | SLOTransformer |
| Workload | Management Zone | WorkloadTransformer |
| Infra Condition | Metric Event | InfrastructureTransformer |
| Log Rule | Processing Rule | LogParsingTransformer |
| Tags | Auto-Tag Rules | TagTransformer |
| Drop Rules | Ingest Rules | DropRuleTransformer |
