/**
 * P4.1 orchestration — the per-game and per-user budgets, all thresholds
 * from the versioned config, exercised at their N-1/N/N+1 boundaries.
 *
 * - maxLogicalCalls: an atomic guarded reservation — exactly N provider
 *   decisions, then the fallback carries the game.
 * - maxHttpAttempts: the claim's own atomic budget — every attempt
 *   (including failed retries) is charged; exhaustion forces the fallback.
 * - maxTokens: decisions stop reaching the provider once the reported
 *   response tokens reach the cap.
 * - maxRounds: a game that would keep playing past the cap aborts loudly
 *   (never a forged draw); a cap that fits finishes.
 * - Config versioning: unknown versions and invalid thresholds are refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AiProviderError } from "@/lib/ai/errors";
import { PersistenceError } from "@/lib/games/core";
import type { OrchestrationConfigInput } from "@/lib/games/orchestration";
import { OrchestrationConfigError } from "@/lib/games/orchestration";
import {
  fixedRoles,
  firstChoiceEngine,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  runToCompletion,
  scriptedEngine,
  seedInt,
  simpleHumanMove,
  tokenEngine,
  type EngineHarness,
  type TestContext,
} from "./helpers";

describe("P4.1 orchestration — budgets at the N-1/N/N+1 boundaries (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  /** Batch cap 1 makes every decision sequential — crisp budget boundaries. */
  const SEQUENTIAL = {
    advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 },
  };

  async function create(seed: number, harness: EngineHarness, config?: OrchestrationConfigInput) {
    // Fresh owner per game: the per-user budget never leaks across tests.
    const ownerId = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: harness.engine, config });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(seed),
      start: fixedRoles(5),
    });
    return { service, sessionId: created.sessionId, ownerId };
  }

  it("maxLogicalCalls: exactly N provider decisions, then the fallback carries the game (N-1/N/N+1)", async () => {
    for (const [label, cap, expectProviderDecisions] of [
      ["N-1", 4, 4],
      ["N", 5, 5],
      ["N+1", 6, 6],
    ] as const) {
      const harness = firstChoiceEngine();
      const { service, sessionId, ownerId } = await create(501, harness, {
        game: { maxLogicalCalls: cap },
        ...SEQUENTIAL,
      });
      const { final } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");

      // Exactly the cap of provider-backed decisions happened; the counter
      // never exceeded it and the rest fell back deterministically.
      expect(harness.calls.length, label).toBe(expectProviderDecisions);
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiLogicalCalls, label).toBe(cap);
    }
  });

  it("maxHttpAttempts: every attempt (failed retries included) is charged; exhaustion forces the fallback (N-1/N/N+1)", async () => {
    // The seer fails once (transient, retried) → its decision costs 2
    // attempts; the wolves cost 1 each: the first night batch costs 4.
    for (const [label, cap, expectAttempts] of [
      ["N-1", 3, 3],
      ["N", 4, 4],
      ["N+1", 5, 5],
    ] as const) {
      let seerFailures = 1;
      const harness = scriptedEngine((input) => {
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        if (input.seat === 2 && seerFailures > 0) {
          seerFailures -= 1;
          throw new AiProviderError("RATE_LIMITED", "transient", { httpStatus: 429 });
        }
        return { choiceId: own[0].id, utterance: "" };
      });
      const { service, sessionId, ownerId } = await create(502, harness, {
        game: { maxHttpAttempts: cap },
        provider: { maxRetries: 1, leaseTtlSeconds: 60 },
        ...SEQUENTIAL,
      });
      const { final } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");

      // The atomic claim budget held: total charged attempts == cap, never
      // more, and the game still completed via fallback.
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiBudgetConsumed, label).toBe(expectAttempts);
      expect(session!.aiBudgetConsumed, label).toBeLessThanOrEqual(cap);
    }
  });

  it("maxOutputTokens: decisions stop reaching the provider once output tokens hit the cap (N-1/N/N+1)", async () => {
    // 100 tokens per decision (50 in / 50 out); batch cap 1 → sequential.
    for (const [label, cap, expectProviderDecisions] of [
      ["N-1", 99, 2],
      ["N", 100, 2],
      ["N+1", 101, 3],
    ] as const) {
      const harness = tokenEngine(100);
      const { service, sessionId, ownerId } = await create(503, harness, {
        game: { maxOutputTokens: cap },
        ...SEQUENTIAL,
      });
      const { final } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");

      expect(harness.calls.length, label).toBe(expectProviderDecisions);
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiTokensConsumed, label).toBe(expectProviderDecisions * 100);
      expect(session!.aiOutputTokensConsumed, label).toBe(expectProviderDecisions * 50);
      expect(session!.aiInputTokensConsumed, label).toBe(expectProviderDecisions * 50);
    }
  });

  it("maxRounds: a game that would keep playing past the cap aborts loudly — never a forged draw (N-1/N/N+1)", async () => {
    // Reference run: how many rounds does this deterministic game need?
    const reference = firstChoiceEngine();
    const refOwner = await makeOwner(ctx.db);
    const referenceService = makeService(ctx.db, { engine: reference.engine });
    const refCreated = await referenceService.createGame(refOwner, {
      seedBytes: seedInt(504),
      start: fixedRoles(5),
    });
    const { final: refFinal } = await runToCompletion(referenceService, refOwner, refCreated.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(refFinal.status).toBe("finished");
    const roundsNeeded =
      refFinal.status === "finished" ? refFinal.publicView.round : 0;
    expect(roundsNeeded).toBeGreaterThan(1);

    for (const [label, cap, expectOutcome] of [
      ["N-1", roundsNeeded - 1, "aborted"],
      ["N", roundsNeeded, "finished"],
      ["N+1", roundsNeeded + 1, "finished"],
    ] as const) {
      const harness = firstChoiceEngine();
      const { service, sessionId, ownerId } = await create(504, harness, {
        game: { maxRounds: cap },
      });
      const { final, results } = await runToCompletion(service, ownerId, sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe(expectOutcome);
      if (expectOutcome === "aborted") {
        expect(final).toMatchObject({ status: "aborted", reason: "round_budget_exceeded" });
        if (final.status === "aborted") {
          expect(final.round).toBe(cap + 1);
          expect(final.maxRounds).toBe(cap);
        }
        // The abort is durable: no GAME_OVER ever appears and the advance
        // keeps refusing instead of fabricating an outcome.
        const rows = await ctx.client`select count(*)::int as n from game_events where session_id = ${sessionId} and payload::text like '%GAME_OVER%'`;
        expect(rows[0].n).toBe(0);
        const again = await service.advance(ownerId, sessionId);
        expect(again.status).toBe("aborted");
      }
      void results;
    }
  });

  it("the per-user budget is enforced atomically under concurrent creates", async () => {
    const freshOwner = await makeOwner(ctx.db); // isolated from the other tests' games
    const service = makeService(ctx.db, {
      engine: null,
      config: { user: { maxConcurrentGames: 2 } },
    });
    const seeds = [505, 506, 507, 508, 509, 510, 511, 512];
    const attempts = await Promise.all(
      seeds.map((seed, index) =>
        service
          .createGame(freshOwner, { seedBytes: seedInt(seed), start: fixedRoles(5) })
          .then(
            () => ({ ok: true as const, index }),
            (error: unknown) =>
              error instanceof PersistenceError && error.code === "USER_BUDGET_EXHAUSTED"
                ? { ok: false as const, index }
                : { crash: error as Error, index },
          ),
      ),
    );
    const ok = attempts.filter((a) => "ok" in a && a.ok);
    const refused = attempts.filter((a) => "ok" in a && !a.ok);
    expect(attempts.every((a) => !("crash" in a))).toBe(true);
    // Exactly the cap succeeded — the advisory lock closed the race.
    expect(ok.length).toBe(2);
    expect(refused.length).toBe(seeds.length - 2);
  });

  it("the versioned config refuses unknown versions and invalid thresholds", () => {
    expect(() => makeService(ctx.db, { engine: null, config: { version: "orchestration-v99" } })).toThrow(
      OrchestrationConfigError,
    );
    expect(() =>
      makeService(ctx.db, {
        engine: null,
        config: { advance: { maxConcurrentProviderCalls: 6, maxProviderCallsPerAdvance: 5 } },
      }),
    ).toThrow(/maxConcurrentProviderCalls/);
    expect(() =>
      makeService(ctx.db, { engine: null, config: { provider: { maxRetries: -1 } } }),
    ).toThrow(OrchestrationConfigError);
    expect(() =>
      makeService(ctx.db, { engine: null, config: { game: { maxRounds: 0 } } }),
    ).toThrow(OrchestrationConfigError);
    // The default config carries the frozen version.
    expect(makeService(ctx.db, { engine: null }).config.version).toBe("orchestration-v2");
  });
});
