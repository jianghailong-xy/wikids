/**
 * P4.1 orchestration — the application service surface: create (with the
 * per-user concurrent-games budget), resume (single-projector views) and
 * submitCommand (the one path human and AI submissions share).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertIsolatedOrchestrationDatabaseUrl } from "@/lib/db/isolated-db";
import { QUICK6_GAME_VERSIONS } from "@/lib/games/werewolf";
import type { Quick6Command } from "@/lib/games/werewolf";
import {
  fixedRoles,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  type TestContext,
} from "./helpers";

describe("P4.1 orchestration — service surface (isolated real Postgres)", () => {
  let ctx: TestContext;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ctx = await openContext();
    ownerA = await makeOwner(ctx.db);
    ownerB = await makeOwner(ctx.db);
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("refuses the development DATABASE_URL and accepts the isolated one", () => {
    expect(() =>
      assertIsolatedOrchestrationDatabaseUrl("postgres://postgres:postgres@localhost:5432/wikids"),
    ).toThrow(/refusing development DATABASE_URL/);
    expect(() =>
      assertIsolatedOrchestrationDatabaseUrl("postgres://x@localhost:5432/wikids"),
    ).toThrow();
    expect(() => assertIsolatedOrchestrationDatabaseUrl(process.env.DATABASE_URL as string)).not.toThrow();
  });

  it("create seeds the session, projects views through the single projector and honors the HTTP-attempt budget", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const created = await service.createGame(testOwner, {
      seedBytes: seedInt(101),
      start: fixedRoles(0),
    });

    expect(created.revision).toBe(0);
    expect(created.phaseToken).toBe("night:1");
    // Public view: no roles before END, no private night buffers.
    expect(created.publicView.rolesRevealed).toBeNull();
    expect(JSON.stringify(created.publicView)).not.toContain("seed");
    expect(JSON.stringify(created.publicView)).not.toContain("WOLF");
    // The human seat's own view: exactly its own role, nothing else private.
    expect(created.ownView.seat).toBe(0);
    expect(created.ownView.ownRole).toBe("WOLF");
    expect(created.ownView.wolfTeammates).toEqual([1]);

    // The session carries the config's maxHttpAttempts as ai_budget_limit.
    const session = await makeRepo(ctx.db).getSession(testOwner, created.sessionId);
    expect(session!.aiBudgetLimit).toBe(60); // DEFAULT config maxHttpAttempts (P6.3 frozen)
    expect(session!.versions).toEqual(QUICK6_GAME_VERSIONS);
  });

  it("create with a custom config seeds the per-game HTTP-attempt budget from the versioned config", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, {
      engine: null,
      config: { game: { maxHttpAttempts: 37 } },
    });
    const created = await service.createGame(testOwner, {
      seedBytes: seedInt(102),
      start: fixedRoles(0),
    });
    const session = await makeRepo(ctx.db).getSession(testOwner, created.sessionId);
    expect(session!.aiBudgetLimit).toBe(37);
  });

  it("resume projects seat views vs the public view (roles stay hidden until END)", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const { sessionId } = await service.createGame(testOwner, {
      seedBytes: seedInt(103),
      start: fixedRoles(0),
    });

    const publicResume = await service.resumeGame(testOwner, sessionId);
    expect(publicResume.status).toBe("active");
    expect(publicResume.view).toMatchObject({ scope: "PUBLIC", phase: "NIGHT", round: 1 });
    expect(JSON.stringify(publicResume.view)).not.toContain("WOLF");

    const seatView = await service.resumeGame(testOwner, sessionId, { viewer: { seat: 2 } });
    expect(seatView.view).toMatchObject({ scope: "PLAYER", seat: 2, ownRole: "SEER" });
    // The seer never learns who the wolves are (empty team list, never TEAM scope).
    expect(seatView.view).toMatchObject({ wolfTeammates: [] });

    const wolfView = await service.resumeGame(testOwner, sessionId, { viewer: { seat: 1 } });
    expect(wolfView.view).toMatchObject({ scope: "TEAM_WOLVES", wolfTeammates: [0] });

    await expect(service.resumeGame(ownerB, sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("submitCommand: the human submits through the shared path (applied, replayed, conflicted)", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const { sessionId } = await service.createGame(testOwner, {
      seedBytes: seedInt(104),
      start: fixedRoles(0),
    });
    const command: Quick6Command = { type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 };

    const first = await service.submitCommand(testOwner, sessionId, { key: "k1", command, actorSeat: 0 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.applied).toBe(true);
      expect(first.revision).toBe(1);
    }

    // Same key + same command: replayed from the stored receipt, applied once.
    const second = await service.submitCommand(testOwner, sessionId, { key: "k1", command, actorSeat: 0 });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.applied).toBe(false);
      expect(second.revision).toBe(1);
    }

    // Same key + a different (still legal) command: idempotency conflict.
    const conflict = await service.submitCommand(testOwner, sessionId, {
      key: "k1",
      command: { type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 },
      actorSeat: 2,
    });
    expect(conflict).toMatchObject({ ok: false, error: "IDEMPOTENCY_CONFLICT" });

    const session = await makeRepo(ctx.db).getSession(testOwner, sessionId);
    expect(session!.revision).toBe(1);
  });

  it("submitCommand: rule validation, actor authorization and duplicate rejection", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const { sessionId } = await service.createGame(testOwner, {
      seedBytes: seedInt(105),
      start: fixedRoles(0),
    });

    // Illegal target (self) → ILLEGAL with the granular code.
    const illegal = await service.submitCommand(testOwner, sessionId, {
      key: "k2",
      command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 0 },
      actorSeat: 0,
    });
    expect(illegal).toMatchObject({ ok: false, error: "ILLEGAL", code: "SELF_TARGET" });

    // Acting for another seat → FORBIDDEN, even for a legal command.
    const forbidden = await service.submitCommand(testOwner, sessionId, {
      key: "k3",
      command: { type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 },
      actorSeat: 0,
    });
    expect(forbidden).toMatchObject({ ok: false, error: "FORBIDDEN" });

    // Settlement is system-only: a human can never settle a phase.
    const settle = await service.submitCommand(testOwner, sessionId, {
      key: "k4",
      command: { type: "FINISH_NIGHT" },
      actorSeat: 0,
    });
    expect(settle).toMatchObject({ ok: false, error: "FORBIDDEN" });

    // Wrong phase: a day vote during the night.
    const wrongPhase = await service.submitCommand(testOwner, sessionId, {
      key: "k5",
      command: { type: "SUBMIT_DAY_VOTE", seat: 0, target: 3 },
      actorSeat: 0,
    });
    expect(wrongPhase).toMatchObject({ ok: false, error: "ILLEGAL", code: "WRONG_PHASE" });

    // A legal submission applies; repeating it is rejected.
    const ok = await service.submitCommand(testOwner, sessionId, {
      key: "k6",
      command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 },
      actorSeat: 0,
    });
    expect(ok.ok).toBe(true);
    const dup = await service.submitCommand(testOwner, sessionId, {
      key: "k7",
      command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 4 },
      actorSeat: 0,
    });
    expect(dup).toMatchObject({ ok: false, error: "ILLEGAL", code: "DUPLICATE_ACTION" });

    expect((await makeRepo(ctx.db).getSession(testOwner, sessionId))!.revision).toBe(1);
  });

  it("terminal state absorbs every action and the resume reveals roles", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const { sessionId } = await service.createGame(testOwner, {
      seedBytes: seedInt(107),
      start: fixedRoles(0),
    });

    // Drive the whole game to completion with the fallback-only service and
    // a minimal deterministic human (the human is a wolf at seat 0).
    const { final } = await runToCompletion(service, testOwner, sessionId, {
      maxAdvances: 120,
      humanMove: simpleHumanMove("WOLF"),
    });
    expect(final.status).toBe("finished");

    // The run went through the shared path: every applied command has its
    // receipt, human and AI decisions alike.
    const receipts = await ctx.client`
      select key from game_action_receipts where session_id = ${sessionId}`;
    expect(receipts.length).toBeGreaterThan(0);
    const keys = receipts.map((r) => r.key as string);
    expect(keys.some((k) => k.startsWith("human:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("ai:"))).toBe(true);

    // After END the terminal state absorbs everything.
    const after = await service.submitCommand(testOwner, sessionId, {
      key: "post-end",
      command: { type: "SUBMIT_SPEECH", seat: 0, text: "再来一局" },
      actorSeat: 0,
    });
    expect(after).toMatchObject({ ok: false, error: "TERMINAL" });

    const resume = await service.resumeGame(testOwner, sessionId);
    expect(resume.status).toBe("finished");
    expect(resume.view).toMatchObject({ scope: "POST_GAME" });
    // Roles are revealed exactly at END.
    expect(JSON.stringify(resume.view)).toContain("WOLF");
    // And the session is no longer counted as active (per-user budget).
    const session = await makeRepo(ctx.db).getSession(testOwner, sessionId);
    expect(session!.status).toBe("finished");
  });

  it("per-user concurrent-games budget: N-1 ok, N ok, N+1 refused, freed on finish", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, {
      engine: null,
      config: { user: { maxConcurrentGames: 2 } },
    });
    const first = await service.createGame(testOwner, { seedBytes: seedInt(108), start: fixedRoles(0) });
    await service.createGame(testOwner, { seedBytes: seedInt(109), start: fixedRoles(0) });

    await expect(
      service.createGame(testOwner, { seedBytes: seedInt(110), start: fixedRoles(0) }),
    ).rejects.toMatchObject({ code: "USER_BUDGET_EXHAUSTED" });

    // Finish one game: the budget frees a slot.
    const { final } = await runToCompletion(service, testOwner, first.sessionId, {
      maxAdvances: 120,
      humanMove: simpleHumanMove("WOLF"),
    });
    expect(final.status).toBe("finished");

    const third = await service.createGame(testOwner, { seedBytes: seedInt(111), start: fixedRoles(0) });
    expect(third.sessionId).toBeTruthy();
  });

  it("an unknown session is NOT_FOUND and never leaks across owners", async () => {
    const testOwner = await makeOwner(ctx.db);
    const service = makeService(ctx.db, { engine: null });
    const { sessionId } = await service.createGame(testOwner, {
      seedBytes: seedInt(112),
      start: fixedRoles(0),
    });
    await expect(service.resumeGame(ownerB, sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.advance(ownerB, sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const submit = await service.submitCommand(ownerB, sessionId, {
      key: "x",
      command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 },
      actorSeat: 0,
    });
    expect(submit).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});
