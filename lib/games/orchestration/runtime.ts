/**
 * Server-only production wiring for the orchestration layer (P4.1).
 *
 * Builds the DeepSeek decision engine from the fixed environment allowlist
 * (the same names the P3.3 provider reads — never any other credential) and
 * applies the feature switch:
 *
 * - GAME_AI_ENABLED unset → enabled iff a key is configured;
 * - GAME_AI_ENABLED = "0" / "false" → disabled (switch off);
 * - key missing or invalid → disabled.
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
import { GameApplicationService, type GameApplicationServiceOptions } from "./service";

/** The only environment name the feature switch reads. */
export const GAME_AI_ENABLED_KEY = "GAME_AI_ENABLED";

/** True when the switch explicitly turns the provider off. */
export function isAiExplicitlyDisabled(env: Record<string, string | undefined>): boolean {
  const raw = env[GAME_AI_ENABLED_KEY];
  if (raw === undefined || raw === "") return false;
  return raw === "0" || raw.toLowerCase() === "false";
}

/** True when the switch explicitly turns the provider on. */
export function isAiExplicitlyEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env[GAME_AI_ENABLED_KEY];
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
 *   routed into the per-decision usage reporter so the token budget is
 *   charged per game;
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
  // usage reporter, so concurrent decisions never mix their token counts.
  return {
    enabled: true,
    decide: async (input, signal, reportUsage) => {
      const provider = createDeepSeekProvider({
        ...config,
        logger: {
          log(record) {
            reportUsage({ totalTokens: record.totalTokens ?? 0 });
          },
        },
      });
      return provider.decide(input, signal);
    },
  };
}

export interface GameServiceFactory {
  readonly service: GameApplicationService;
  readonly engine: DecisionEngine;
}

/**
 * Build the route-handler service from the injected database. Reads the
 * provider configuration from process.env (the fixed allowlist only).
 */
export function createGameService(db: PostgresJsDatabase<typeof schema>): GameServiceFactory {
  const engine = createDecisionEngineFromEnv(process.env);
  const service = new GameApplicationService({
    db,
    engine,
  } satisfies GameApplicationServiceOptions);
  return { service, engine };
}

/** Re-exported for route handlers that must map provider errors to HTTP. */
export { AiProviderError };
