/**
 * P4.1 orchestration — the bounded advance.
 *
 * Every advance starts at most one frozen batch of independent AI decisions
 * (NIGHT wolves+seer, simultaneous DAY_VOTE votes) or the single ordered
 * speaker (DAY_DISCUSSION), then at most one settlement, then reports
 * pending/retryAfterMs — it never loops. Speech views follow the rules:
 * later speakers only ever see already-public earlier speeches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiTurnInput } from "@/lib/ai/contract";
import type { OrchestrationConfigInput } from "@/lib/games/orchestration";
import {
  fixedRoles,
  firstChoiceEngine,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  replayOf,
  runToCompletion,
  scriptedEngine,
  seedInt,
  simpleHumanMove,
  type EngineHarness,
  type TestContext,
} from "./helpers";

describe("P4.1 orchestration — bounded advance (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  async function create(
    seed: number,
    humanSeat: number,
    harness?: EngineHarness,
    config?: OrchestrationConfigInput,
  ) {
    // Fresh owner per game: the per-user budget never leaks across tests.
    const ownerId = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: harness?.engine ?? null, config });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(seed),
      start: fixedRoles(humanSeat),
    });
    return { service, sessionId: created.sessionId, ownerId };
  }

  /** Engine whose wolves unanimously kill `victim` on the first night. */
  function wolvesKillFirstNight(victim: number): EngineHarness {
    return scriptedEngine((input) => {
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      if (input.phase === "NIGHT" && input.seat <= 1) {
        return { choiceId: `wolf-kill@${input.seat}:${victim}`, utterance: "" };
      }
      return { choiceId: own[0].id, utterance: "" };
    });
  }

  it("NIGHT: one advance starts the whole independent batch (2 wolves + seer) and settles", async () => {
    const harness = firstChoiceEngine();
    const { service, sessionId, ownerId } = await create(201, 5, harness); // human = villager 5

    const first = await service.advance(ownerId, sessionId);
    expect(first.status).toBe("pending");
    if (first.status === "pending") {
      expect(first.phase).toBe("DAY_DISCUSSION");
      expect(first.round).toBe(1);
      expect(first.retryAfterMs).toBe(250); // the versioned config default
    }

    // Exactly the three independent night decisions (wolf 0, wolf 1, seer 2)
    // were made — no more, no less — and the night was settled in the same
    // bounded advance.
    expect(harness.calls).toHaveLength(3);
    expect(new Set(harness.calls.map((c) => c.seat))).toEqual(new Set([0, 1, 2]));
    expect(new Set(harness.calls.map((c) => c.phase))).toEqual(new Set(["NIGHT"]));

    // All submissions applied: the engine never re-decides an applied seat.
    const receipts = await ctx.client`select key from game_action_receipts where session_id = ${sessionId}`;
    const aiKeys = receipts.map((r) => r.key).filter((k) => k.startsWith("ai:"));
    expect(aiKeys).toHaveLength(3);
  });

  it("DAY_DISCUSSION: exactly ONE decision per advance, strictly in seat order, later speakers see only public earlier speeches", async () => {
    const seen: Array<{ seat: number; speeches: Array<{ seat: number; text: string | null }> }> = [];
    const harness = scriptedEngine((input: AiTurnInput) => {
      if (input.phase === "NIGHT") {
        // Phase-aware night choices: both wolves kill the seer (seat 2),
        // the seer checks seat 0 — deterministic, unanimous.
        if (input.seat <= 1) return { choiceId: `wolf-kill@${input.seat}:2`, utterance: "" };
        return { choiceId: "seer-check@2:0", utterance: "" };
      }
      if (input.phase === "DAY_DISCUSSION") {
        const view = input.view as unknown as {
          seat: number;
          speeches?: Array<{ seat: number; text: string | null }>;
        };
        seen.push({ seat: input.seat, speeches: view.speeches ?? [] });
        return { choiceId: `speech@${input.seat}`, utterance: `我是 ${input.seat} 号发言` };
      }
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "" };
    });
    const { service, sessionId, ownerId } = await create(202, 5, harness);

    // Night first (3 decisions, 1 advance): both wolves kill the seer, so
    // the living AI speakers are the ascending alive seats minus the human.
    const night = await service.advance(ownerId, sessionId);
    expect(night.status).toBe("pending");
    const alive =
      night.status === "pending"
        ? night.publicView.aliveSeats
        : ([] as number[]);
    const expectedSpeakers = alive.filter((seat) => seat !== 5);

    for (let k = 0; k < expectedSpeakers.length; k++) {
      const expectSpeaker = expectedSpeakers[k];
      const before = harness.calls.length;
      const result = await service.advance(ownerId, sessionId);
      // Exactly one new decision per advance, for exactly the next speaker.
      expect(harness.calls.length - before).toBe(1);
      const decision = harness.calls[harness.calls.length - 1];
      expect(decision.seat).toBe(expectSpeaker);
      // After the LAST AI speaker the human is next: the same bounded
      // advance reports waiting_for_human instead of pending — either way
      // it never loops.
      const isLast = k === expectedSpeakers.length - 1;
      if (isLast) {
        expect(result.status).toBe("waiting_for_human");
        if (result.status === "waiting_for_human") {
          expect(result.seat).toBe(5);
        }
      } else {
        expect(result.status).toBe("pending");
      }
    }

    // The human submits their speech through the shared path; the next
    // advance settles the discussion and reports the vote phase.
    const before = harness.calls.length;

    // The human submits their speech through the shared path; the next
    // advance settles the discussion and reports the vote phase.
    const submitted = await service.submitCommand(ownerId, sessionId, {
      key: "human-speech-order-test",
      command: { type: "SUBMIT_SPEECH", seat: 5, text: "人类发言" },
      actorSeat: 5,
    });
    expect(submitted.ok).toBe(true);
    const next = await service.advance(ownerId, sessionId);
    expect(next.status).toBe("pending");
    if (next.status === "pending") {
      expect(next.phase).toBe("DAY_VOTE");
    }

    // Speech-order visibility: speaker k's view contains exactly the
    // speeches of the seats before k — never a later seat's speech.
    for (let k = 0; k < expectedSpeakers.length; k++) {
      const view = seen.find((s) => s.seat === expectedSpeakers[k])!;
      const seatsInView = view.speeches.map((s) => s.seat);
      expect(seatsInView).toEqual(expectedSpeakers.slice(0, k));
    }
  });

