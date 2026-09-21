/**
 * Shared helpers for the P4.1 orchestration suite.
 *
 * Everything here is injectable — the suite never touches a real provider:
 * scripted, failing, slow, token-counting and concurrency-tracking decision
 * engines stand in for the DeepSeek provider, and the service runs against
 * the isolated throwaway Postgres only.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import { AiProviderError, type AiErrorCode } from "@/lib/ai/errors";
import * as schema from "@/lib/db/schema";
import { GameRepository } from "@/lib/games/core";
import type { PersistedEvent } from "@/lib/games/core";
import {
  GameApplicationService,
  type AdvanceResult,
  type DecisionEngine,
  type DecisionRunMeta,
  type GameApplicationServiceOptions,
  type OrchestrationConfigInput,
  type SubmitCommandInput,
} from "@/lib/games/orchestration";
import { replayQuick6 } from "@/lib/games/werewolf";
import type {
  Quick6Command,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  SeatId,
} from "@/lib/games/werewolf";
import { seedBytesFromInt } from "@/lib/games/werewolf";

export const url = process.env.DATABASE_URL as string;

// Fixed role table: seats 0,1 wolves; seat 2 seer; seats 3-5 villagers.
export const ROLES = ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"] as const;

export function fixedRoles(humanSeat: SeatId): Quick6StartOptions {
  return { roles: [...ROLES], humanSeat };
}

export function makeRepo(db: PostgresJsDatabase<typeof schema>): GameRepository {
  return new GameRepository(db);
}

/** The repository replay used by the service and by the test probes. */
export function replayOf() {
  return (
    seedBytes: Uint8Array,
    options: unknown,
    events: readonly PersistedEvent[],
  ): Quick6State =>
    replayQuick6(
      seedBytes,
      events.map((event, index) => {
        if (event.seq !== index) {
          throw new Error(`non-contiguous persisted event seq ${event.seq} at position ${index}`);
        }
        return { index: event.seq, revision: event.revision, payload: event.payload as Quick6EventPayload };
      }),
      options as Quick6StartOptions | undefined,
    );
}

// ---------------------------------------------------------------------------
// Database wiring
// ---------------------------------------------------------------------------

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

/** A fresh owner (isolated budgets) — users cascade-delete their games. */
export async function makeOwner(db: PostgresJsDatabase<typeof schema>): Promise<string> {
  ownerCounter += 1;
  const inserted = await db
    .insert(schema.users)
    .values({ email: `orchestration-${ownerCounter}-${Date.now()}@test.local` })
    .returning({ id: schema.users.id });
  return inserted[0].id;
}

export function makeService(
  db: PostgresJsDatabase<typeof schema>,
  options: {
    config?: OrchestrationConfigInput;
    engine?: DecisionEngine | null;
  } = {},
): GameApplicationService {
  return new GameApplicationService({
    db,
    engine: options.engine,
    config: options.config,
  } satisfies GameApplicationServiceOptions);
}

// ---------------------------------------------------------------------------
// Decision engines
// ---------------------------------------------------------------------------

/** One recorded engine invocation (per seat decision). */
export interface EngineCall {
  readonly seat: number;
  readonly phase: string;
  readonly input: AiTurnInput;
  readonly tokens: number;
  readonly decision: AiDecision;
}

export interface EngineHarness {
  engine: DecisionEngine;
  calls: EngineCall[];
  /** Highest number of decide() invocations in flight at once. */
  maxInFlight: () => number;
  /** Total provider tokens reported so far. */
  tokensReported: () => number;
}

function wrapEngine(
  inner: (input: AiTurnInput) => AiDecision | Promise<AiDecision>,
  opts: {
    tokensPerCall?: number;
    /** P6.3 sanitized run metadata reported per successful decision. */
    runMeta?: (input: AiTurnInput) => DecisionRunMeta | null;
  } = {},
): EngineHarness {
  const calls: EngineCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const engine: DecisionEngine = {
    enabled: true,
    async decide(input, _signal, observer) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const decision = await inner(input);
        calls.push({
          seat: input.seat,
          phase: input.phase,
          input,
          tokens: opts.tokensPerCall ?? 0,
          decision,
        });
        if ((opts.tokensPerCall ?? 0) > 0) {
          const half = Math.floor((opts.tokensPerCall ?? 0) / 2);
          observer.reportUsage({
            totalTokens: opts.tokensPerCall ?? 0,
            inputTokens: half,
            outputTokens: (opts.tokensPerCall ?? 0) - half,
            cachedInputTokens: 0,
          });
        }
        const meta = opts.runMeta?.(input);
        if (meta) observer.reportRun(meta);
        return decision;
      } finally {
        inFlight -= 1;
      }
    },
  };
  return {
    engine,
    calls,
    maxInFlight: () => maxInFlight,
    tokensReported: () => calls.reduce((sum, call) => sum + call.tokens, 0),
  };
}

/** Always picks the first legal choice authorized for the deciding seat. */
export function firstChoiceEngine(): EngineHarness {
  return wrapEngine((input) => {
    const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
    return { choiceId: own[0].id, utterance: "我选择第一项。" };
  });
}

