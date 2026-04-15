/**
 * HTTP retry helper (P15-07).
 *
 * Back-port of Python `urllib3.Retry(total=3, backoff_factor=1,
 * status_forcelist=[429,500,502,503,504])`. Usable from any call-site
 * that yields a `Promise<Response>` where the response carries a
 * `statusCode` (integer) and optional `headers` map.
 *
 * Policy:
 *   - Retry on HTTP 429 or any 5xx in the `statusForcelist`.
 *   - Exponential backoff: `delay = backoffFactor * (2 ** attempt)` ms,
 *     capped at `maxDelayMs`. Jitter applied.
 *   - Respect `Retry-After` header on 429 when present (seconds or
 *     HTTP date).
 *   - Hard stop at `total` retries.
 *   - Throws `RetryExhaustedError` after `total` retries so the caller
 *     knows to surface `WarningCode.RETRY_EXHAUSTED`.
 */

export interface RetryPolicy {
  readonly total?: number;
  readonly backoffFactor?: number;
  readonly maxDelayMs?: number;
  readonly statusForcelist?: ReadonlyArray<number>;
  /** Optional signal for caller to abort in-flight retries. */
  readonly signal?: AbortSignal;
}

export interface RetryableResponse {
  readonly statusCode: number;
  readonly headers?: Record<string, string | undefined>;
}

export class RetryExhaustedError extends Error {
  readonly lastStatus: number;
  readonly attempts: number;
  constructor(lastStatus: number, attempts: number) {
    super(`HTTP retry exhausted after ${attempts} attempts; last status ${lastStatus}`);
    this.name = 'RetryExhaustedError';
    this.lastStatus = lastStatus;
    this.attempts = attempts;
  }
}

const DEFAULT_STATUS_FORCELIST: ReadonlyArray<number> = [429, 500, 502, 503, 504];
const DEFAULT_TOTAL = 3;
const DEFAULT_BACKOFF_FACTOR_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, DEFAULT_MAX_DELAY_MS);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delay = date - Date.now();
    if (delay > 0) return Math.min(delay, DEFAULT_MAX_DELAY_MS);
  }
  return undefined;
}

function computeDelay(
  attempt: number,
  backoffFactor: number,
  maxDelayMs: number,
): number {
  const base = backoffFactor * 2 ** attempt;
  const withJitter = base * (0.75 + Math.random() * 0.5);
  return Math.min(withJitter, maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    });
  });
}

/**
 * Invoke `fn` with retry on 429 / 5xx. Returns the final
 * `RetryableResponse` (success or last failure).
 */
export async function withRetry<R extends RetryableResponse>(
  fn: (attempt: number) => Promise<R>,
  policy?: RetryPolicy,
): Promise<R> {
  const total = policy?.total ?? DEFAULT_TOTAL;
  const backoffFactor = policy?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR_MS;
  const maxDelayMs = policy?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const statusForcelist = policy?.statusForcelist ?? DEFAULT_STATUS_FORCELIST;

  let lastResponse: R | undefined;
  for (let attempt = 0; attempt <= total; attempt++) {
    const response = await fn(attempt);
    lastResponse = response;
    if (!statusForcelist.includes(response.statusCode)) {
      return response;
    }
    if (attempt >= total) break;
    const retryAfter = parseRetryAfter(response.headers?.['retry-after']);
    const delay = retryAfter ?? computeDelay(attempt, backoffFactor, maxDelayMs);
    await sleep(delay, policy?.signal);
  }

  throw new RetryExhaustedError(lastResponse?.statusCode ?? 0, total + 1);
}
