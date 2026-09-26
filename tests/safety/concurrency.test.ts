/**
 * P6.3 concurrency budget: at most 5 provider calls in flight per advance
 * (orchestration-v2 frozen default), exercised at N-1/N/N+1 around the
 * natural quick6 batch maximum against the isolated real Postgres.
 *
 * quick6 facts: the round-1 night always eliminates one AI seat, so the
 * largest real batch is the round-1 DAY_VOTE with 4 AI voters (night
 * batches carry 3). The cap semantics are therefore exercised at
 * cap = 3 / 4 / 5 = N-1 / N / N+1: below the natural batch the cap binds
 * (waves), at the natural batch everything runs in parallel, above it the
 * cap never blocks natural parallelism — and the frozen default (5) is
 * exactly that N+1 headroom. The tracker asserts the real in-flight
 * maximum per config and that the cap is never exceeded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import {
  DEFAULT_ORCHESTRATION_CONFIG,
  type OrchestrationConfigInput,
} from "@/lib/games/orchestration";
import {
  fixedRoles,
  makeOwner,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  type TestContext,
} from "./helpers";

function trackingEngine(maxInFlight: { value: number }) {
  let inFlight = 0;
  let arrivals = 0;
  // Gather barrier instead of a fixed hold: each decision does DB work
  // (receipt read, budget reserve, lease claim) BEFORE decide() runs, and
  // that work is serialized by row locks — on a busy host the last member
  // of a concurrently launched batch can arrive later than a fixed hold,
  // which made the exact in-flight maximum flaky (observed: a 4-member
  // batch peaking at 3). Every member waits until no new arrival has been
  // seen for QUIET_MS, so a batch that really was launched concurrently
  // overlaps in full; a serialized launch shows up as peak 1 instead of a
  // lucky overlap. Groups are awaited sequentially by the service, so no
  // member of the NEXT group can arrive while this one gathers.
  const QUIET_MS = 300;
  return {
    enabled: true,
    async decide(input: AiTurnInput): Promise<AiDecision> {
      inFlight += 1;
      arrivals += 1;
      maxInFlight.value = Math.max(maxInFlight.value, inFlight);
      for (;;) {
        const seen = arrivals;
        await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
        if (arrivals === seen) break;
      }
      try {
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "" };
      } finally {
        inFlight -= 1;
      }
    },
  };
}

describe("P6.3 concurrency budget N-1/N/N+1 (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("the frozen default is 5 concurrent provider calls", () => {
    expect(DEFAULT_ORCHESTRATION_CONFIG.advance.maxConcurrentProviderCalls).toBe(5);
    expect(DEFAULT_ORCHESTRATION_CONFIG.advance.maxProviderCallsPerAdvance).toBe(5);
  });

  for (const [label, cap, expectMaxInFlight] of [
    // N-1 (3): the cap binds — the 4-voter vote batch runs in two waves.
    ["N-1", 3, 3],
    // N (4): the natural batch maximum — the whole vote batch in parallel.
    ["N", 4, 4],
    // N+1 (5): the frozen default — headroom never blocks parallelism.
    ["N+1", 5, 4],
  ] as const) {
    it(`concurrency ${cap} (${label}): in-flight calls never exceed the cap; the natural batch runs in parallel`, async () => {
      const ownerId = await makeOwner(ctx.db);
      const maxInFlight = { value: 0 };
      const service = makeService(ctx.db, {
        engine: trackingEngine(maxInFlight),
        config: {
          advance: {
            maxProviderCallsPerAdvance: 5,
            maxConcurrentProviderCalls: cap,
          } satisfies OrchestrationConfigInput["advance"],
        },
      });
      const created = await service.createGame(ownerId, {
        seedBytes: seedInt(910),
        start: fixedRoles(5),
      });
      const { final } = await runToCompletion(service, ownerId, created.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status, label).toBe("finished");
      // The tracker saw exactly the expected in-flight maximum: night
      // batches (3 seats) and the round-1 vote batch (4 voters) run under
      // the cap, and the cap is never exceeded.
      expect(maxInFlight.value, label).toBe(expectMaxInFlight);
      expect(maxInFlight.value, label).toBeLessThanOrEqual(cap);
    });
  }

  it("the frozen default config never exceeds 5 in flight across a whole game", async () => {
    const ownerId = await makeOwner(ctx.db);
    const maxInFlight = { value: 0 };
    const service = makeService(ctx.db, { engine: trackingEngine(maxInFlight) });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(911),
      start: fixedRoles(5),
    });
    const { final } = await runToCompletion(service, ownerId, created.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(final.status).toBe("finished");
    expect(maxInFlight.value).toBeLessThanOrEqual(5);
    expect(maxInFlight.value).toBeGreaterThanOrEqual(3); // parallelism happens
  });
});
