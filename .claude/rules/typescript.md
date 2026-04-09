# TypeScript Standards

## Configuration
- `strict: true` in tsconfig.json — non-negotiable
- ES modules (`"type": "module"`)
- Target: ES2022
- Module: NodeNext

## Code Style
- kebab-case file names: `ast-nodes.ts`, `dashboard.transformer.ts`
- PascalCase: classes, interfaces, types, enums
- camelCase: functions, variables, methods
- UPPER_SNAKE_CASE: constants and enum values
- No `any` — use `unknown` and narrow with type guards
- `as` assertions require inline comment explaining why
- Prefer `interface` for data shapes, `class` for behavior
- Use `readonly` on properties that shouldn't change

## Imports
- Named imports only (no `import *`)
- Order: node builtins → third-party → local
- Use `.js` extension in imports (ESM requirement)

## Error Handling
- Return result types (`{ success, data, errors }`) instead of throwing
- Only throw for truly unrecoverable errors (invalid arguments, file not found)
- Type-narrow errors with `instanceof` or discriminated unions

## Patterns

### Discriminated Unions (for AST nodes, conditions, etc.)
```typescript
type Condition =
  | { type: 'comparison'; field: string; op: string; value: ASTNode }
  | { type: 'logical'; op: 'and' | 'or'; left: Condition; right: Condition }
  | { type: 'not'; inner: Condition }
  | { type: 'isNull'; field: string; negated: boolean }
```

### Result Types
```typescript
interface TranslationNotes {
  dataSourceMapping: string[];
  fieldExtraction: string[];
  keyDifferences: string[];
  performanceConsiderations: string[];
  dataModelRequirements: string[];
  testingRecommendations: string[];
}

interface CompileResult {
  success: boolean;
  dql: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number; // 0-100, computed from warnings/complexity
  warnings: string[];
  fixes: string[];
  notes: TranslationNotes; // categorized warnings for human review
  error?: string;
  originalNrql: string;
}
```

### Exhaustive Switch
```typescript
function assertNever(x: never): never {
  throw new Error(`Unexpected: ${x}`);
}

switch (node.type) {
  case 'star': return '*';
  case 'literal': return String(node.value);
  // ...
  default: return assertNever(node);
}
```
