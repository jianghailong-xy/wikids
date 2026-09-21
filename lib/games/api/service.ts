/**
 * P5.1 API-layer service wiring (server-only).
 *
 * Same decision engine as the orchestration runtime (DeepSeek from the
 * fixed environment allowlist, GAME_AI_ENABLED switch, deterministic
 * fallback when absent), with the per-user concurrent-games budget
 * tightened to 1 — the lobby contract "at most one active quick6 game per
 * user". The create route maps the resulting USER_BUDGET_EXHAUSTED to the
 * stable `active_session_exists` conflict.
 *
 * Provider timeouts, upstream 429/5xx, content filters and model budget
 * exhaustion are absorbed by the application layer into the deterministic
 * fallback (P4.1) — they never surface to the client as a stuck phase or a
 * 5xx.
 */
import "server-only";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { ORCHESTRATION_CONFIG_VERSION } from "@/lib/games/orchestration/config";
import { createDecisionEngineFromEnv } from "@/lib/games/orchestration/runtime";
import type { DecisionEngine } from "@/lib/games/orchestration/engine";
import { GameApplicationService } from "@/lib/games/orchestration/service";

export interface ApiGameServiceFactory {
  readonly service: GameApplicationService;
  readonly engine: DecisionEngine;
}

/** Build the route-handler service: engine from env, user cap at 1. */
export function createApiGameService(
  db: PostgresJsDatabase<typeof schema>,
  env: Record<string, string | undefined> = process.env,
): ApiGameServiceFactory {
  const engine = createDecisionEngineFromEnv(env);
  const service = new GameApplicationService({
    db,
    engine,
    config: {
      version: ORCHESTRATION_CONFIG_VERSION,
      user: { maxConcurrentGames: 1 },
    },
  });
  return { service, engine };
}
