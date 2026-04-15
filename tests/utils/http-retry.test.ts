import { describe, it, expect } from 'vitest';
import { withRetry, RetryExhaustedError } from '../../src/utils/http-retry.js';

describe('withRetry', () => {
  it('returns immediately on 2xx', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return { statusCode: 200 };
    });
    expect(result.statusCode).toBe(200);
    expect(attempts).toBe(1);
  });

  it('retries on 429 then succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) return { statusCode: 429 };
        return { statusCode: 200 };
      },
      { backoffFactor: 1, total: 5 },
    );
    expect(result.statusCode).toBe(200);
    expect(attempts).toBe(3);
  });

  it('retries on 500 / 502 / 503 / 504', async () => {
    for (const status of [500, 502, 503, 504]) {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 2) return { statusCode: status };
          return { statusCode: 200 };
        },
        { backoffFactor: 1 },
      );
      expect(result.statusCode).toBe(200);
      expect(attempts).toBe(2);
    }
  });

  it('does not retry on 4xx other than 429', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return { statusCode: 403 };
    });
    expect(result.statusCode).toBe(403);
    expect(attempts).toBe(1);
  });

  it('throws RetryExhaustedError after total retries', async () => {
    await expect(
      withRetry(async () => ({ statusCode: 500 }), { total: 2, backoffFactor: 1 }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
  });

  it('honors Retry-After header (seconds)', async () => {
    let firstCall = true;
    let delay = 0;
    const start = Date.now();
    const result = await withRetry(
      async () => {
        if (firstCall) {
          firstCall = false;
          return {
            statusCode: 429,
            headers: { 'retry-after': '0' }, // 0 seconds → immediate retry
          };
        }
        delay = Date.now() - start;
        return { statusCode: 200 };
      },
      { backoffFactor: 10_000 }, // large backoff; Retry-After=0 should override
    );
    expect(result.statusCode).toBe(200);
    expect(delay).toBeLessThan(1000);
  });

  it('uses exponential backoff when Retry-After missing', async () => {
    // Just verify it doesn't throw and does retry — timing verified indirectly
    // via backoffFactor=1 (1ms base) for fast test.
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) return { statusCode: 503 };
        return { statusCode: 200 };
      },
      { backoffFactor: 1, maxDelayMs: 10 },
    );
    expect(attempts).toBe(3);
  });

  it('custom statusForcelist', async () => {
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) return { statusCode: 418 };
        return { statusCode: 200 };
      },
      { statusForcelist: [418], backoffFactor: 1 },
    );
    expect(attempts).toBe(2);
  });
});
