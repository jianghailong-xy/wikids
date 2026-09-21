/**
 * P5.1 API-layer configuration (server-only): user-level rate limits and
 * the request body cap for the game Route Handlers.
 *
 * Read from a fixed environment allowlist (the only names this layer ever
 * consults) so the black-box verifier can tighten the limits for its rate
 * boundary tests; the defaults are the production values. These limits are
 * USER-LEVEL protocol policy — they must never be confused with the
 * provider budgets in lib/games/orchestration/config.ts, which are pure
 * data and never read the environment.
 */

export interface ApiRateConfig {
  /** POST /api/games/sessions creations per user per window. */
  readonly createPerMinute: number;
  /** Action-class requests (actions/advance/abandon) per user per window. */
  readonly actionPerMinute: number;
  /** The sliding window, ms (fixed 60s). */
  readonly windowMs: number;
}

export interface ApiBodyConfig {
  /** Hard cap on a JSON request body, bytes. */
  readonly maxBytes: number;
}

export interface ApiConfig {
  readonly rate: ApiRateConfig;
  readonly body: ApiBodyConfig;
  /** Most concurrent advance calls per session (one; the rest get 429). */
  readonly advanceConcurrency: number;
}

export const API_WINDOW_MS = 60_000;
export const API_MAX_BODY_BYTES_DEFAULT = 16_384;

function readInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`games api config: ${name} must be an integer in ${min}..${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Parse the API-layer config; invalid env values are refused loudly. */
export function readApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  return Object.freeze({
    rate: Object.freeze({
      createPerMinute: readInt(env.GAME_RATE_CREATE_PER_MINUTE, 10, 1, 100_000, "GAME_RATE_CREATE_PER_MINUTE"),
      actionPerMinute: readInt(env.GAME_RATE_ACTION_PER_MINUTE, 120, 1, 100_000, "GAME_RATE_ACTION_PER_MINUTE"),
      windowMs: API_WINDOW_MS,
    }),
    body: Object.freeze({
      maxBytes: readInt(env.GAME_API_MAX_BODY_BYTES, API_MAX_BODY_BYTES_DEFAULT, 1, 1024 * 1024, "GAME_API_MAX_BODY_BYTES"),
    }),
    advanceConcurrency: 1,
  });
}

let cachedConfig: ApiConfig | null = null;

/** The process-wide config, parsed once from the environment. */
export function getApiConfig(): ApiConfig {
  if (cachedConfig === null) {
    cachedConfig = readApiConfig(process.env);
  }
  return cachedConfig;
}