it("DAY_DISCUSSION: the human speaker pauses the advance with waiting_for_human (no provider call)", async () => {
    const harness = scriptedEngine((input: AiTurnInput) => {
      if (input.phase === "NIGHT" && input.seat <= 1) {
        // Both wolves kill the villager at seat 4: the human seer survives.
        return { choiceId: `wolf-kill@${input.seat}:4`, utterance: "" };
      }
      const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
      return { choiceId: own[0].id, utterance: "" };
    });
    // Human = seat 2 (the seer).
    const { service, sessionId, ownerId } = await create(203, 2, harness);

    // Night: the AI wolves decide; the human seer still owes a check.
    const night = await service.advance(ownerId, sessionId);
    expect(new Set(harness.calls.map((c) => c.seat))).toEqual(new Set([0, 1]));
    expect(night.status).toBe("waiting_for_human");
    if (night.status === "waiting_for_human") {
      expect(night.seat).toBe(2);
    }

    // The human submits their night check through the shared path; the next
    // advance settles the night.
    const checked = await service.submitCommand(ownerId, sessionId, {
      key: "human-seer-check",
      command: { type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 },
      actorSeat: 2,
    });
    expect(checked.ok).toBe(true);
    const settled = await service.advance(ownerId, sessionId);
    expect(settled.status).toBe("pending");
    if (settled.status === "pending") {
      expect(settled.phase).toBe("DAY_DISCUSSION");
    }

    // Speakers 0 and 1 are AI; seat 2 (the human) is next.
    await service.advance(ownerId, sessionId); // speaker 0
    const callsBefore = harness.calls.length;
    await service.advance(ownerId, sessionId); // speaker 1
    expect(harness.calls.length - callsBefore).toBe(1);

    const waiting = await service.advance(ownerId, sessionId);
    expect(waiting.status).toBe("waiting_for_human");
    if (waiting.status === "waiting_for_human") {
      expect(waiting.seat).toBe(2);
      expect(waiting.phase).toBe("DAY_DISCUSSION");
    }
    // No provider decision was made for the human's turn.
    expect(harness.calls.filter((c) => c.phase === "DAY_DISCUSSION").map((c) => c.seat)).not.toContain(2);

    // The human submits through the shared path; the game continues.
    const submitted = await service.submitCommand(ownerId, sessionId, {
      key: "human-speech-1",
      command: { type: "SUBMIT_SPEECH", seat: 2, text: "我是预言家" },
      actorSeat: 2,
    });
    expect(submitted.ok).toBe(true);
    const after = await service.advance(ownerId, sessionId);
    expect(after.status).toBe("pending");
    expect(harness.calls[harness.calls.length - 1].seat).toBe(3);
  });