/** Deterministic per-seat script: (input) → decision. */
export function scriptedEngine(
  script: (input: AiTurnInput) => AiDecision | Promise<AiDecision>,
  opts: { tokensPerCall?: number } = {},
): EngineHarness {
  return wrapEngine(script, opts);
}

/**
 * Fails with `error` exactly `failures` times (in total), then always
 * succeeds with `then` — the canonical transient-retry probe.
 */
export function flakyEngine(
  failures: number,
  error: AiProviderError | Error,
  then: AiDecision,
): EngineHarness {
  let remaining = failures;
  return wrapEngine(() => {
    if (remaining > 0) {
      remaining -= 1;
      throw error;
    }
    return then;
  });
}

/** Always fails with the given provider error code (or a plain Error). */
export function failingEngine(
  code: AiErrorCode | "plain",
  message = "engine failure",
): EngineHarness {
  return wrapEngine(() => {
    if (code === "plain") {
      throw new Error(message);
    }
    throw new AiProviderError(code, message);
  });
}

/** Succeeds after a fixed delay (respects nothing; the timeout races it). */
export function slowEngine(delayMs: number, decision: AiDecision): EngineHarness {
  return wrapEngine(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return decision;
  });
}

/** Never resolves: only the orchestration's timeout can end the attempt. */
export function hangEngine(): EngineHarness {
  return wrapEngine(() => new Promise<AiDecision>(() => {}));
}

/** Reports `tokensPerCall` tokens and always picks the first legal choice. */
export function tokenEngine(tokensPerCall: number): EngineHarness {
  return wrapEngine(
    (input) => {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "" };
    },
    { tokensPerCall },
  );
}

/** A decision the rule engine must reject: an unauthorized choice id. */
export function illegalChoiceEngine(): EngineHarness {
  return wrapEngine(() => ({ choiceId: "day-vote@9:9", utterance: "非法选择" }));
}

/**
 * Blocks each decision on the given latch before deciding — used to keep a
 * provider call in flight while another worker reclaims its lease.
 */
export function latchedEngine(
  latch: () => Promise<void>,
  decision: AiDecision,
): EngineHarness {
  return wrapEngine(async () => {
    await latch();
    return decision;
  });
}

// ---------------------------------------------------------------------------
// Game driving
// ---------------------------------------------------------------------------

export interface AdvanceLoopOptions {
  maxAdvances?: number;
  /** Human driver: on waiting_for_human, returns the command to submit. */
  humanMove?: (seat: SeatId, result: Extract<AdvanceResult, { status: "waiting_for_human" }>) => Quick6Command | null;
}

/**
 * A minimal deterministic human driver for fixedRoles: wolves kill the
 * first living villager, the seer checks the first living non-self seat,
 * speeches are skipped, votes hit the first living non-self seat. It
 * submits through the same service.submitCommand path the human API uses.
 */
export function simpleHumanMove(
  role: "WOLF" | "SEER" | "VILLAGER" = "WOLF",
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

/**
 * Drive a game with bounded advances until finished or aborted. Every
 * waiting_for_human status goes to the human driver (default: none), which
 * submits through the same service.submitCommand path the human API uses.
 * Throws when the game neither finishes nor aborts within maxAdvances —
 * a stuck phase / permanent pending is a test failure.
 */
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

/** Recursively sort object keys (jsonb and engine payloads may differ). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * The full public event stream of a session, canonicalized for comparison:
 * object keys sorted (jsonb stores its own order) and the VOTE events of a
 * round sorted by (round, seat) — the rules collect votes simultaneously, so
 * their completion order in the stream is not rule-meaningful. Speeches
 * (strict seat order), eliminations and phase transitions stay exactly as
 * stored, and every other event keeps its stored relative order.
 */
export async function canonicalEventStreamOf(
  db: PostgresJsDatabase<typeof schema>,
  service: GameApplicationService,
  ownerId: string,
  sessionId: string,
): Promise<unknown[]> {
  const repo = new GameRepository(db);
  const { state } = await repo.loadState(ownerId, sessionId, service.definition, replayOf());
  const events = state.events.map((event: { payload: unknown }) =>
    canonicalize(event.payload),
  ) as Array<{ type?: string; record?: { round?: number; seat?: number } }>;

  // Collect the vote events, sort them by (round, seat), then reinsert them
  // at their stored positions — so only the vote-vs-vote order may change.
  const votes = events
    .map((event, index) => ({ event, index }))
    .filter((entry) => entry.event.type === "VOTE");
  votes.sort((a, b) => {
    const ka = (a.event.record?.round ?? 0) * 100 + (a.event.record?.seat ?? 0);
    const kb = (b.event.record?.round ?? 0) * 100 + (b.event.record?.seat ?? 0);
    return ka - kb;
  });
  const sorted = [...events];
  const votePositions = votes.map((entry) => entry.index).sort((a, b) => a - b);
  votePositions.forEach((position, i) => {
    sorted[position] = votes[i].event;
  });
  return sorted;
}

export { seedBytesFromInt as seedInt };
