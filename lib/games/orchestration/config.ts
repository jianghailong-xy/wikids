/**
 * Versioned AI-orchestration configuration (P4.1).
 *
 * Every threshold the orchestration enforces — per-decision retries and
 * timeout, per-advance provider-call and concurrency caps, per-game logical
 * call / HTTP attempt / token / round budgets and the per-user active-game
 * budget — lives here, behind one version stamp. A config carrying an
 * unknown version is refused, so a future config change must be published
 * as a new version instead of silently re-interpreting an old one.
 *
 * The config is pure data: the orchestration layer reads it and never
 * consults environment variables (production env wiring lives in
 * lib/games/orchestration/runtime.ts, which is server-only).
 */

/** Frozen orchestration config schema version. */
export const ORCHESTRATION_CONFIG_VERSION = "orchestration-v1";

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
  /** Single per-attempt provider timeout, ms. Timeouts are never retried. */
  readonly timeoutMs: number;
  /** AI claim lease TTL, seconds (expiry decided by database time). */
  readonly leaseTtlSeconds: number;
}

/** Per-advance bounds: one advance performs at most one frozen batch. */
export interface OrchestrationAdvanceConfig {
  /**
   * Frozen batch cap: the most external AI decisions one advance may start.
   * DAY_DISCUSSION is always exactly one (speeches are strictly ordered);
   * NIGHT and DAY_VOTE use up to this many (independent, simultaneously
   * collected submissions).
   */
  readonly maxProviderCallsPerAdvance: number;
  /** Most provider calls one advance may run in flight concurrently. */
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
  /** Provider response tokens per game; further decisions fall back. */
  readonly maxTokens: number;
  /**
   * Rule rounds per game. A game that would play round maxRounds+1 is an
   * abnormal-protection signal (the rules guarantee termination far below):
   * advance refuses loudly with `aborted` — never a forged draw.
   */
  readonly maxRounds: number;
}

/** Per-user budget: concurrent active games. */
export interface OrchestrationUserConfig {
  readonly maxConcurrentGames: number;
}

export interface OrchestrationConfig {
  readonly version: typeof ORCHESTRATION_CONFIG_VERSION;
  readonly provider: OrchestrationProviderConfig;
  readonly advance: OrchestrationAdvanceConfig;
  readonly game: OrchestrationGameBudgetConfig;
  readonly user: OrchestrationUserConfig;
}

/** The production defaults; tests override every threshold via `withConfig`. */
export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  version: ORCHESTRATION_CONFIG_VERSION,
  provider: {
    enabled: true,
    maxRetries: 1,
    timeoutMs: 30_000,
    leaseTtlSeconds: 60,
  },
  advance: {
    // quick6 NIGHT has at most 2 wolves + 1 seer = 3 independent AI seats.
    maxProviderCallsPerAdvance: 3,
    maxConcurrentProviderCalls: 3,
    pendingRetryAfterMs: 250,
  },
  game: {
    // A full quick6 game makes well under 100 decisions; 200 is generous.
    maxLogicalCalls: 200,
    maxHttpAttempts: 100,
    maxTokens: 300_000,
    // quick6-v1 terminates in a handful of rounds; 20 is abnormal protection.
    maxRounds: 20,
  },
  user: {
    maxConcurrentGames: 4,
  },
};

/** Input shape: deep partial overrides over the defaults, version-stamped. */
export type OrchestrationConfigInput = {
  readonly version?: string;
  readonly provider?: Partial<OrchestrationProviderConfig>;
  readonly advance?: Partial<OrchestrationAdvanceConfig>;
  readonly game?: Partial<OrchestrationGameBudgetConfig>;
  readonly user?: Partial<OrchestrationUserConfig>;
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
  };

  assertInteger("provider.maxRetries", config.provider.maxRetries, 0, 5);
  assertInteger("provider.timeoutMs", config.provider.timeoutMs, 1, 600_000);
  assertInteger("provider.leaseTtlSeconds", config.provider.leaseTtlSeconds, 1, 3600);
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
  assertInteger("game.maxTokens", config.game.maxTokens, 1, 100_000_000);
  assertInteger("game.maxRounds", config.game.maxRounds, 1, 10_000);
  assertInteger("user.maxConcurrentGames", config.user.maxConcurrentGames, 1, 1000);

  return Object.freeze({
    version: ORCHESTRATION_CONFIG_VERSION,
    provider: Object.freeze(config.provider),
    advance: Object.freeze(config.advance),
    game: Object.freeze(config.game),
    user: Object.freeze(config.user),
  });
}