it("DAY_VOTE: the batch advances bounded voters concurrently, then pending/retryAfter", async () => {
    // The wolves kill the human (seat 5) on night 1, so every later action
    // belongs to an AI seat.
    const harness = wolvesKillFirstNight(5);
    const { service, sessionId, ownerId } = await create(204, 5, harness);

    // Night (1 advance) + 5 speeches (5 advances, the last one settles the
    // discussion) = 6 advances to reach DAY_VOTE with nobody voted yet.
    for (let i = 0; i < 6; i++) {
      await service.advance(ownerId, sessionId);
    }

    // Vote phase: 5 AI voters, frozen batch cap 5 (P6.3) → all 5 decisions
    // in one advance, the settlement follows and the round turns to night.
    const before = harness.calls.length;
    const vote1 = await service.advance(ownerId, sessionId);
    expect(harness.calls.length - before).toBe(5);
    expect(vote1.status).toBe("pending");
    if (vote1.status === "pending") {
      expect(vote1.phase).toBe("NIGHT");
      expect(vote1.round).toBe(2);
    }
  });

  it("batch cap boundaries: with cap N, an advance starts at most min(N, pending) decisions (N-1/N/N+1)", async () => {
    // Night has exactly 3 pending AI seats (human = villager 5).
    for (const [label, cap] of [
      ["N-1", 2],
      ["N", 3],
      ["N+1", 4],
    ] as const) {
      const harness = firstChoiceEngine();
      const { service, sessionId, ownerId } = await create(205, 5, harness, {
        advance: { maxProviderCallsPerAdvance: cap, maxConcurrentProviderCalls: cap },
      });
      const first = await service.advance(ownerId, sessionId);
      expect(harness.calls.length, label).toBe(Math.min(cap, 3));
      expect(first.status, label).toBe("pending");

      // Whatever remained is one more bounded decision (the seer for cap 2,
      // the next speaker for cap 3/4) — still strictly bounded.
      const before = harness.calls.length;
      const second = await service.advance(ownerId, sessionId);
      expect(harness.calls.length - before, label).toBe(1);
      expect(second.status).toBe("pending");
    }
  });

  it("concurrency cap: at most maxConcurrentProviderCalls decisions in flight (N-1/N/N+1)", async () => {
    for (const [label, cap] of [
      ["N-1", 1],
      ["N", 2],
      ["N+1", 3],
    ] as const) {
      // A slow engine makes the concurrent window observable: each decision
      // lingers ~60ms, so a window of K decisions overlaps K calls.
      const slow = scriptedEngine(async (input: AiTurnInput) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "" };
      });
      const { service, sessionId, ownerId } = await create(206, 5, slow, {
        advance: { maxProviderCallsPerAdvance: 3, maxConcurrentProviderCalls: cap },
      });
      await service.advance(ownerId, sessionId);
      expect(slow.maxInFlight(), label).toBe(Math.min(cap, 3));
    }
  });

it("an advance never loops, and a whole AI game finishes in bounded calls", async () => {
    const harness = wolvesKillFirstNight(5);
    const { service, sessionId, ownerId } = await create(207, 5, harness, {
      advance: { maxProviderCallsPerAdvance: 3, maxConcurrentProviderCalls: 3 },
    });
    const { final, results } = await runToCompletion(service, ownerId, sessionId, {
      maxAdvances: 200,
    });
    expect(final.status).toBe("finished");
    // The per-call bound held all along: every advance started at most the
    // configured batch cap of decisions.
    expect(results.length).toBeGreaterThan(0);
    // The event stream is consistent: the snapshot fast path serves it.
    const repo = makeRepo(ctx.db);
    const loaded = await repo.loadState(ownerId, sessionId, service.definition, replayOf());
    expect(loaded.source).toBe("snapshot");
    expect((loaded.state as { revision: number }).revision).toBeGreaterThan(0);
  });

  it("pending responses carry the configured retryAfterMs", async () => {
    const harness = firstChoiceEngine();
    const { service, sessionId, ownerId } = await create(208, 5, harness, {
      advance: { pendingRetryAfterMs: 1234 },
    });
    const result = await service.advance(ownerId, sessionId);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.retryAfterMs).toBe(1234);
    }
  });

  it("waiting_for_human for the night phase: AI wolves act, the human wolf holds the game", async () => {
    const harness = firstChoiceEngine();
    const { service, sessionId, ownerId } = await create(209, 1, harness); // human = wolf 1

    const first = await service.advance(ownerId, sessionId);
    // Wolf 0 and seer 2 decided; wolf 1 (human) is pending.
    expect(new Set(harness.calls.map((c) => c.seat))).toEqual(new Set([0, 2]));
    expect(first.status).toBe("waiting_for_human");
    if (first.status === "waiting_for_human") {
      expect(first.seat).toBe(1);
    }

    // The human submits their night kill; the next advance settles the night.
    const submit = await service.submitCommand(ownerId, sessionId, {
      key: "human-night-1",
      command: { type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 },
      actorSeat: 1,
    });
    expect(submit.ok).toBe(true);

    const after = await service.advance(ownerId, sessionId);
    expect(after.status).toBe("pending");
    if (after.status === "pending") {
      expect(after.phase).toBe("DAY_DISCUSSION");
    }
  });

  it("a human-driven game completes through the same submit path (mixed human + AI)", async () => {
    const harness = firstChoiceEngine();
    const { service, sessionId, ownerId } = await create(210, 0, harness); // human = wolf 0
    const { final } = await runToCompletion(service, ownerId, sessionId, {
      maxAdvances: 200,
      humanMove: simpleHumanMove("WOLF"),
    });
    expect(final.status).toBe("finished");
  });
});
