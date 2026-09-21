/**
 * P5.1 user-level rate limiting and per-session advance concurrency.
 *
 * Both are in-memory, per-process structures. That is correct for the
 * deployment this version targets — the persistent Docker Node runtime
 * (one process serves the API; the P4.1 layer makes no claim of support
 * for short-lived serverless runtimes) — and it keeps the boundaries
 * deterministic for the black-box verifier.
 *
 * Semantics (the ONLY sanctioned uses of API 429):
 * - user-level frequency limits on create-class and action-class requests;
 * - per-session concurrency limiting on advance (one in flight).
 * Provider budget exhaustion never surfaces here — the application service
 * absorbs it into the deterministic fallback (P4.1).
 */

/** One sliding window of hits per (kind, user) key. */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consume one request; false when the window is full (nothing recorded). */
  allow(key: string, limit: number): boolean {
    if (!Number.isFinite(limit) || limit <= 0) return true;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** How long until the oldest hit leaves the window (0 = never limited). */
  retryAfterMs(key: string): number {
    const hits = this.hits.get(key) ?? [];
    const oldest = hits[0];
    if (oldest === undefined) return 0;
    return Math.max(1, this.windowMs - (this.now() - oldest));
  }
}

/** A counter guard: at most `limit` concurrent holders per key. */
export class ConcurrencyGuard {
  private readonly active = new Map<string, number>();

  constructor(private readonly limit: number) {}

  tryAcquire(key: string): boolean {
    const current = this.active.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.active.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.active.get(key) ?? 1;
    if (current <= 1) this.active.delete(key);
    else this.active.set(key, current - 1);
  }
}

// ---------------------------------------------------------------------------
// Process-wide instances (the persistent Node runtime)
// ---------------------------------------------------------------------------

let rateLimiter: SlidingWindowRateLimiter | null = null;
let advanceGuard: ConcurrencyGuard | null = null;

/** The process-wide user rate limiter (60s sliding windows). */
export function getRateLimiter(): SlidingWindowRateLimiter {
  if (rateLimiter === null) {
    rateLimiter = new SlidingWindowRateLimiter(60_000);
  }
  return rateLimiter;
}

/** The process-wide per-session advance guard (one in flight). */
export function getAdvanceGuard(concurrency: number): ConcurrencyGuard {
  if (advanceGuard === null) {
    advanceGuard = new ConcurrencyGuard(concurrency);
  }
  return advanceGuard;
}
