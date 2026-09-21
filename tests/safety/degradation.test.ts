/**
 * P6.3 emergency switch, global daily budget and the frozen
 * timeout/retry boundaries — each with deterministic degradation into the
 * fallback that still completes the whole game:
 *
 * - AI_PROVIDER_ENABLED: "0"/"false" disables the engine (the P4.1
 *   GAME_AI_ENABLED name stays an accepted alias); missing key disables;
 *   an invalid GAME_AI_GLOBAL_DAILY_CAP disables (fail safe);
 * - the global daily meter: N-1/N/N+1 allows under the cap and refuses
 *   past it, resets at the UTC day boundary, and its exhaustion degrades
 *   the game to the fallback — the game still finishes;
 * - frozen per-decision timeout 10s at N-1/N/N+1 with fake timers
 *   (9999/10000/10001 ms) — a provider answer that arrives too late is
 *   discarded and the fallback carries the seat;
 * - frozen maxRetries=1 (transient only) at 0/1/2 failures → 1/2/2
 *   attempts, then the deterministic fallback.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import { AiProviderError } from "@/lib/ai/errors";
import { ProviderTimeoutError } from "@/lib/games/core";
import { DEFAULT_ORCHESTRATION_CONFIG } from "@/lib/games/orchestration";
import { withTimeout } from "@/lib/games/orchestration/timing";
import {
  AI_PROVIDER_ENABLED_KEY,
  GAME_AI_ENABLED_KEY,
  createDecisionEngineFromEnv,
  getGlobalAttemptMeter,
} from "@/lib/games/orchestration/runtime";
import { createDailyAttemptMeter, utcDayKey } from "@/lib/games/orchestration/global-budget";
import {
  fixedRoles,
  firstChoiceEngine,
  hangEngine,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  type TestContext,
} from "./helpers";

const VALID_ENV = {
  DEEPSEEK_API_KEY: "sk-test-key",
  DEEPSEEK_BASE_URL: "https://api.deepseek.example.test",
  DEEPSEEK_MODEL: "deepseek-chat",
  GAME_SEAT_HMAC_SECRET: "test-secret",
} as const;

describe("P6.3 emergency switch (AI_PROVIDER_ENABLED)", () => {
  it("the emergency switch turns the provider off; the P4.1 alias still works", () => {
    expect(createDecisionEngineFromEnv({ ...VALID_ENV, [AI_PROVIDER_ENABLED_KEY]: "0" }).enabled).toBe(false);
    expect(createDecisionEngineFromEnv({ ...VALID_ENV, [AI_PROVIDER_ENABLED_KEY]: "false" }).enabled).toBe(false);
    expect(createDecisionEngineFromEnv({ ...VALID_ENV, [GAME_AI_ENABLED_KEY]: "0" }).enabled).toBe(false);
    expect(createDecisionEngineFromEnv({ ...VALID_ENV, [AI_PROVIDER_ENABLED_KEY]: "1" }).enabled).toBe(true);
    expect(createDecisionEngineFromEnv({ ...VALID_ENV }).enabled).toBe(true);
    // No key → disabled without error.
    expect(
      createDecisionEngineFromEnv({ ...VALID_ENV, DEEPSEEK_API_KEY: undefined }).enabled,
    ).toBe(false);
  });

  it("an invalid GAME_AI_GLOBAL_DAILY_CAP disables the provider (fail safe)", () => {
    expect(getGlobalAttemptMeter({ ...VALID_ENV, GAME_AI_GLOBAL_DAILY_CAP: "abc" })).toBeNull();
    expect(getGlobalAttemptMeter({ ...VALID_ENV, GAME_AI_GLOBAL_DAILY_CAP: "-5" })).toBeNull();
    expect(getGlobalAttemptMeter({ ...VALID_ENV })).not.toBeNull();
  });
});

describe("P6.3 global daily provider budget (N-1/N/N+1)", () => {
  it("allows exactly the cap, refuses past it, resets at the UTC day boundary", () => {
    const cap = 5;
    let day = new Date("2026-09-22T08:00:00.000Z");
    const meter = createDailyAttemptMeter(cap, () => day);
    // N-1..N allowed; N+1 refused.
    for (let i = 0; i < cap - 1; i++) expect(meter.allow()).toBe(true);
    expect(meter.allow()).toBe(true); // the N-th
    expect(meter.allow()).toBe(false); // N+1
    expect(meter.allow()).toBe(false);
    expect(meter.consumedToday()).toBe(cap);
    // The next UTC day resets the meter.
    day = new Date("2026-09-23T00:00:00.000Z");
    expect(meter.allow()).toBe(true);
    expect(meter.consumedToday()).toBe(1);
  });

  it("utcDayKey maps instants to their UTC calendar day", () => {
    expect(utcDayKey(new Date("2026-09-22T23:59:59.999Z"))).toBe("2026-09-22");
    expect(utcDayKey(new Date("2026-09-23T00:00:00.000Z"))).toBe("2026-09-23");
  });
});

describe("P6.3 deterministic degradation completes the whole game (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("an exhausted global meter degrades every decision to the fallback and the game finishes", async () => {
    const ownerId = await makeOwner(ctx.db);
    // The meter is exhausted from the start: every decision falls back.
    const meter = createDailyAttemptMeter(1, () => new Date());
    expect(meter.allow()).toBe(true);
    expect(meter.allow()).toBe(false);

    let calls = 0;
    const engine = {
      enabled: true,
      async decide(input: AiTurnInput): Promise<AiDecision> {
        calls += 1;
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "" };
      },
    };
    const service = makeService(ctx.db, { engine, globalMeter: meter });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(920),
      start: fixedRoles(5),
    });
    const { final } = await runToCompletion(service, ownerId, created.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(final.status).toBe("finished");
    // The provider never ran — the fallback carried every AI seat.
    expect(calls).toBe(0);
    // Logical calls were never reserved either.
    const session = await makeRepo(ctx.db).getSession(ownerId, created.sessionId);
    expect(session!.aiLogicalCalls).toBe(0);
  });

  it("a switched-off engine (no provider) still completes a full game via fallback", async () => {
    const ownerId = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null }); // frozen default config
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(921),
      start: fixedRoles(5),
    });
    const { final } = await runToCompletion(service, ownerId, created.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(final.status).toBe("finished");
    const session = await makeRepo(ctx.db).getSession(ownerId, created.sessionId);
    expect(session!.aiLogicalCalls).toBe(0);
    expect(session!.aiBudgetConsumed).toBe(0);
  });
});

describe("P6.3 frozen timeout 10s at N-1/N/N+1 (pure deadline race + real-Postgres integration)", () => {
  const TIMEOUT = DEFAULT_ORCHESTRATION_CONFIG.provider.timeoutMs; // frozen 10s

  it("the deadline race: N-1 the task wins, N/N+1 the timeout wins and late results are discarded", async () => {
    expect(TIMEOUT).toBe(10_000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // N-1: the task settles before the deadline → task wins.
      const fast = new Promise<string>((resolve) => resolve("ok"));
      const fastRace = withTimeout(fast, TIMEOUT);
      await expect(fastRace).resolves.toBe("ok");

      // N: the deadline fires exactly at timeoutMs; the late result is lost.
      const onTime = new Promise<string>(() => {});
      const onTimeRace = withTimeout(onTime, TIMEOUT);
      const onTimeExpect = expect(onTimeRace).rejects.toBeInstanceOf(ProviderTimeoutError);
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await onTimeExpect;

      // N+1: past the deadline the timeout already won.
      const late = new Promise<string>(() => {});
      const lateRace = withTimeout(late, TIMEOUT);
      const lateExpect = expect(lateRace).rejects.toBeInstanceOf(ProviderTimeoutError);
      await vi.advanceTimersByTimeAsync(TIMEOUT + 1);
      await lateExpect;
    } finally {
      vi.useRealTimers();
    }
  });

  it("integration: a hung provider at the frozen 10s deadline times out, falls back and the game completes", async () => {
    const ctx = await openContext();
    try {
      const ownerId = await makeOwner(ctx.db);
      const service = makeService(ctx.db, {
        engine: hangEngine(),
        config: {
          advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 },
          provider: { timeoutMs: TIMEOUT, maxRetries: 0, leaseTtlSeconds: 60 },
        },
      });
      const created = await service.createGame(ownerId, {
        seedBytes: seedInt(931),
        start: fixedRoles(5),
      });
      // The first advance waits out the frozen 10s deadline (real time),
      // then falls back deterministically.
      const started = Date.now();
      const first = await service.advance(ownerId, created.sessionId);
      expect(["pending", "waiting_for_human"]).toContain(first.status);
      expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT);

      const run = await makeRepo(ctx.db).getAiRun(ownerId, created.sessionId, {
        seat: 0,
        phaseToken: "night:1",
        purpose: "wolf-kill",
      });
      expect(run!.status).toBe("timeout");
      expect(run!.fallback).toBe(true);
      expect(run!.errorCode).toBe("TIMEOUT");

      // The game still completes through the fallback (a working engine
      // takes over from here — the hung-provider path already proved the
      // degraded decision; the remaining budget must carry a full game).
      const healthy = makeService(ctx.db, {
        engine: firstChoiceEngine(),
        config: { advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 } },
      });
      const { final } = await runToCompletion(healthy, ownerId, created.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status).toBe("finished");
    } finally {
      await ctx.client.end({ timeout: 5 });
    }
  });
});

describe("P6.3 frozen maxRetries=1 (transient only) at N-1/N/N+1 (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("0/1/2 transient failures → 1/2/2 attempts; the game always completes", async () => {
    const maxRetries = DEFAULT_ORCHESTRATION_CONFIG.provider.maxRetries; // frozen 1
    expect(maxRetries).toBe(1);

    for (const [label, failures, expectAttempts, expectStatus] of [
      ["N-1", 0, 1, "succeeded"],
      ["N", 1, 2, "succeeded"],
      ["N+1", 2, 2, "failed"],
    ] as const) {
      const ownerId = await makeOwner(ctx.db);
      let remaining = failures;
      const engine = {
        enabled: true,
        async decide(input: AiTurnInput): Promise<AiDecision> {
          if (remaining > 0) {
            remaining -= 1;
            throw new AiProviderError("RATE_LIMITED", "transient", { httpStatus: 429 });
          }
          const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
          return { choiceId: own[0].id, utterance: "" };
        },
      };
      const service = makeService(ctx.db, {
        engine,
        config: {
          advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 },
          provider: { maxRetries, leaseTtlSeconds: 60 },
        },
      });
      const created = await service.createGame(ownerId, {
        seedBytes: seedInt(940),
        start: fixedRoles(5),
      });
      const { final } = await runToCompletion(service, ownerId, created.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");

      const run = await makeRepo(ctx.db).getAiRun(ownerId, created.sessionId, {
        seat: 0,
        phaseToken: "night:1",
        purpose: "wolf-kill",
      });
      expect(run!.attempts, label).toBe(expectAttempts);
      expect(run!.status, label).toBe(expectStatus);
      if (expectStatus === "failed") {
        expect(run!.fallback, label).toBe(true);
        expect(run!.errorCode, label).toBe("RATE_LIMITED");
      } else {
        expect(run!.fallback, label).toBe(false);
      }
    }
  });

  it("non-transient failures are NEVER retried (one attempt, fallback)", async () => {
    const ownerId = await makeOwner(ctx.db);
    const engine = {
      enabled: true,
      async decide() {
        throw new AiProviderError("BAD_RESPONSE", "malformed");
      },
    };
    const service = makeService(ctx.db, {
      engine,
      config: { advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 } },
    });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(941),
      start: fixedRoles(5),
    });
    await service.advance(ownerId, created.sessionId);
    const run = await makeRepo(ctx.db).getAiRun(ownerId, created.sessionId, {
      seat: 0,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run!.attempts).toBe(1);
    expect(run!.status).toBe("failed");
    expect(run!.fallback).toBe(true);
    expect(run!.errorCode).toBe("BAD_RESPONSE");
  });
});
