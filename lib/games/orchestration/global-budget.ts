/**
 * Global daily provider budget (P6.3): a process-wide meter over provider
 * attempts per calendar day (UTC). This is the deployment-wide backstop
 * that the per-game / per-user budgets cannot express — when it is
 * exhausted every further provider decision degrades deterministically to
 * the fallback and games keep running to completion.
 *
 * The cap itself comes from the runtime configuration
 * (GAME_AI_GLOBAL_DAILY_CAP, required with a safe default — see
 * lib/games/orchestration/runtime.ts); this module is pure and clock-
 * injectable so tests can exercise the N-1/N/N+1 boundary exactly.
 */

/** The safe default when the runtime configuration does not override it. */
export const GLOBAL_DAILY_CAP_DEFAULT = 10_000;

/** Environment name of the global daily provider-attempt cap. */
export const GLOBAL_DAILY_CAP_ENV_KEY = "GAME_AI_GLOBAL_DAILY_CAP";

export interface GlobalAttemptMeter {
  /** Consume one attempt; false when the daily budget is exhausted. */
  allow(): boolean;
  /** Attempts consumed today (test/observability probe). */
  readonly consumedToday: () => number;
  /** The enforced daily cap. */
  readonly cap: number;
}

/** UTC calendar-day key (YYYY-MM-DD), the meter's reset boundary. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A process-wide daily meter over provider attempts. Deterministic under an
 * injected clock; the counter resets when the UTC day rolls over.
 */
export function createDailyAttemptMeter(
  cap: number,
  now: () => Date = () => new Date(),
): GlobalAttemptMeter {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`global daily cap must be a positive integer, got ${cap}`);
  }
  let day = utcDayKey(now());
  let consumed = 0;
  return {
    allow() {
      const today = utcDayKey(now());
      if (today !== day) {
        day = today;
        consumed = 0;
      }
      if (consumed >= cap) return false;
      consumed += 1;
      return true;
    },
    consumedToday: () => consumed,
    cap,
  };
}

/** Parse the env value; missing/empty → the safe default, invalid → error. */
export function readGlobalDailyCap(
  env: Record<string, string | undefined>,
): { ok: true; cap: number } | { ok: false } {
  const raw = env[GLOBAL_DAILY_CAP_ENV_KEY];
  if (raw === undefined || raw === "") return { ok: true, cap: GLOBAL_DAILY_CAP_DEFAULT };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100_000_000) {
    return { ok: false };
  }
  return { ok: true, cap: value };
}
