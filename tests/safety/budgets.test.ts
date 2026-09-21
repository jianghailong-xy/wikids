/**
 * P6.3 budgets at the frozen thresholds (orchestration-v2), each exercised
 * at its exact N-1/N/N+1 boundary against the isolated real Postgres:
 *
 * - per game: 40 logical calls, 60 HTTP attempts, 160k input tokens,
 *   12k output tokens — the counters are seeded in SQL at cap-1/cap/cap+1
 *   and the next provider decision must be allowed/refused/refused;
 * - per user: 1 concurrent active game (0/1/2), 10 games/day (9/10/11),
 *   400 logical calls/day (399/400/401);
 * - exhaustion never stalls: the deterministic fallback carries the game
 *   to completion.
 *
 * Batch cap 1 makes every decision sequential so the boundaries are crisp.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PersistenceError } from "@/lib/games/core";
import {
  fixedRoles,
  firstChoiceEngine,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  type TestContext,
} from "./helpers";
import { DEFAULT_ORCHESTRATION_CONFIG } from "@/lib/games/orchestration";

describe("P6.3 budgets at the frozen N-1/N/N+1 boundaries (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  const FROZEN = DEFAULT_ORCHESTRATION_CONFIG;
  const SEQUENTIAL = {
    advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 },
  };

  async function createGame(ownerId: string, engine = firstChoiceEngine()) {
    const service = makeService(ctx.db, { engine, config: { ...SEQUENTIAL } });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(900),
      start: fixedRoles(5),
    });
    return { service, sessionId: created.sessionId };
  }

  /** One advance with the given engine; returns whether the provider ran. */
  async function advanceOnce(ownerId: string, sessionId: string, engine = firstChoiceEngine()) {
    const service = makeService(ctx.db, { engine, config: { ...SEQUENTIAL } });
    const result = await service.advance(ownerId, sessionId);
    return { result, service };
  }

  it("maxLogicalCalls=40: seeded 39/40/41 → provider runs at 39, falls back at 40/41", async () => {
    for (const [label, seeded, expectProviderCall] of [
      ["N-1", FROZEN.game.maxLogicalCalls - 1, true],
      ["N", FROZEN.game.maxLogicalCalls, false],
      ["N+1", FROZEN.game.maxLogicalCalls + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      const { service, sessionId } = await createGame(ownerId);
      await ctx.client`update game_sessions set ai_logical_calls = ${seeded} where id = ${sessionId}`;

      let calls = 0;
      const counting = firstChoiceEngine();
      const inner = counting.decide.bind(counting);
      counting.decide = async (...args: Parameters<typeof inner>) => {
        calls += 1;
        return inner(...args);
      };
      const engine = counting;
      await advanceOnce(ownerId, sessionId, engine);

      expect(calls, label).toBe(expectProviderCall ? 1 : 0);
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      // The reservation never moves past the cap.
      expect(session!.aiLogicalCalls, label).toBe(
        expectProviderCall ? seeded + 1 : seeded,
      );
      // Degradation completes the game regardless (fallback carries it).
      const { final } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");
    }
  });

  it("maxHttpAttempts=60: seeded 59/60/61 consumed → claim allowed at 59, refused at 60/61", async () => {
    for (const [label, seeded, expectProviderCall] of [
      ["N-1", FROZEN.game.maxHttpAttempts - 1, true],
      ["N", FROZEN.game.maxHttpAttempts, false],
      ["N+1", FROZEN.game.maxHttpAttempts + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      const { service, sessionId } = await createGame(ownerId);
      await ctx.client`update game_sessions set ai_budget_consumed = ${seeded} where id = ${sessionId}`;

      let calls = 0;
      const engine = firstChoiceEngine();
      const inner = engine.decide.bind(engine);
      engine.decide = async (...args: Parameters<typeof inner>) => {
        calls += 1;
        return inner(...args);
      };
      await advanceOnce(ownerId, sessionId, engine);

      expect(calls, label).toBe(expectProviderCall ? 1 : 0);
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiBudgetConsumed, label).toBe(expectProviderCall ? seeded + 1 : seeded);

      const { final } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");
    }
  });

  it("maxInputTokens=160000: seeded 159999/160000/160001 → allowed at N-1, fallback at N/N+1", async () => {
    for (const [label, seeded, expectProviderCall] of [
      ["N-1", FROZEN.game.maxInputTokens - 1, true],
      ["N", FROZEN.game.maxInputTokens, false],
      ["N+1", FROZEN.game.maxInputTokens + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      const { sessionId } = await createGame(ownerId);
      await ctx.client`update game_sessions set ai_input_tokens_consumed = ${seeded} where id = ${sessionId}`;

      let calls = 0;
      const engine = firstChoiceEngine();
      const inner = engine.decide.bind(engine);
      engine.decide = async (...args: Parameters<typeof inner>) => {
        calls += 1;
        return inner(...args);
      };
      await advanceOnce(ownerId, sessionId, engine);
      expect(calls, label).toBe(expectProviderCall ? 1 : 0);
    }
  });

  it("maxOutputTokens=12000: seeded 11999/12000/12001 → allowed at N-1, fallback at N/N+1", async () => {
    for (const [label, seeded, expectProviderCall] of [
      ["N-1", FROZEN.game.maxOutputTokens - 1, true],
      ["N", FROZEN.game.maxOutputTokens, false],
      ["N+1", FROZEN.game.maxOutputTokens + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      const { sessionId } = await createGame(ownerId);
      await ctx.client`update game_sessions set ai_output_tokens_consumed = ${seeded} where id = ${sessionId}`;

      let calls = 0;
      const engine = firstChoiceEngine();
      const inner = engine.decide.bind(engine);
      engine.decide = async (...args: Parameters<typeof inner>) => {
        calls += 1;
        return inner(...args);
      };
      await advanceOnce(ownerId, sessionId, engine);
      expect(calls, label).toBe(expectProviderCall ? 1 : 0);
    }
  });

  it("per-user concurrent games=1: the first create succeeds, the second is refused (N-1/N/N+1)", async () => {
    // N-1 = 0 active games: creating the first game succeeds.
    const ownerId = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: firstChoiceEngine() }); // frozen default config
    const first = await service.createGame(ownerId, { seedBytes: seedInt(901), start: fixedRoles(5) });
    expect(first.sessionId).toBeTruthy();
    // N = 1 active game exists → the next create (N+1) is refused atomically.
    await expect(
      service.createGame(ownerId, { seedBytes: seedInt(902), start: fixedRoles(5) }),
    ).rejects.toMatchObject({ code: "USER_BUDGET_EXHAUSTED" });
    // Finishing the game releases the budget.
    const { final } = await runToCompletion(service, ownerId, first.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(final.status).toBe("finished");
    const second = await service.createGame(ownerId, { seedBytes: seedInt(903), start: fixedRoles(5) });
    expect(second.sessionId).toBeTruthy();
  });

  it("per-user games/day=10: 9/10/11 sessions created today → create allowed at 9, refused at 10/11", async () => {
    for (const [label, seeded, expectOk] of [
      ["N-1", FROZEN.user.maxGamesPerDay - 1, true],
      ["N", FROZEN.user.maxGamesPerDay, false],
      ["N+1", FROZEN.user.maxGamesPerDay + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      // Seed `seeded` finished sessions created today (database time).
      for (let i = 0; i < seeded; i++) {
        await ctx.client`
          insert into game_sessions (owner_id, definition_id, title, definition_version,
            rules_version, event_schema_version, prng_version, status, revision,
            phase_token, ai_budget_limit)
          values (${ownerId}, 'quick6', 'seed', 'v1', 'v1', 'v1', 'v1', 'finished', 0, 'end', 60)
        `;
      }
      const service = makeService(ctx.db, { engine: firstChoiceEngine() });
      if (expectOk) {
        const created = await service.createGame(ownerId, { seedBytes: seedInt(904), start: fixedRoles(5) });
        expect(created.sessionId, label).toBeTruthy();
      } else {
        await expect(
          service.createGame(ownerId, { seedBytes: seedInt(904), start: fixedRoles(5) }),
          label,
        ).rejects.toMatchObject({ code: "DAILY_GAME_LIMIT_EXCEEDED" });
      }
    }
  });

  it("per-user logical calls/day=400: daily sum 399/400/401 → reservation allowed at 399, refused at 400/401", async () => {
    for (const [label, seededDaily, expectProviderCall] of [
      ["N-1", FROZEN.user.maxLogicalCallsPerDay - 1, true],
      ["N", FROZEN.user.maxLogicalCallsPerDay, false],
      ["N+1", FROZEN.user.maxLogicalCallsPerDay + 1, false],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      const { sessionId } = await createGame(ownerId);
      // A second session created today carries the owner's daily sum.
      await ctx.client`
        insert into game_sessions (owner_id, definition_id, title, definition_version,
          rules_version, event_schema_version, prng_version, status, revision,
          phase_token, ai_budget_limit, ai_logical_calls)
        values (${ownerId}, 'quick6', 'daily-carrier', 'v1', 'v1', 'v1', 'v1',
                'finished', 0, 'end', 60, ${seededDaily})
      `;

      let calls = 0;
      const engine = firstChoiceEngine();
      const inner = engine.decide.bind(engine);
      engine.decide = async (...args: Parameters<typeof inner>) => {
        calls += 1;
        return inner(...args);
      };
      await advanceOnce(ownerId, sessionId, engine);
      expect(calls, label).toBe(expectProviderCall ? 1 : 0);
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiLogicalCalls, label).toBe(expectProviderCall ? 1 : 0);
    }
  });

  it("the frozen defaults are the values the boundaries run against", () => {
    expect(FROZEN.game.maxLogicalCalls).toBe(40);
    expect(FROZEN.game.maxHttpAttempts).toBe(60);
    expect(FROZEN.game.maxInputTokens).toBe(160_000);
    expect(FROZEN.game.maxOutputTokens).toBe(12_000);
    expect(FROZEN.user.maxConcurrentGames).toBe(1);
    expect(FROZEN.user.maxGamesPerDay).toBe(10);
    expect(FROZEN.user.maxLogicalCallsPerDay).toBe(400);
  });

  it("PersistenceError exposes the daily game-limit code for the API mapping", () => {
    const error = new PersistenceError("DAILY_GAME_LIMIT_EXCEEDED", "daily budget");
    expect(error.code).toBe("DAILY_GAME_LIMIT_EXCEEDED");
  });
});
