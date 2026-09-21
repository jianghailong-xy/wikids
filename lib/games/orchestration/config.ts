/**
 * Versioned AI-orchestration configuration (P4.1, thresholds frozen by P6.3).
 *
 * Every threshold the orchestration enforces — per-decision retries and
 * timeout, per-advance provider-call and concurrency caps, per-game logical
 * call / HTTP attempt / input-token / output-token / round budgets, the
 * per-user active-game / daily-game / daily-logical-call budgets, the
 * global daily provider budget and the retention window — lives here,
 * behind one version stamp. A config carrying an unknown version is
 * refused, so a future config change must be published as a new version
 * instead of silently re-interpreting an old one.
 *
 * P6.3 frozen cost/reliability defaults (orchestration-v2):
 * - 10s per decision, at most 1 transient-only retry;
 * - per game: 40 logical calls, 60 HTTP attempts, 160k input tokens,
 *   12k output tokens, at most 5 provider calls in flight;
 * - per user: 1 active game, 10 games/day, 400 logical calls/day;
 * - global daily provider-attempt budget with a safe default (the runtime
 *   reads it from a required env config, see lib/games/orchestration/runtime.ts);
 * - completed-game retention: 30 days (scripts/cleanup-games.mjs).
 *
 * The config is pure data: the orchestration layer reads it and never
 * consults environment variables (production env wiring lives in
 * lib/games/orchestration/runtime.ts, which is server-only).
 */
import { PROMPT_POLICY_VERSION } from "@/lib/games/safety";

/** Frozen orchestration config schema version (P6.3 thresholds). */
export const ORCHESTRATION_CONFIG_VERSION = "orchestration-v2";

/** Per-decision provider behavior. */
export interface OrchestrationProviderConfig {
  /**
   * Feature switch: when false (or when no provider engine is available —
   * no key), every AI decision goes straight to the deterministic fallback
   * and the game keeps running.
   */
  readonly enabled: boolean;
  /** Transient retries per decision (beyond the first attempt): at most 1. */
  readonly maxRetries: number;
  /** Single per-attempt provider timeout, ms (P6.3: 10s). Timeouts are never retried. */
  readonly timeoutMs: number;
  /** AI claim lease TTL, seconds (expiry decided by database time). */
  readonly leaseTtlSeconds: number;
  /** Prompt-policy version stamped on every persisted AI run. */
  readonly promptVersion: string;
}

/** Per-advance bounds: one advance performs at most one frozen batch. */
export interface OrchestrationAdvanceConfig {
  /**
   * Frozen batch cap: the most external AI decisions one advance may start.
   * DAY_DISCUSSION is always exactly one (speeches are strictly ordered);
   * NIGHT and DAY_VOTE use up to this many (independent, simultaneously
   * collected submissions — quick6 has at most 5 AI seats per batch).
   */
  readonly maxProviderCallsPerAdvance: number;
  /** Most provider calls one advance may run in flight concurrently (P6.3: 5). */
  readonly maxConcurrentProviderCalls: number;
  /** retryAfterMs returned when work remains after a bounded advance. */
  readonly pendingRetryAfterMs: number;
}

/** Per-game budgets. Exhaustion never stalls a game: it forces fallback. */
export interface OrchestrationGameBudgetConfig {
  /** Provider-backed AI decisions per game; further decisions fall back. */
  readonly maxLogicalCalls: number;
  /**
   * HTTP attempts per game. The authoritative enforcement is the atomic
   * claim (ai_budget_consumed < ai_budget_limit in one SQL statement, P3);
   * this value seeds ai_budget_limit and every attempt — including failed
   * and timed-out ones — is charged by the claim itself.
   */
  readonly maxHttpAttempts: number;
  /** Provider INPUT tokens per game (P6.3: 160k); further decisions fall back. */
  readonly maxInputTokens: number;
  /** Provider OUTPUT tokens per game (P6.3: 12k); further decisions fall back. */
  readonly maxOutputTokens: number;
  /**
   * Rule rounds per game. A game that would play round maxRounds+1 is an
   * abnormal-protection signal (the rules guarantee termination far below):
   * advance refuses loudly with `aborted` — never a forged draw.
   */
  readonly maxRounds: number;
}

/** Per-user budget: concurrent active games, games/day, logical calls/day. */
export interface OrchestrationUserConfig {
  readonly maxConcurrentGames: number;
  readonly maxGamesPerDay: number;
  readonly maxLogicalCallsPerDay: number;
}

/** Global budget: process-wide provider attempts per calendar day (P6.3). */
export interface OrchestrationGlobalConfig {
  readonly maxProviderAttemptsPerDay: number;
}

/** Retention: how long finished games and their AI metadata are kept. */
export interface OrchestrationRetentionConfig {
  readonly completedGameDays: number;
}

export interface OrchestrationConfig {
  readonly version: typeof ORCHESTRATION_CONFIG_VERSION;
  readonly provider: OrchestrationProviderConfig;
  readonly advance: OrchestrationAdvanceConfig;
  readonly game: OrchestrationGameBudgetConfig;
  readonly user: OrchestrationUserConfig;
  readonly global: OrchestrationGlobalConfig;
  readonly retention: OrchestrationRetentionConfig;
}

