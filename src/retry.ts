/**
 * Retry policy. Same reasoning as the Python SDK, so the two behave alike.
 *
 *  - Only 429 and 502/503/504 are retried. A 404 will fail again; a 500 means
 *    an unexpected fault, and hammering it makes an incident worse.
 *  - `Retry-After` beats a guess: the server knows when the window resets.
 *  - Backoff is jittered. Without it, every client refused at the same instant
 *    retries at the same instant and re-creates the overload.
 */

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** A daily allowance does not clear by waiting seconds, so never spin on it. */
export const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set(["QUOTA_EXCEEDED"]);

export interface RetryPolicyOptions {
  maxAttempts?: number;
  initialBackoff?: number;
  maxBackoff?: number;
  multiplier?: number;
  jitter?: number;
}

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoff: number;
  readonly maxBackoff: number;
  readonly multiplier: number;
  readonly jitter: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.initialBackoff = options.initialBackoff ?? 0.5;
    this.maxBackoff = options.maxBackoff ?? 20;
    this.multiplier = options.multiplier ?? 2;
    this.jitter = options.jitter ?? 0.25;
  }

  shouldRetry(attempt: number, statusCode?: number, code?: string): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (code && NON_RETRYABLE_CODES.has(code)) return false;
    return statusCode !== undefined && RETRYABLE_STATUSES.has(statusCode);
  }

  /** Seconds to wait before attempt number `attempt` (1-based). */
  backoff(attempt: number, retryAfter?: number, rand: () => number = Math.random): number {
    if (retryAfter !== undefined && retryAfter >= 0) {
      return Math.min(retryAfter, this.maxBackoff);
    }
    const base = Math.min(
      this.initialBackoff * Math.pow(this.multiplier, Math.max(0, attempt - 1)),
      this.maxBackoff,
    );
    const spread = base * this.jitter;
    return Math.max(0, base + (rand() * 2 - 1) * spread);
  }
}
