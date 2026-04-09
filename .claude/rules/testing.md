# Testing

## Framework
- vitest with `describe`/`it` blocks
- Test files: `tests/**/*.test.ts` mirroring `src/` structure

## Running Tests
```bash
npx vitest run              # All tests
npx vitest run compiler     # Compiler tests only
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

## Porting Python Tests

The Python test file at `/Users/Shared/GitHub/Dynatrace-NewRelic/tests/unit/test_compiler.py` has 292 tests across 25+ test classes. Port ALL of them.

Python test pattern:
```python
def test_should_emit_timeseries_for_system_sample(self, compiler):
    result = compiler.compile("SELECT average(cpuPercent) FROM SystemSample TIMESERIES")
    assert result.success
    assert "timeseries" in result.dql
```

TypeScript equivalent:
```typescript
it('should emit timeseries for SystemSample', () => {
  const result = compiler.compile('SELECT average(cpuPercent) FROM SystemSample TIMESERIES');
  expect(result.success).toBe(true);
  expect(result.dql).toContain('timeseries');
});
```

## Coverage Target
- Match Python's 894 tests
- Every module must have tests before moving to the next
- Phase gate: tests + docs required before each commit
