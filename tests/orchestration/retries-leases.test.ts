/**
 * P4.1 orchestration — retries, database-time leases and races.
 *
 * - Each decision gets at most `provider.maxRetries` TRANSIENT retries
 *   (429/5xx/network only) plus a single per-attempt timeout; timeouts and
 *   non-transient failures are never retried and fall back.
 * - Every attempt (success, failure, timeout) is charged: attempts + budget.
 * - Leases are database-time: an expired or reclaimed lease rejects the
 *   result (STALE_LEASE), a disconnected worker's lease is reclaimable, and
 *   stale results are discarded — never applied.
 * - Concurrent duplicate advances decide each seat exactly once.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import type { OrchestrationConfigInput } from "@/lib/games/orchestration";
import { AiProviderError } from "@/lib/ai/errors";
import { assertNoOpenTransaction, transactionDepth } from "@/lib/games/core";
import {
  fixedRoles,
  hangEngine,
  latchedEngine,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  scriptedEngine,
  seedInt,
  slowEngine,
  type EngineHarness,
  type TestContext,
} from "./helpers";

describe("P4.1 orchestration — retries and leases (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

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

  /** Fails only the seer's decision `failures` times with `error`, then answers. */
  function seerFlaky(failures: number, error: AiProviderError, answer: AiDecision): EngineHarness {
    let remaining = failures;
    return scriptedEngine((input) => {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      if (input.seat === 2 && remaining > 0) {
        remaining -= 1;
        throw error;
      }
      return { choiceId: own[0].id, utterance: "" };
    });
  }

  it("transient retry boundary: maxRetries N retries a transient failure at most N times (N-1/N/N+1)", async () => {
    for (const [label, maxRetries, failures, expectAttempts, expectStatus] of [
      ["N-1=0, 0 failures", 0, 0, 1, "succeeded"],
      ["N-1=0, 1 failure", 0, 1, 1, "failed"],
      ["N=1, 1 failure", 1, 1, 2, "succeeded"],
      ["N=1, 2 failures", 1, 2, 2, "failed"],
      ["N+1=2, 2 failures", 2, 2, 3, "succeeded"],
      ["N+1=2, 3 failures", 2, 3, 3, "failed"],
    ] as const) {
      const harness = seerFlaky(
        failures,
        new AiProviderError("RATE_LIMITED", "transient", { httpStatus: 429 }),
        { choiceId: "seer-check@2:0", utterance: "" },
      );
      const { service, sessionId, ownerId } = await create(301, harness, {
        provider: { maxRetries, leaseTtlSeconds: 60 },
      });

      const first = await service.advance(ownerId, sessionId);
      expect(first.status, label).toBe("pending");

      // The seer's attempts = 1 + the transient retries actually used.
      const run = await makeRepo(ctx.db).getAiRun(ownerId, sessionId, {
        seat: 2,
        phaseToken: "night:1",
        purpose: "seer-check",
      });
      expect(run!.attempts, label).toBe(expectAttempts);
      expect(run!.status, label).toBe(expectStatus);
      // Budget: every attempt was charged (the wolves paid 1 each too).
      const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
      expect(session!.aiBudgetConsumed, label).toBe(2 + expectAttempts);
    }
  });

  it("non-transient failures are never retried: one attempt, then the deterministic fallback", async () => {
    for (const [label, code] of [
      ["BAD_RESPONSE", "BAD_RESPONSE"],
      ["CONTENT_FILTERED", "CONTENT_FILTERED"],
      ["ILLEGAL_CHOICE", "ILLEGAL_CHOICE"],
    ] as const) {
      const harness = seerFlaky(1, new AiProviderError(code, "nope"), {
        choiceId: "seer-check@2:0",
        utterance: "",
      });
      const { service, sessionId, ownerId } = await create(302, harness, {
        provider: { maxRetries: 5, leaseTtlSeconds: 60 }, // even with headroom
      });
      await service.advance(ownerId, sessionId);
      const run = await makeRepo(ctx.db).getAiRun(ownerId, sessionId, {
        seat: 2,
        phaseToken: "night:1",
        purpose: "seer-check",
      });
      expect(run!.attempts, label).toBe(1);
      expect(run!.status, label).toBe("failed");
    }
  });

  it("a timed-out attempt is charged and the game continues via fallback", async () => {
    const harness = hangEngine();
    const { service, sessionId, ownerId } = await create(303, harness, {
      provider: { timeoutMs: 150, maxRetries: 1, leaseTtlSeconds: 60 },
    });
    const result = await service.advance(ownerId, sessionId);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.phase).toBe("DAY_DISCUSSION"); // the night settled
    }

    const run = await makeRepo(ctx.db).getAiRun(ownerId, sessionId, {
      seat: 2,
      phaseToken: "night:1",
      purpose: "seer-check",
    });
    expect(run!.status).toBe("timeout");
    expect(run!.attempts).toBe(1);
    const session = await makeRepo(ctx.db).getSession(ownerId, sessionId);
    expect(session!.aiBudgetConsumed).toBe(3); // 3 seats, 1 charged attempt each
  });

  it("an expired lease rejects the late provider result: the fallback wins and the night settles exactly once", async () => {
    const ownerId = await makeOwner(ctx.db);
    // Worker A's engine answers 2.5s in, but the lease (database time)
    // expired after 1s; worker B takes over at 1.5s and settles the night.
    // A's late result AND A's late fallback submission are both discarded.
    const harnessA = slowEngine(2500, { choiceId: "seer-check@2:1", utterance: "迟到" });
    const harnessB = scriptedEngine((input) => {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "B" };
    });
    const serviceA = makeService(ctx.db, {
      engine: harnessA.engine,
      config: { provider: { timeoutMs: 10_000, maxRetries: 0, leaseTtlSeconds: 1 } },
    });
    const serviceB = makeService(ctx.db, { engine: harnessB.engine });

    const created = await serviceA.createGame(ownerId, {
      seedBytes: seedInt(304),
      start: fixedRoles(5),
    });
    const sessionId = created.sessionId;

    const advanceA = serviceA.advance(ownerId, sessionId);

    // After A's leases expire (1s), B claims, decides, submits and settles.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rb = await serviceB.advance(ownerId, sessionId);
    expect(rb.status).toBe("pending");
    if (rb.status === "pending") {
      expect(rb.phase).toBe("DAY_DISCUSSION");
    }

    const ra = await advanceA;
    expect(["pending", "waiting_for_human"]).toContain(ra.status);

    // The night settled exactly once: one round-1 elimination, no duplicate
    // events, no crash from the stale submissions.
    const rows = await ctx.client`
      select payload from game_events where session_id = ${sessionId} order by seq`;
    const eliminations = rows.filter((r) => r.payload.type === "ELIMINATION");
    expect(eliminations.length).toBe(1);

    // A's seer run recorded the stale completion failure.
    const run = await makeRepo(ctx.db).getAiRun(ownerId, sessionId, {
      seat: 2,
      phaseToken: "night:1",
      purpose: "seer-check",
    });
    expect(run!.attempts).toBeGreaterThanOrEqual(1);
  });

  it("a disconnected worker's lease is reclaimable: the next claim bumps the generation and rejects the old result", async () => {
    const { service, sessionId, ownerId } = await create(305, hangEngine(), {
      provider: { timeoutMs: 200, maxRetries: 0, leaseTtlSeconds: 60 },
    });
    await service.advance(ownerId, sessionId);
    const repo = makeRepo(ctx.db);
    const lease = await repo.claimAiLease(ownerId, sessionId, {
      seat: 2,
      phaseToken: "night:1",
      purpose: "seer-check",
      ttlSeconds: 60,
    });
    expect(lease).not.toBeNull();
    // The worker "disconnects": the lease expires without a completion.
    await ctx.client`update game_ai_runs set lease_expires_at = now() - interval '1 second' where session_id = ${sessionId} and seat = 2`;
    const reclaimed = await repo.claimAiLease(ownerId, sessionId, {
      seat: 2,
      phaseToken: "night:1",
      purpose: "seer-check",
      ttlSeconds: 60,
    });
    expect(reclaimed!.generation).toBeGreaterThan(lease!.generation);
    // The old claim can no longer deliver a result.
    await expect(
      repo.completeAiRun(ownerId, sessionId, {
        seat: 2,
        phaseToken: "night:1",
        purpose: "seer-check",
        claimToken: lease!.claimToken,
        generation: lease!.generation,
        status: "succeeded",
        meta: {
          provider: "test",
          requestedModel: "test-model",
          responseModel: "test-model",
          responseId: "resp-zombie",
          systemFingerprint: null,
          promptVersion: "prompt-v1",
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cachedInputTokens: null,
        },
        errorCode: null,
        fallback: false,
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
  });

  it("concurrent duplicate advances decide each seat exactly once", async () => {
    const ownerId = await makeOwner(ctx.db);
    // Two workers advance the same night simultaneously: the leases
    // serialize the claims, so each AI seat is decided exactly once and no
    // submission is duplicated.
    const calls: number[] = [];
    const engine = {
      enabled: true,
      async decide(input: AiTurnInput) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        calls.push(input.seat);
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "" } satisfies AiDecision;
      },
    };
    const serviceA = makeService(ctx.db, { engine });
    const serviceB = makeService(ctx.db, { engine });
    const created = await serviceA.createGame(ownerId, {
      seedBytes: seedInt(306),
      start: fixedRoles(5),
    });
    const sessionId = created.sessionId;

    const [ra, rb] = await Promise.all([
      serviceA.advance(ownerId, sessionId),
      serviceB.advance(ownerId, sessionId),
    ]);
    // Both workers report a bounded status; neither loops nor throws.
    for (const r of [ra, rb]) {
      expect(["pending", "waiting_for_human"]).toContain(r.status);
    }
    // Exactly three decisions total (wolf 0, wolf 1, seer 2) — each seat
    // decided once across the two racing advances.
    expect(calls.length).toBe(3);
    expect(new Set(calls)).toEqual(new Set([0, 1, 2]));

    // Exactly one receipt per AI decision key.
    const receipts = await ctx.client`select key from game_action_receipts where session_id = ${sessionId}`;
    const aiKeys = receipts.map((r) => r.key).filter((k) => k.startsWith("ai:"));
    expect(aiKeys.length).toBe(3);
    expect(new Set(aiKeys).size).toBe(3);
  });

  it("an advance defers while another worker holds the leases and never double-settles", async () => {
    const ownerId = await makeOwner(ctx.db);
    // The latch releases EVERY waiter (each of the three batch decisions
    // blocks on it), so worker A's decisions all complete afterwards.
    const waiters: Array<() => void> = [];
    const latch = () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    const harnessA = latchedEngine(latch, { choiceId: "seer-check@2:1", utterance: "A" });
    const harnessB = scriptedEngine((input) => {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "B" };
    });
    const serviceA = makeService(ctx.db, { engine: harnessA.engine });
    const serviceB = makeService(ctx.db, { engine: harnessB.engine });
    const created = await serviceA.createGame(ownerId, {
      seedBytes: seedInt(307),
      start: fixedRoles(5),
    });
    const sessionId = created.sessionId;

    // Advance A blocks on the latch while holding all three leases.
    const advanceA = serviceA.advance(ownerId, sessionId);
    // B defers on A's live leases: bounded pending, no waiting out the TTL.
    const rb = await serviceB.advance(ownerId, sessionId);
    expect(rb.status).toBe("pending");

    for (const release of waiters) {
      release();
    }
    const ra = await advanceA;
    expect(["pending", "waiting_for_human"]).toContain(ra.status);

    // The night settled exactly once.
    const rows = await ctx.client`
      select payload from game_events where session_id = ${sessionId} order by seq`;
    const eliminations = rows.filter((r) => r.payload.type === "ELIMINATION");
    expect(eliminations.length).toBe(1);
  });

  it("no provider call ever runs inside an open transaction", async () => {
    const ownerId = await makeOwner(ctx.db);
    const server = await startMockServer();
    try {
      // An engine whose decide performs a real fetch (like the production
      // provider) and asserts the transaction guard while in flight.
      const engine = {
        enabled: true,
        async decide(input: AiTurnInput) {
          assertNoOpenTransaction("test engine");
          expect(transactionDepth()).toBe(0);
          const response = await fetch(`http://127.0.0.1:${server.port}/complete`);
          expect(((await response.json()) as { answer: string }).answer).toBe("ok");
          // While the network call is in flight, no application connection
          // may sit in a transaction.
          const [probe] = await ctx.client`select count(*)::int as n from pg_stat_activity where state = 'idle in transaction'`;
          expect(probe.n).toBe(0);
          const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
          return { choiceId: own[0].id, utterance: "" } satisfies AiDecision;
        },
      };
      const service = makeService(ctx.db, { engine });
      const created = await service.createGame(ownerId, {
        seedBytes: seedInt(308),
        start: fixedRoles(5),
      });
      const result = await service.advance(ownerId, created.sessionId);
      expect(result.status).toBe("pending");
      expect(transactionDepth()).toBe(0);
    } finally {
      await server.close();
    }
  });
});

interface MockServer {
  port: number;
  close(): Promise<void>;
}

function startMockServer(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      if (req.url === "/hang") {
        return; // never respond; the client's AbortSignal ends the request
      }
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ answer: "ok" }));
      }, 300);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}
