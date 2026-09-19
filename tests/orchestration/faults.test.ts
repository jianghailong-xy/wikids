/**
 * P4.1 orchestration — fault handling and the deterministic fallback.
 *
 * Timeouts, 429/5xx, malformed responses, illegal targets, content filters,
 * budget exhaustion, the feature switch off and a missing key must all
 * clear the pending decision and let the WHOLE game run to completion via
 * the deterministic fallback — no permanent pending, no stuck phase. The
 * fallback derives purely from (seed, phaseToken, seat, purpose) over the
 * legal choice ids, so the same seed always reaches the same terminal
 * event stream regardless of which fault occurred or in which order
 * concurrent submissions completed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiTurnInput } from "@/lib/ai/contract";
import type { OrchestrationConfigInput } from "@/lib/games/orchestration";
import { AiProviderError } from "@/lib/ai/errors";
import {
  canonicalEventStreamOf,
  failingEngine,
  fixedRoles,
  firstChoiceEngine,
  illegalChoiceEngine,
  makeOwner,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  slowEngine,
  type EngineHarness,
  type TestContext,
} from "./helpers";

describe("P4.1 orchestration — faults and deterministic fallback (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  const SEED = 401;

  interface Variant {
    label: string;
    harness: EngineHarness | null; // null engine = no key
    config?: OrchestrationConfigInput;
  }

  const variants: Variant[] = [
    {
      label: "rate limited (429)",
      harness: failingEngine("RATE_LIMITED"),
    },
    {
      label: "upstream 5xx",
      harness: failingEngine("UPSTREAM_UNAVAILABLE"),
    },
    {
      label: "malformed response",
      harness: failingEngine("BAD_RESPONSE"),
    },
    {
      label: "illegal target (unauthorized choice id)",
      harness: illegalChoiceEngine(),
    },
    {
      label: "content filtered",
      harness: failingEngine("CONTENT_FILTERED"),
    },
    {
      label: "transport failure (plain network error)",
      harness: failingEngine("plain"),
    },
    {
      label: "per-attempt timeout",
      harness: slowEngine(1200, { choiceId: "seer-check@2:0", utterance: "" }),
      config: { provider: { timeoutMs: 100, maxRetries: 0, leaseTtlSeconds: 60 } },
    },
    {
      label: "budget exhausted (attempts)",
      harness: failingEngine("RATE_LIMITED"),
      config: { game: { maxHttpAttempts: 1 } },
    },
    {
      label: "feature switch off",
      harness: firstChoiceEngine(), // a healthy engine that must never run
      config: { provider: { enabled: false } },
    },
    {
      label: "no key (no engine)",
      harness: null,
    },
  ];

  it.each(variants)("$label: the whole game completes via the deterministic fallback", async (variant) => {
    const ownerId = await makeOwner(ctx.db); // per-variant isolation
    const service = makeService(ctx.db, {
      engine: variant.harness?.engine ?? null,
      config: variant.config,
    });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(SEED),
      start: fixedRoles(5), // human = villager 5, driven through the shared path
    });

    const { final } = await runToCompletion(service, ownerId, created.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    // No permanent pending, no stuck phase: the game reached a terminal
    // outcome with a winner.
    expect(final.status).toBe("finished");
    if (final.status === "finished") {
      expect(["TOWN", "WOLF"]).toContain(final.winner);
      expect(final.publicView.rolesRevealed).not.toBeNull();
    }

    // The switch-off / no-key variants never reached the provider at all.
    if (variant.label === "feature switch off") {
      expect((variant.harness as EngineHarness).calls.length).toBe(0);
    }
  });

  it("the fallback is deterministic: every fault variant reaches the identical terminal event stream", async () => {
    const streams: string[] = [];
    for (const variant of variants) {
      const ownerId = await makeOwner(ctx.db); // per-variant isolation
      const service = makeService(ctx.db, {
        engine: variant.harness?.engine ?? null,
        config: variant.config,
      });
      const created = await service.createGame(ownerId, {
        seedBytes: seedInt(SEED),
        start: fixedRoles(5),
      });
      const { final } = await runToCompletion(service, ownerId, created.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, variant.label).toBe("finished");
      streams.push(JSON.stringify(await canonicalEventStreamOf(ctx.db, service, ownerId, created.sessionId)));
    }
    // Same seed → same stream, whatever the fault or the completion order.
    for (const stream of streams.slice(1)) {
      expect(stream).toBe(streams[0]);
    }
  });

  it("the fallback choice derives from (seed, phaseToken, seat, purpose) and ignores completion order", async () => {
    // Two sessions, same seed: one worker's decisions take longer (a
    // different concurrent completion order), but the fallback for each
    // seat stays identical and so does the terminal stream.
    const ownerId = await makeOwner(ctx.db);
    const slowService = makeService(ctx.db, {
      engine: failingEngine("RATE_LIMITED").engine, // fail after a per-seat delay
    });
    const delayedService = makeService(ctx.db, {
      engine: (() => {
        const base = failingEngine("RATE_LIMITED");
        const inner = base.engine;
        return {
          engine: {
            enabled: true,
            async decide(input: AiTurnInput, signal?: AbortSignal, reportUsage?: (u: { readonly totalTokens: number }) => void) {
              await new Promise((resolve) => setTimeout(resolve, (input.seat % 3) * 25));
              return inner.decide(input, signal, reportUsage ?? (() => {}));
            },
          },
        };
      })().engine,
    });

    const a = await slowService.createGame(ownerId, { seedBytes: seedInt(402), start: fixedRoles(5) });
    const b = await delayedService.createGame(ownerId, { seedBytes: seedInt(402), start: fixedRoles(5) });

    const [ra, rb] = await Promise.all([
      runToCompletion(slowService, ownerId, a.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      }),
      runToCompletion(delayedService, ownerId, b.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      }),
    ]);
    expect(ra.final.status).toBe("finished");
    expect(rb.final.status).toBe("finished");

    const streamA = JSON.stringify(await canonicalEventStreamOf(ctx.db, slowService, ownerId, a.sessionId));
    const streamB = JSON.stringify(await canonicalEventStreamOf(ctx.db, delayedService, ownerId, b.sessionId));
    expect(streamB).toBe(streamA);
  });

  it("the provider receives only the seat's authorized projection — never the full state", async () => {
    // Every engine invocation in this suite observes the contract input; in
    // particular the view must be the seat-scoped projection with no
    // server-private fields, and the decision is re-verified by the rules.
    const ownerId = await makeOwner(ctx.db);
    const views: unknown[] = [];
    const engine = {
      enabled: true,
      async decide(input: AiTurnInput) {
        views.push(input.view);
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "" };
      },
    };
    const service = makeService(ctx.db, { engine });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(403),
      start: fixedRoles(5),
    });
    await service.advance(ownerId, created.sessionId);

    expect(views.length).toBe(3);
    for (const view of views) {
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain("seedBytes");
      expect(serialized).not.toContain("nightWolfKills");
      expect(serialized).not.toContain("roles\":[");
      expect(serialized).not.toContain("state");
    }
  });
});
