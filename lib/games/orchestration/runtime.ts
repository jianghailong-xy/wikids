/**
 * Server-only production wiring for the orchestration layer (P4.1, P6.3).
 *
 * Builds the DeepSeek decision engine from the fixed environment allowlist
 * (the same names the P3.3 provider reads — never any other credential) and
 * applies the feature switch:
 *
 * - AI_PROVIDER_ENABLED unset → enabled iff a key is configured;
 * - AI_PROVIDER_ENABLED = "0" / "false" → disabled (the P6.3 emergency
 *   switch; the P4.1 name GAME_AI_ENABLED is still accepted as an alias);
 * - key missing or invalid → disabled.
 *
 * P6.3: the process-wide daily provider budget
 * (GAME_AI_GLOBAL_DAILY_CAP) — required configuration with a safe default;
 * an INVALID value disables the engine (fail-safe degrade). The engine's
 * §7 usage log is routed into the per-decision observer so the per-game
 * token budgets are charged AND the sanitized response metadata is
 * persisted on game_ai_runs.
 *
 * A disabled engine is NOT an error: every AI decision falls back
 * deterministically and the game keeps running to completion (no permanent
 * pending). The engine factory is also the per-request service factory for
 * the Next.js route handlers — the service itself stays injectable and is
 * what the orchestration test suite exercises against the isolated
 * Postgres.
 *
 * This module imports the DeepSeek provider (server-only: node:crypto,
 * process.env, fetch) and must never be imported from a client component.
 */
import "server-only";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { AiProviderError } from "@/lib/ai/errors";
import {
  createDeepSeekProvider,
  readDeepSeekEnvConfig,
  type DeepSeekProviderConfig,
} from "@/lib/ai/providers/deepseek";
import type * as schema from "@/lib/db/schema";
import type { DecisionEngine } from "./engine";
import { disabledDecisionEngine } from "./engine";
import {
  createDailyAttemptMeter,
  readGlobalDailyCap,
  type GlobalAttemptMeter,
} from "./global-budget";
import { GameApplicationService, type GameApplicationServiceOptions } from "./service";

/** The P6.3 emergency-switch environment name. */
export const AI_PROVIDER_ENABLED_KEY = "AI_PROVIDER_ENABLED";

/** The P4.1 feature-switch environment name (still accepted as an alias). */
export const GAME_AI_ENABLED_KEY = "GAME_AI_ENABLED";

/** Reads the switch value: AI_PROVIDER_ENABLED first, then the P4.1 alias. */
function switchRawValue(env: Record<string, string | undefined>): string | undefined {
  const raw = env[AI_PROVIDER_ENABLED_KEY];
  if (raw !== undefined && raw !== "") return raw;
  return env[GAME_AI_ENABLED_KEY];
}

/** True when the switch explicitly turns the provider off. */
export function isAiExplicitlyDisabled(env: Record<string, string | undefined>): boolean {
  const raw = switchRawValue(env);
  if (raw === undefined || raw === "") return false;
  return raw === "0" || raw.toLowerCase() === "false";
}

/** True when the switch explicitly turns the provider on. */
export function isAiExplicitlyEnabled(env: Record<string, string | undefined>): boolean {
  const raw = switchRawValue(env);
  if (raw === undefined || raw === "") return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Reads the DeepSeek config from env; missing/invalid config → null. */
function readProviderConfig(
  env: Record<string, string | undefined>,
): DeepSeekProviderConfig | null {
  try {
    return readDeepSeekEnvConfig(env);
  } catch {
    // Missing key / model / HMAC secret: no provider, deterministic fallback.
    return null;
  }
}

/**
 * The production decision engine:
 * - explicitly disabled switch → disabled engine (fallback for everything);
 * - valid DeepSeek config → the DeepSeek engine, with its §7 usage log
 *   routed into the per-decision observer (token budgets + sanitized run
 *   metadata);
 * - otherwise (no key / bad config) → disabled engine, no error.
 */
export function createDecisionEngineFromEnv(
  env: Record<string, string | undefined> = process.env,
): DecisionEngine {
  if (isAiExplicitlyDisabled(env)) {
    return disabledDecisionEngine();
  }
  const config = readProviderConfig(env);
  if (config === null) {
    return disabledDecisionEngine();
  }
  // One provider per decision: its logger is bound to that decision's
  // observer, so concurrent decisions never mix their token counts.
  return {
    enabled: true,
    decide: async (input, signal, observer) => {
      const provider = createDeepSeekProvider({
        ...config,
        logger: {
          log(record) {
            observer.reportUsage({
              totalTokens: record.totalTokens ?? 0,
              inputTokens: record.inputTokens ?? 0,
              outputTokens: record.outputTokens ?? 0,
              cachedInputTokens: record.cachedInputTokens ?? 0,
            });
            observer.reportRun({
              provider: "deepseek",
              requestedModel: record.requestedModel,
              responseModel: record.responseModel,
              responseId: record.responseId,
              systemFingerprint:
                record.systemFingerprint === "unavailable" ? null : record.systemFingerprint,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              totalTokens: record.totalTokens,
              cachedInputTokens: record.cachedInputTokens,
            });
          },
        },
      });
      return provider.decide(input, signal);
    },
  };
}

/**
 * The process-wide global daily provider budget (P6.3). Shared across
 * every per-request service factory of this process. When the env value is
 * INVALID the caller must disable the engine (fail safe): the games still
 * run to completion through the deterministic fallback.
 */
let globalMeter: GlobalAttemptMeter | null = null;

export function getGlobalAttemptMeter(env: Record<string, string | undefined>): GlobalAttemptMeter | null {
  const cap = readGlobalDailyCap(env);
  if (!cap.ok) return null; // invalid config → caller disables the engine
  if (globalMeter === null || globalMeter.cap !== cap.cap) {
    globalMeter = createDailyAttemptMeter(cap.cap);
  }
  return globalMeter;
}

export interface GameServiceFactory {
  readonly service: GameApplicationService;
  readonly engine: DecisionEngine;
}

/**
 * Build the route-handler service from the injected database. Reads the
 * provider configuration from process.env (the fixed allowlist only) and
 * wires the shared global daily budget meter.
 */
export function createGameService(db: PostgresJsDatabase<typeof schema>): GameServiceFactory {
  const engine = createDecisionEngineFromEnv(process.env);
  const meter = getGlobalAttemptMeter(process.env);
  // An invalid global cap is a configuration failure: degrade deterministically.
  const effectiveEngine =
    meter === null && engine.enabled ? disabledDecisionEngine() : engine;
  const service = new GameApplicationService({
    db,
    engine: effectiveEngine,
    globalMeter: meter ?? undefined,
  } satisfies GameApplicationServiceOptions);
  return { service, engine: effectiveEngine };
}

/** Re-exported for route handlers that must map provider errors to HTTP. */
export { AiProviderError };
