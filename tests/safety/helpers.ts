/**
 * Shared helpers for the P6.3 game-safety suite (DB-backed tests).
 *
 * Everything is injectable — the suite never touches a real provider:
 * scripted decision engines stand in for DeepSeek, and the service runs
 * against the isolated throwaway Postgres only (tests/safety/setup.ts
 * refuses anything else).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import { AiProviderError } from "@/lib/ai/errors";
import * as schema from "@/lib/db/schema";
import { GameRepository } from "@/lib/games/core";
import {
  GameApplicationService,
  type AdvanceResult,
  type DecisionEngine,
  type DecisionObserver,
  type DecisionRunMeta,
  type GameApplicationServiceOptions,
  type GlobalAttemptMeter,
  type OrchestrationConfigInput,
  type SubmitCommandInput,
} from "@/lib/games/orchestration";
import type { Quick6Command, Quick6StartOptions, SeatId } from "@/lib/games/werewolf";
import { seedBytesFromInt } from "@/lib/games/werewolf";

export const url = process.env.DATABASE_URL as string;

/** Fixed role table: seats 0,1 wolves; seat 2 seer; seats 3-5 villagers. */
export const ROLES = ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"] as const;

export function fixedRoles(humanSeat: SeatId): Quick6StartOptions {
  return { roles: [...ROLES], humanSeat };
}

export interface TestContext {
  client: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
}

export async function openContext(): Promise<TestContext> {
  const client = postgres(url, { max: 10, connect_timeout: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { client, db };
}

let ownerCounter = 0;

export async function makeOwner(db: PostgresJsDatabase<typeof schema>): Promise<string> {
  ownerCounter += 1;
  const inserted = await db
    .insert(schema.users)
    .values({ email: `safety-${ownerCounter}-${Date.now()}@test.local` })
    .returning({ id: schema.users.id });
  return inserted[0].id;
}

export function makeService(
  db: PostgresJsDatabase<typeof schema>,
  options: {
    config?: OrchestrationConfigInput;
    engine?: DecisionEngine | null;
    globalMeter?: GlobalAttemptMeter;
  } = {},
): GameApplicationService {
  return new GameApplicationService({
    db,
    engine: options.engine,
    config: options.config,
    globalMeter: options.globalMeter,
  } satisfies GameApplicationServiceOptions);
}

export function makeRepo(db: PostgresJsDatabase<typeof schema>): GameRepository {
  return new GameRepository(db);
}

// ---------------------------------------------------------------------------
// Scripted engines
// ---------------------------------------------------------------------------

/** An engine that always picks the first legal choice for the seat. */
export function firstChoiceEngine(): DecisionEngine {
  return {
    enabled: true,
    async decide(input: AiTurnInput, _signal?: AbortSignal, _observer?: DecisionObserver) {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "" } satisfies AiDecision;
    },
  };
}

/** An engine that fails with a stable provider error every time. */
export function failingEngine(
  code: AiProviderError["code"] = "UPSTREAM_UNAVAILABLE",
  message = "engine failure",
): DecisionEngine {
  return {
    enabled: true,
    async decide() {
      throw new AiProviderError(code, message);
    },
  };
}

/** An engine that reports full P6.3 metadata and pickable utterances. */
export function metadataEngine(opts: {
  utterance?: (input: AiTurnInput) => string;
  meta?: (input: AiTurnInput) => DecisionRunMeta;
} = {}): DecisionEngine {
  return {
    enabled: true,
    async decide(input: AiTurnInput, _signal?: AbortSignal, observer?: DecisionObserver) {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      observer?.reportUsage({
        totalTokens: 300,
        inputTokens: 250,
        outputTokens: 50,
        cachedInputTokens: 20,
      });
      observer?.reportRun(
        opts.meta?.(input) ?? {
          provider: "deepseek",
          requestedModel: "deepseek-test",
          responseModel: "deepseek-test",
          responseId: `resp-${input.seat}`,
          systemFingerprint: "fp_safety_test",
          inputTokens: 250,
          outputTokens: 50,
          totalTokens: 300,
          cachedInputTokens: 20,
        },
      );
      const utterance = opts.utterance?.(input) ?? "";
      return { choiceId: own[0].id, utterance } satisfies AiDecision;
    },
  };
}

/** An engine that never resolves — only the timeout can end the attempt. */
export function hangEngine(): DecisionEngine {
  return {
    enabled: true,
    async decide() {
      return new Promise<AiDecision>(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Game driving
// ---------------------------------------------------------------------------

export interface AdvanceLoopOptions {
  maxAdvances?: number;
  humanMove?: (
    seat: SeatId,
    result: Extract<AdvanceResult, { status: "waiting_for_human" }>,
  ) => Quick6Command | null;
}

export function simpleHumanMove(
  role: "WOLF" | "SEER" | "VILLAGER" = "VILLAGER",
): AdvanceLoopOptions["humanMove"] {
  return (seat, result) => {
    const alive = result.publicView.aliveSeats;
    switch (result.phase) {
      case "NIGHT": {
        const target =
          role === "WOLF"
            ? (alive.find((s) => s !== seat && s >= 3) ?? alive.find((s) => s !== seat))
            : alive.find((s) => s !== seat);
        if (target === undefined) return null;
        if (role === "SEER") return { type: "SUBMIT_SEER_CHECK", seat, target };
        return { type: "SUBMIT_WOLF_KILL", seat, target };
      }
      case "DAY_DISCUSSION":
        return { type: "SUBMIT_SPEECH", seat, text: null };
      case "DAY_VOTE": {
        const target = alive.find((s) => s !== seat);
        if (target === undefined) return null;
        return { type: "SUBMIT_DAY_VOTE", seat, target };
      }
      default:
        return null;
    }
  };
}

export interface AdvanceLoopResult {
  final: AdvanceResult;
  results: AdvanceResult[];
}

/** Drive a game with bounded advances until finished or aborted. */
export async function runToCompletion(
  service: GameApplicationService,
  ownerId: string,
  sessionId: string,
  options: AdvanceLoopOptions = {},
): Promise<AdvanceLoopResult> {
  const maxAdvances = options.maxAdvances ?? 400;
  const results: AdvanceResult[] = [];
  for (let i = 0; i < maxAdvances; i++) {
    const result = await service.advance(ownerId, sessionId);
    results.push(result);
    if (result.status === "finished" || result.status === "aborted") {
      return { final: result, results };
    }
    if (result.status === "waiting_for_human" && options.humanMove) {
      const command = options.humanMove(result.seat, result);
      if (command !== null) {
        const submitted = await service.submitCommand(ownerId, sessionId, {
          key: `human:${result.phase}:${result.round}:${result.seat}:${i}`,
          command,
          actorSeat: result.seat,
        } satisfies SubmitCommandInput);
        if (!submitted.ok && submitted.error !== "STALE" && submitted.error !== "ILLEGAL") {
          throw new Error(`human move failed: ${JSON.stringify(submitted)}`);
        }
      }
    }
  }
  throw new Error(
    `game did not finish within ${maxAdvances} advances (last: ${JSON.stringify(results[results.length - 1])})`,
  );
}

export { seedBytesFromInt as seedInt };