/** The production defaults (P6.3 frozen); tests override thresholds via `withConfig`. */
export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  version: ORCHESTRATION_CONFIG_VERSION,
  provider: {
    enabled: true,
    maxRetries: 1,
    timeoutMs: 10_000,
    leaseTtlSeconds: 60,
    promptVersion: PROMPT_POLICY_VERSION,
  },
  advance: {
    // quick6 has at most 5 AI seats in one batch (DAY_VOTE with the human
    // at one seat); both caps freeze at 5 so a whole batch may run in
    // parallel without ever exceeding the concurrency bound.
    maxProviderCallsPerAdvance: 5,
    maxConcurrentProviderCalls: 5,
    pendingRetryAfterMs: 250,
  },
  game: {
    maxLogicalCalls: 40,
    maxHttpAttempts: 60,
    maxInputTokens: 160_000,
    maxOutputTokens: 12_000,
    // quick6-v1 terminates in a handful of rounds; 20 is abnormal protection.
    maxRounds: 20,
  },
  user: {
    maxConcurrentGames: 1,
    maxGamesPerDay: 10,
    maxLogicalCallsPerDay: 400,
  },
  global: {
    maxProviderAttemptsPerDay: 10_000,
  },
  retention: {
    completedGameDays: 30,
  },
};

/** Input shape: deep partial overrides over the defaults, version-stamped. */
export type OrchestrationConfigInput = {
  readonly version?: string;
  readonly provider?: Partial<OrchestrationProviderConfig>;
  readonly advance?: Partial<OrchestrationAdvanceConfig>;
  readonly game?: Partial<OrchestrationGameBudgetConfig>;
  readonly user?: Partial<OrchestrationUserConfig>;
  readonly global?: Partial<OrchestrationGlobalConfig>;
  readonly retention?: Partial<OrchestrationRetentionConfig>;
};

export class OrchestrationConfigError extends Error {
  constructor(message: string) {
    super(`orchestration config: ${message}`);
    this.name = "OrchestrationConfigError";
  }
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OrchestrationConfigError(`${name} must be an integer in ${min}..${max}, got ${value}`);
  }
}

/**
 * Validate and freeze a config. An absent or unknown version is refused;
 * the frozen default is `DEFAULT_ORCHESTRATION_CONFIG` and every override
 * is validated field by field.
 */
export function normalizeOrchestrationConfig(input: OrchestrationConfigInput = {}): OrchestrationConfig {
  if (input.version !== undefined && input.version !== ORCHESTRATION_CONFIG_VERSION) {
    throw new OrchestrationConfigError(
      `unsupported config version ${JSON.stringify(input.version)} (expected ${ORCHESTRATION_CONFIG_VERSION})`,
    );
  }
  const d = DEFAULT_ORCHESTRATION_CONFIG;
  const config: OrchestrationConfig = {
    version: ORCHESTRATION_CONFIG_VERSION,
    provider: { ...d.provider, ...(input.provider ?? {}) },
    advance: { ...d.advance, ...(input.advance ?? {}) },
    game: { ...d.game, ...(input.game ?? {}) },
    user: { ...d.user, ...(input.user ?? {}) },
    global: { ...d.global, ...(input.global ?? {}) },
    retention: { ...d.retention, ...(input.retention ?? {}) },
  };

  assertInteger("provider.maxRetries", config.provider.maxRetries, 0, 5);
  assertInteger("provider.timeoutMs", config.provider.timeoutMs, 1, 600_000);
  assertInteger("provider.leaseTtlSeconds", config.provider.leaseTtlSeconds, 1, 3600);
  if (typeof config.provider.promptVersion !== "string" || config.provider.promptVersion.length === 0) {
    throw new OrchestrationConfigError("provider.promptVersion must be a non-empty string");
  }
  assertInteger(
    "advance.maxProviderCallsPerAdvance",
    config.advance.maxProviderCallsPerAdvance,
    1,
    32,
  );
  assertInteger(
    "advance.maxConcurrentProviderCalls",
    config.advance.maxConcurrentProviderCalls,
    1,
    32,
  );
  if (config.advance.maxConcurrentProviderCalls > config.advance.maxProviderCallsPerAdvance) {
    throw new OrchestrationConfigError(
      "advance.maxConcurrentProviderCalls must not exceed advance.maxProviderCallsPerAdvance",
    );
  }
  assertInteger("advance.pendingRetryAfterMs", config.advance.pendingRetryAfterMs, 0, 60_000);
  assertInteger("game.maxLogicalCalls", config.game.maxLogicalCalls, 1, 100_000);
  assertInteger("game.maxHttpAttempts", config.game.maxHttpAttempts, 1, 100_000);
  assertInteger("game.maxInputTokens", config.game.maxInputTokens, 1, 100_000_000);
  assertInteger("game.maxOutputTokens", config.game.maxOutputTokens, 1, 100_000_000);
  assertInteger("game.maxRounds", config.game.maxRounds, 1, 10_000);
  assertInteger("user.maxConcurrentGames", config.user.maxConcurrentGames, 1, 1000);
  assertInteger("user.maxGamesPerDay", config.user.maxGamesPerDay, 1, 100_000);
  assertInteger("user.maxLogicalCallsPerDay", config.user.maxLogicalCallsPerDay, 1, 1_000_000);
  assertInteger("global.maxProviderAttemptsPerDay", config.global.maxProviderAttemptsPerDay, 1, 100_000_000);
  assertInteger("retention.completedGameDays", config.retention.completedGameDays, 1, 3650);

  return Object.freeze({
    version: ORCHESTRATION_CONFIG_VERSION,
    provider: Object.freeze(config.provider),
    advance: Object.freeze(config.advance),
    game: Object.freeze(config.game),
    user: Object.freeze(config.user),
    global: Object.freeze(config.global),
    retention: Object.freeze(config.retention),
  });
}
