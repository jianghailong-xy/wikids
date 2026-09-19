/**
 * P3 persistence verification suite — runs ONLY against the isolated
 * throwaway Postgres started by scripts/verify-persistence.mjs (see
 * tests/persistence/setup.ts, which refuses anything else).
 *
 * Verifies with a real Postgres:
 * - migration-from-zero schema shape and the unique (session_id, seq) guard;
 * - owner scoping at the SQL level (another owner can neither see nor touch);
 * - atomic event append + snapshot commit (no partial visibility);
 * - revision/phase-token CAS (old revisions and old phase tokens write
 *   nothing), and exactly one winner among concurrent appends;
 * - idempotent receipts (same key + same hash replays the stored stable
 *   response and applies once; same key + different hash conflicts);
 * - snapshot cache discipline: missing / checksum-corrupt / seq-mismatched /
 *   version-mismatched snapshots are rejected and the identical state is
 *   rebuilt from the event stream;
 * - database-time AI leases: expiry-based reclamation, STALE_LEASE for old
 *   results, attempts + budget accounting for every provider attempt
 *   (timeouts, failures and retries), no network call inside a transaction;
 * - the deterministic (seed, phaseToken, seat, purpose)-derived fallback,
 *   immune to concurrent completion order, with the seed confined to the
 *   SYSTEM-private store.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GameRepository,
  PersistenceError,
  assertNoOpenTransaction,
  computeSnapshotChecksum,
  runAiTurn,
  sha256Hex,
  transactionDepth,
} from "@/lib/games/core";
import { deriveFallbackChoice } from "@/lib/games/core";
import type { AppendResult } from "@/lib/games/core";
import { assertIsolatedDatabaseUrl } from "@/lib/db/isolated-db";
import * as schema from "@/lib/db/schema";
import {
  QUICK6_DEFINITION_ID,
  QUICK6_GAME_VERSIONS,
  Quick6Definition,
  createQuick6Rng,
  replayQuick6,
  seedBytesFromInt,
  seedBytesToHex,
} from "@/lib/games/werewolf";
import type {
  Quick6Command,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
} from "@/lib/games/werewolf";
import { GameEngine } from "@/lib/games/core";

const url = process.env.DATABASE_URL as string;

let client: ReturnType<typeof postgres>;
let db: PostgresJsDatabase<typeof schema>;
let repo: GameRepository;
let ownerA: string;
let ownerB: string;

// Fixed role table so commands are deterministic: seats 0,1 wolves, seat 2
// seer, seats 3-5 villagers, human at seat 0.
const FIXED_ROLES: Quick6StartOptions = {
  roles: ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"],
  humanSeat: 0,
};

function makeReplay() {
  return (seedBytes: Uint8Array, options: unknown, events: readonly { seq: number; revision: number; payload: unknown }[]) =>
    replayQuick6(
      seedBytes,
      events.map((e, i) => {
        if (e.seq !== i) {
          throw new Error(`non-contiguous persisted event seq ${e.seq} at position ${i}`);
        }
        return { index: e.seq, revision: e.revision, payload: e.payload as Quick6EventPayload };
      }),
      options as Quick6StartOptions | undefined,
    );
}

async function createSession(ownerId: string, seedInt = 1, budgetLimit?: number) {
  return repo.createSession(
    ownerId,
    new Quick6Definition(),
    seedBytesFromInt(seedInt),
    FIXED_ROLES,
    budgetLimit === undefined ? undefined : { limit: budgetLimit },
  );
}

/** Complete the round-1 night: both wolves and the seer submit, then settle. */
async function submitNight(ownerId: string, sessionId: string) {
  const dispatch = makeDispatcher(ownerId, sessionId);
  await dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
  await dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 4 });
  await dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 });
}

async function eventCount(sessionId: string): Promise<number> {
  const rows = await client`select count(*)::int as n from game_events where session_id = ${sessionId}`;
  return rows[0].n;
}

async function snapshotRow(sessionId: string) {
  const rows = await client`select * from game_snapshots where session_id = ${sessionId}`;
  return rows[0] as
    | {
        last_event_seq: number;
        revision: number;
        checksum: string;
        state_json: string;
        definition_version: string;
        rules_version: string;
        event_schema_version: string;
        prng_version: string;
      }
    | undefined;
}

/** A dispatcher bound to one loaded state: dispatch locally, then append. */
function makeDispatcher(ownerId: string, sessionId: string) {
  return async (command: Quick6Command) => {
    const { state } = await repo.loadState(ownerId, sessionId, new Quick6Definition(), makeReplay());
    const engine = GameEngine.restore(new Quick6Definition(), state as Quick6State);
    const beforeRevision = engine.revision;
    const beforePhaseToken = engine.phaseToken();
    const events = engine.dispatch(command);
    const stateJson = engine.serializeState();
    const lastSeq = state.events.length - 1 + events.length;
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: lastSeq,
      revision: beforeRevision + 1,
      stateJson,
    });
    return repo.appendAndSnapshot(ownerId, sessionId, {
      expectedRevision: beforeRevision,
      expectedPhaseToken: beforePhaseToken,
      newPhaseToken: engine.phaseToken(),
      events: events.map((e) => e.payload),
      stateJson,
      checksum,
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
    });
  };
}

function makeActionExecutor(ownerId: string, sessionId: string) {
  return async (
    key: string,
    command: Quick6Command,
    responseExtra: Record<string, unknown> = {},
  ) => {
    const requestHash = sha256Hex(JSON.stringify(command));
    // Retry fast path: an existing receipt replays the stored response
    // without re-running (or re-dispatching) the action.
    const existing = await repo.getActionReceipt(ownerId, sessionId, key);
    if (existing && existing.requestHash === requestHash) {
      return {
        applied: false as const,
        revision: existing.revision,
        response: existing.responseJson,
        responseHash: existing.responseHash,
      };
    }
    const { state } = await repo.loadState(ownerId, sessionId, new Quick6Definition(), makeReplay());
    const engine = GameEngine.restore(new Quick6Definition(), state as Quick6State);
    const beforeRevision = engine.revision;
    const beforePhaseToken = engine.phaseToken();
    const events = engine.dispatch(command);
    const stateJson = engine.serializeState();
    const lastSeq = state.events.length - 1 + events.length;
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: lastSeq,
      revision: beforeRevision + 1,
      stateJson,
    });
    const responseJson = {
      applied: true,
      revision: beforeRevision + 1,
      events: events.map((e) => e.payload),
      ...responseExtra,
    };
    return repo.executeAction(ownerId, sessionId, {
      key,
      requestHash: sha256Hex(JSON.stringify(command)),
      expectedRevision: beforeRevision,
      expectedPhaseToken: beforePhaseToken,
      newPhaseToken: engine.phaseToken(),
      events: events.map((e) => e.payload),
      stateJson,
      checksum,
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      responseJson,
    });
  };
}

describe("P3 persistence (isolated real Postgres)", () => {
  beforeAll(async () => {
    client = postgres(url, { max: 10, connect_timeout: 10, onnotice: () => {} });
    db = drizzle(client, { schema });
    repo = new GameRepository(db);
    await client`truncate table users cascade`;
    const [a] = await client`insert into users (id, email) values (gen_random_uuid(), 'owner-a@test.local') returning id::text`;
    const [b] = await client`insert into users (id, email) values (gen_random_uuid(), 'owner-b@test.local') returning id::text`;
    ownerA = a.id;
    ownerB = b.id;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("refuses the development DATABASE_URL explicitly", () => {
    expect(() =>
      assertIsolatedDatabaseUrl("postgres://postgres:postgres@localhost:5432/wikids"),
    ).toThrow(/refusing development DATABASE_URL/);
    expect(() =>
      assertIsolatedDatabaseUrl("postgres://postgres:postgres@db:5432/wikids"),
    ).toThrow(/refusing development DATABASE_URL/);
    expect(() => assertIsolatedDatabaseUrl("postgres://x@localhost:5432/other")).toThrow();
    // The isolated URL this suite runs on must pass.
    expect(() => assertIsolatedDatabaseUrl(url)).not.toThrow();
  });

  it("migrated from zero: game tables exist and all migrations are recorded", async () => {
    const rows = await client`select tablename from pg_tables where schemaname = 'public'`;
    const names = new Set(rows.map((r) => r.tablename));
    for (const t of [
      "game_sessions",
      "game_events",
      "game_snapshots",
      "game_action_receipts",
      "game_ai_runs",
      "game_system_private",
    ]) {
      expect(names.has(t), `missing table ${t}`).toBe(true);
    }
    const [m] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(m.n).toBe(4); // 0000..0003
  });

  it("createSession writes session, initial events and a valid snapshot atomically", async () => {
    const { sessionId } = await createSession(ownerA, 42);
    const session = await repo.getSession(ownerA, sessionId);
    expect(session).not.toBeNull();
    expect(session!.definitionId).toBe(QUICK6_DEFINITION_ID);
    expect(session!.versions).toEqual(QUICK6_GAME_VERSIONS);
    expect(session!.revision).toBe(0);
    expect(session!.phaseToken).toBe("night:1");

    const events = await client`select seq, revision, payload from game_events where session_id = ${sessionId} order by seq`;
    expect(events.length).toBe(1);
    expect(events[0].seq).toBe(0);
    expect(events[0].revision).toBe(0);
    expect(events[0].payload).toEqual({ type: "PHASE", round: 1, phase: "NIGHT" });

    const snap = await snapshotRow(sessionId);
    expect(snap).toBeDefined();
    expect(snap!.last_event_seq).toBe(0);
    expect(snap!.revision).toBe(0);
    expect(snap!.checksum).toBe(
      computeSnapshotChecksum({
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
        lastEventSeq: 0,
        revision: 0,
        stateJson: snap!.state_json,
      }),
    );

    const priv = await repo.getSystemPrivate(ownerA, sessionId);
    expect(seedBytesToHex(priv.seedBytes)).toBe(seedBytesToHex(seedBytesFromInt(42)));
    expect(priv.startOptions).toEqual(FIXED_ROLES);
  });

  it("owner scoping: another owner can neither see nor touch the session", async () => {
    const { sessionId } = await createSession(ownerA, 5);
    expect(await repo.getSession(ownerB, sessionId)).toBeNull();
    expect(await repo.listSessions(ownerB)).toHaveLength(0);
    await expect(repo.getSystemPrivate(ownerB, sessionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(repo.loadState(ownerB, sessionId, new Quick6Definition(), makeReplay())).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );

    const { state } = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const engine = GameEngine.restore(new Quick6Definition(), state as Quick6State);
    const events = engine.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    const stateJson = engine.serializeState();
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: 1,
      revision: 1,
      stateJson,
    });
    await expect(
      repo.appendAndSnapshot(ownerB, sessionId, {
        expectedRevision: 0,
        expectedPhaseToken: "night:1",
        newPhaseToken: engine.phaseToken(),
        events: events.map((e) => e.payload),
        stateJson,
        checksum,
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      repo.claimAiLease(ownerB, sessionId, { seat: 1, phaseToken: "night:1", purpose: "wolf-kill", ttlSeconds: 30 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await eventCount(sessionId)).toBe(1);
  });

  it("append advances revision, events and snapshot under CAS", async () => {
    const { sessionId } = await createSession(ownerA, 6);
    // Three zero-event submissions (private night buffers): each advances
    // the revision and persists the snapshot without appending events.
    await submitNight(ownerA, sessionId);
    expect(await eventCount(sessionId)).toBe(1);
    let session = await repo.getSession(ownerA, sessionId);
    expect(session!.revision).toBe(3);

    // The settlement produces ELIMINATION + PHASE events under the same CAS.
    const dispatch = makeDispatcher(ownerA, sessionId);
    const result = await dispatch({ type: "FINISH_NIGHT" });
    expect(result.revision).toBe(4);

    expect(await eventCount(sessionId)).toBe(3);
    session = await repo.getSession(ownerA, sessionId);
    expect(session!.revision).toBe(4);
    expect(session!.phaseToken).toBe("discussion:1");

    const snap = await snapshotRow(sessionId);
    expect(snap!.last_event_seq).toBe(2);
    expect(snap!.revision).toBe(4);

    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("snapshot");
    expect(loaded.snapshotRejectedReason).toBeNull();
    expect(loaded.state.revision).toBe(4);
    expect(loaded.state.events).toHaveLength(3);
  });

  it("stale revision / stale phase token are rejected and write nothing", async () => {
    const { sessionId } = await createSession(ownerA, 7);
    const before = await snapshotRow(sessionId);
    const dispatch = makeDispatcher(ownerA, sessionId);

    const { state } = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const engine = GameEngine.restore(new Quick6Definition(), state as Quick6State);
    const events = engine.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    const stateJson = engine.serializeState();
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: 1,
      revision: 1,
      stateJson,
    });
    const input = {
      expectedPhaseToken: "night:1",
      newPhaseToken: engine.phaseToken(),
      events: events.map((e) => e.payload),
      stateJson,
      checksum,
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
    };

    await expect(
      repo.appendAndSnapshot(ownerA, sessionId, { ...input, expectedRevision: 7 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(
      repo.appendAndSnapshot(ownerA, sessionId, { ...input, expectedRevision: 0, expectedPhaseToken: "vote:9" }),
    ).rejects.toMatchObject({ code: "STALE_PHASE_TOKEN" });

    expect(await eventCount(sessionId)).toBe(1);
    const after = await snapshotRow(sessionId);
    expect(after!.checksum).toBe(before!.checksum);
    expect((await repo.getSession(ownerA, sessionId))!.revision).toBe(0);
    await expect(dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 })).resolves.toMatchObject({
      revision: 1,
    });
  });

  it("bad or mismatched checksums and version mismatches write nothing", async () => {
    const { sessionId } = await createSession(ownerA, 8);
    const { state } = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const engine = GameEngine.restore(new Quick6Definition(), state as Quick6State);
    const events = engine.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    const base = {
      expectedRevision: 0,
      expectedPhaseToken: "night:1",
      newPhaseToken: engine.phaseToken(),
      events: events.map((e) => e.payload),
      stateJson: engine.serializeState(),
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
    };

    await expect(
      repo.appendAndSnapshot(ownerA, sessionId, { ...base, checksum: "deadbeef" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      repo.appendAndSnapshot(ownerA, sessionId, {
        ...base,
        checksum: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHECKSUM" });
    await expect(
      repo.appendAndSnapshot(ownerA, sessionId, {
        ...base,
        checksum: computeSnapshotChecksum({
          definitionId: QUICK6_DEFINITION_ID,
          versions: QUICK6_GAME_VERSIONS,
          lastEventSeq: 1,
          revision: 1,
          stateJson: base.stateJson,
        }),
        versions: { ...QUICK6_GAME_VERSIONS, prng: "quick6-prng-v9" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_MISMATCH" });

    expect(await eventCount(sessionId)).toBe(1);
    expect((await repo.getSession(ownerA, sessionId))!.revision).toBe(0);
  });

  it("loadState refuses a definition whose versions differ from the session's", async () => {
    const { sessionId } = await createSession(ownerA, 9);
    const def = new Quick6Definition();
    const mismatched = {
      id: QUICK6_DEFINITION_ID,
      versions: { ...QUICK6_GAME_VERSIONS, definition: "quick6-def-v9" },
      serializeState: (s: Quick6State) => def.serializeState(s),
      deserializeState: (json: string) => def.deserializeState(json),
    };
    await expect(repo.loadState(ownerA, sessionId, mismatched, makeReplay())).rejects.toMatchObject({
      code: "VERSION_MISMATCH",
    });
  });

  it("concurrent appends: exactly one unique commit wins, events stay contiguous", async () => {
    const { sessionId } = await createSession(ownerA, 10);
    await submitNight(ownerA, sessionId); // revision 3

    // Eight workers dispatch FINISH_NIGHT from the SAME loaded revision-3
    // state and race their appends: the (session_id, seq) unique guard and
    // the revision CAS together admit exactly one, with contiguous seqs.
    const { state } = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const definition = new Quick6Definition();
    const inputs = Array.from({ length: 8 }, () => {
      const engine = GameEngine.restore(definition, state as Quick6State);
      const events = engine.dispatch({ type: "FINISH_NIGHT" });
      const stateJson = engine.serializeState();
      const lastSeq = state.events.length - 1 + events.length;
      return {
        expectedRevision: 3,
        expectedPhaseToken: "night:1",
        newPhaseToken: engine.phaseToken(),
        events: events.map((e) => e.payload),
        stateJson,
        checksum: computeSnapshotChecksum({
          definitionId: QUICK6_DEFINITION_ID,
          versions: QUICK6_GAME_VERSIONS,
          lastEventSeq: lastSeq,
          revision: 4,
          stateJson,
        }),
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
      };
    });
    const workers = inputs.map((input) =>
      repo.appendAndSnapshot(ownerA, sessionId, input).then(
        () => "ok",
        (err: unknown) => (err instanceof PersistenceError ? err.code : String(err)),
      ),
    );
    const results = await Promise.all(workers);
    const ok = results.filter((r) => r === "ok");
    const stale = results.filter((r) => r === "STALE_REVISION");
    expect(ok).toHaveLength(1);
    expect(stale).toHaveLength(7);

    expect(await eventCount(sessionId)).toBe(3);
    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.state.revision).toBe(4);
    const seqs = await client`select seq from game_events where session_id = ${sessionId} order by seq`;
    expect(seqs.map((r) => r.seq)).toEqual([0, 1, 2]);
    const snap = await snapshotRow(sessionId);
    expect(snap!.last_event_seq).toBe(2);
    expect(snap!.checksum).toBe(
      computeSnapshotChecksum({
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
        lastEventSeq: 2,
        revision: 4,
        stateJson: snap!.state_json,
      }),
    );
  });

  it("unique (session_id, seq) holds at the database level", async () => {
    const { sessionId } = await createSession(ownerA, 11);
    const dup = await client`insert into game_events (session_id, seq, revision, payload) values (${sessionId}, 0, 0, '{"x":1}'::jsonb)`.then(
      () => null,
      (err) => err as { code?: string },
    );
    expect(dup).not.toBeNull();
    expect((dup as { code?: string }).code).toBe("23505");
  });

  it("receipts: same key + same hash replays the stored stable response and applies once", async () => {
    const { sessionId } = await createSession(ownerA, 12);
    const execute = makeActionExecutor(ownerA, sessionId);
    const command: Quick6Command = { type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 };

    const first = await execute("client-key-1", command);
    expect(first.applied).toBe(true);
    expect(first.revision).toBe(1);

    const second = await execute("client-key-1", command);
    expect(second.applied).toBe(false);
    expect(second.response).toEqual(first.response);
    expect(second.revision).toBe(1);
    expect((await repo.getSession(ownerA, sessionId))!.revision).toBe(1);

    // Same key, different payload (the seer's check -> different hash): conflict.
    await expect(
      execute("client-key-1", { type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect((await repo.getSession(ownerA, sessionId))!.revision).toBe(1);
    const [receiptCount] = await client`select count(*)::int as n from game_action_receipts where session_id = ${sessionId}`;
    expect(receiptCount.n).toBe(1);

    // The original payload still replays its stored response.
    const third = await execute("client-key-1", command);
    expect(third.applied).toBe(false);
    expect(third.response).toEqual(first.response);
  });

  it("receipts under concurrency: one apply, one stable response for everyone", async () => {
    const { sessionId } = await createSession(ownerA, 13);
    await submitNight(ownerA, sessionId); // revision 3
    const command: Quick6Command = { type: "FINISH_NIGHT" };
    // One pre-dispatched payload (same key + same request hash); the workers
    // only differ in the response they WANT to record. The transaction
    // serializes on the session row, so exactly one applies and every worker
    // receives the one stored stable response.
    const { state } = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const definition = new Quick6Definition();
    const engine = GameEngine.restore(definition, state as Quick6State);
    const events = engine.dispatch(command);
    const stateJson = engine.serializeState();
    const lastSeq = state.events.length - 1 + events.length;
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: lastSeq,
      revision: 4,
      stateJson,
    });
    const base = {
      key: "client-key-2",
      requestHash: sha256Hex(JSON.stringify(command)),
      expectedRevision: 3,
      expectedPhaseToken: "night:1",
      newPhaseToken: engine.phaseToken(),
      events: events.map((e) => e.payload),
      stateJson,
      checksum,
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
    };

    const workers = Array.from({ length: 8 }, (_, i) =>
      repo
        .executeAction(ownerA, sessionId, {
          ...base,
          responseJson: { applied: true, revision: 4, worker: i },
        })
        .then(
          (result) => ({ result }),
          (err: unknown) => ({ error: err }),
        ),
    );
    const settled = await Promise.all(workers);
    const errors = settled.filter((s) => "error" in s);
    expect(errors).toHaveLength(0);
    const results = settled
      .filter((s) => "result" in s)
      .map((s) => (s as { result: Awaited<ReturnType<typeof repo.executeAction>> }).result);

    const applied = results.filter((r) => r.applied);
    expect(applied).toHaveLength(1);
    expect(await eventCount(sessionId)).toBe(3);
    expect((await repo.getSession(ownerA, sessionId))!.revision).toBe(4);

    const distinctResponses = new Set(results.map((r) => JSON.stringify(r.response)));
    expect(distinctResponses.size).toBe(1);
    const replayed = results.filter((r) => !r.applied);
    expect(replayed).toHaveLength(7);
    for (const r of replayed) {
      expect(r.response).toEqual(applied[0].response);
    }
  });

  it("missing snapshot: the same state is rebuilt from the event stream and the cache is healed", async () => {
    const { sessionId } = await createSession(ownerA, 14);
    const loadedBefore = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loadedBefore.source).toBe("snapshot");
    const stateJsonBefore = new Quick6Definition().serializeState(loadedBefore.state as Quick6State);

    await client`delete from game_snapshots where session_id = ${sessionId}`;
    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("replay");
    expect(loaded.snapshotRejectedReason).toBe("missing_snapshot");
    // No submissions/seer checks yet: the replayed state must be identical.
    // (jsonb normalizes object key order, so compare semantically.)
    const stateJsonAfter = new Quick6Definition().serializeState(loaded.state as Quick6State);
    expect(JSON.parse(stateJsonAfter)).toEqual(JSON.parse(stateJsonBefore));

    // Healed: the snapshot row is back and valid.
    const snap = await snapshotRow(sessionId);
    expect(snap).toBeDefined();
    expect(snap!.checksum).toBe(
      computeSnapshotChecksum({
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
        lastEventSeq: snap!.last_event_seq,
        revision: snap!.revision,
        stateJson: snap!.state_json,
      }),
    );
    const again = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(again.source).toBe("snapshot");
  });

  it("missing snapshot mid-game: event-derivable state recovers identically", async () => {
    const { sessionId } = await createSession(ownerA, 15);
    await submitNight(ownerA, sessionId);
    await makeDispatcher(ownerA, sessionId)({ type: "FINISH_NIGHT" });

    const definition = new Quick6Definition();
    const live = await repo.loadState(ownerA, sessionId, definition, makeReplay());
    expect(live.source).toBe("snapshot");
    const liveState = live.state as Quick6State;
    expect(liveState.seerChecks.length).toBeGreaterThan(0);

    await client`delete from game_snapshots where session_id = ${sessionId}`;
    const rebuilt = await repo.loadState(ownerA, sessionId, definition, makeReplay());
    expect(rebuilt.source).toBe("replay");
    const replayed = rebuilt.state as Quick6State;

    expect(replayed.revision).toBe(liveState.revision);
    expect(replayed.round).toBe(liveState.round);
    expect(replayed.phase).toBe(liveState.phase);
    expect(replayed.roles).toEqual(liveState.roles);
    expect(replayed.alive).toEqual(liveState.alive);
    expect(replayed.eliminations).toEqual(liveState.eliminations);
    expect(replayed.votes).toEqual(liveState.votes);
    expect(replayed.events).toEqual(liveState.events);
    expect(definition.publicView(replayed)).toEqual(definition.publicView(liveState));
    expect(definition.legalChoices(replayed)).toEqual(definition.legalChoices(liveState));
    expect(definition.phaseToken(replayed)).toBe(definition.phaseToken(liveState));
    // Documented caveat: the seer's private history never enters events, so a
    // replayed state carries [] there.
    expect(replayed.seerChecks).toEqual([]);
  });

  it("corrupted snapshot checksum is rejected and rebuilt from events", async () => {
    const { sessionId } = await createSession(ownerA, 16);
    const good = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(good.source).toBe("snapshot");
    const goodJson = new Quick6Definition().serializeState(good.state as Quick6State);

    // Corrupt the cached state: the checksum over it must fail.
    await client`update game_snapshots set state_json = state_json || 'x' where session_id = ${sessionId}`;
    let loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("replay");
    expect(loaded.snapshotRejectedReason).toBe("checksum_mismatch");
    expect(JSON.parse(new Quick6Definition().serializeState(loaded.state as Quick6State))).toEqual(JSON.parse(goodJson));

    // Corrupt the checksum column itself.
    await client`update game_snapshots set checksum = ${"0".repeat(64)} where session_id = ${sessionId}`;
    loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("replay");
    expect(loaded.snapshotRejectedReason).toBe("checksum_mismatch");
    expect(JSON.parse(new Quick6Definition().serializeState(loaded.state as Quick6State))).toEqual(JSON.parse(goodJson));
  });

  it("snapshot seq mismatch is rejected independently of the checksum", async () => {
    const { sessionId } = await createSession(ownerA, 17);
    // Corrupt last_event_seq and recompute the checksum so it matches the
    // corrupted row: only the seq-vs-event-stream check can catch this.
    const snap = await snapshotRow(sessionId);
    const wrongSeq = snap!.last_event_seq + 3;
    await client`update game_snapshots set last_event_seq = ${wrongSeq}, checksum = ${computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: wrongSeq,
      revision: snap!.revision,
      stateJson: snap!.state_json,
    })} where session_id = ${sessionId}`;

    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("replay");
    expect(loaded.snapshotRejectedReason).toBe("seq_mismatch");
    const healed = await snapshotRow(sessionId);
    expect(healed!.last_event_seq).toBe(0);
    const again = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(again.source).toBe("snapshot");
  });

  it("snapshot version-stamp mismatch is rejected and rebuilt from events", async () => {
    const { sessionId } = await createSession(ownerA, 18);
    const snap = await snapshotRow(sessionId);
    await client`update game_snapshots set prng_version = 'quick6-prng-v9', checksum = ${computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: { ...QUICK6_GAME_VERSIONS, prng: "quick6-prng-v9" },
      lastEventSeq: snap!.last_event_seq,
      revision: snap!.revision,
      stateJson: snap!.state_json,
    })} where session_id = ${sessionId}`;

    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    expect(loaded.source).toBe("replay");
    expect(loaded.snapshotRejectedReason).toBe("snapshot_version_mismatch");
    const healed = await snapshotRow(sessionId);
    expect(healed!.prng_version).toBe(QUICK6_GAME_VERSIONS.prng);
  });

  it("atomic commit: readers never observe a partial append", async () => {
    const { sessionId } = await createSession(ownerA, 19);
    await submitNight(ownerA, sessionId); // revision 3
    const blocker = postgres(url, { max: 1 });
    const reader = postgres(url, { max: 1 });
    try {
      // The append is started inside the callback but awaited only AFTER the
      // callback returns. Awaiting it INSIDE the callback would deadlock: the
      // append waits for the exclusive table lock, and the lock is held until
      // the callback returns (its commit releases it).
      let appendPromise!: Promise<AppendResult>;
      await blocker.begin(async (btx) => {
        await btx`lock table game_snapshots in exclusive mode`;
        const dispatch = makeDispatcher(ownerA, sessionId);
        appendPromise = dispatch({ type: "FINISH_NIGHT" });
        await new Promise((resolve) => setTimeout(resolve, 400));

        // While the append is blocked on the snapshot upsert, its event
        // inserts are already in-flight inside the SAME transaction: a
        // reader must see neither the events, the snapshot nor the session
        // CAS update.
        const [midCount] = await reader`select count(*)::int as n from game_events where session_id = ${sessionId}`;
        const [midSnap] = await reader`select last_event_seq from game_snapshots where session_id = ${sessionId}`;
        const [midSession] = await reader`select revision from game_sessions where id = ${sessionId}`;
        expect(midCount.n).toBe(1);
        expect(midSnap?.last_event_seq ?? null).toBe(0);
        expect(midSession.revision).toBe(3);
      });

      // The callback's return committed and released the table lock; only now
      // can the append finish.
      await expect(appendPromise).resolves.toMatchObject({ revision: 4 });
    } finally {
      await blocker.end({ timeout: 5 });
      await reader.end({ timeout: 5 });
    }

    const [afterCount] = await client`select count(*)::int as n from game_events where session_id = ${sessionId}`;
    const [afterSnap] = await client`select last_event_seq from game_snapshots where session_id = ${sessionId}`;
    expect(afterCount.n).toBe(3);
    expect(afterSnap.last_event_seq).toBe(2);
  });

  it("AI claim uses database time and denies concurrent claims while the lease lives", async () => {
    const { sessionId } = await createSession(ownerA, 20);
    const lease = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(lease).not.toBeNull();
    expect(lease!.generation).toBe(1);
    expect(lease!.attempts).toBe(1);
    expect(lease!.budgetConsumed).toBe(1);
    expect(lease!.budgetLimit).toBe(100);

    // Lease expiry is computed from database time: within [dbNow+29s, dbNow+31s].
    const [dbNowRow] = await client`select now() as t`;
    const dbNow = new Date((dbNowRow as { t: string | Date }).t).getTime();
    const leaseMs = new Date(lease!.leaseExpiresAt).getTime();
    expect(leaseMs - dbNow).toBeGreaterThan(29_000);
    expect(leaseMs - dbNow).toBeLessThan(31_500);

    const second = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(second).toBeNull();

    const run = await repo.getAiRun(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run!.status).toBe("claimed");
  });

  it("lease expiry (database time) reclaims the lease; old lease results are rejected", async () => {
    const { sessionId } = await createSession(ownerA, 21);
    const first = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(first).not.toBeNull();

    // The lease expires on the database clock.
    await client`update game_ai_runs set lease_expires_at = now() - interval '1 second' where session_id = ${sessionId}`;

    const second = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(second).not.toBeNull();
    expect(second!.generation).toBe(2);
    expect(second!.claimToken).not.toBe(first!.claimToken);
    expect(second!.attempts).toBe(2);

    // The OLD lease's result must be rejected.
    await expect(
      repo.completeAiRun(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        claimToken: first!.claimToken,
        generation: first!.generation,
        status: "succeeded",
        result: { output: "stale" },
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });

    const done = await repo.completeAiRun(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      claimToken: second!.claimToken,
      generation: second!.generation,
      status: "succeeded",
      result: { output: "ok" },
    });
    expect(done.attempts).toBe(2);

    const run = await repo.getAiRun(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run!.status).toBe("succeeded");
    expect(run!.result).toEqual({ output: "ok" });

    // A terminal status releases the lease: claiming again succeeds.
    const third = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(third).not.toBeNull();
    expect(third!.generation).toBe(3);
  });

  it("an expired lease rejects even the current holder's result", async () => {
    const { sessionId } = await createSession(ownerA, 22);
    const lease = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    await client`update game_ai_runs set lease_expires_at = now() - interval '1 second' where session_id = ${sessionId}`;
    await expect(
      repo.completeAiRun(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        claimToken: lease!.claimToken,
        generation: lease!.generation,
        status: "succeeded",
        result: { output: "late" },
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
  });

  it("release frees the claim; releasing a lost lease raises STALE_LEASE", async () => {
    const { sessionId } = await createSession(ownerA, 23);
    const lease = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    await expect(
      repo.releaseAiLease(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        claimToken: lease!.claimToken,
        generation: lease!.generation,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repo.releaseAiLease(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        claimToken: lease!.claimToken,
        generation: lease!.generation,
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
    const next = await repo.claimAiLease(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
    });
    expect(next!.generation).toBe(2);
  });

  it("every provider attempt (failure and retry) consumes budget; exhaustion raises", async () => {
    const { sessionId } = await createSession(ownerA, 24, 3);
    let calls = 0;
    const provider = async () => {
      calls += 1;
      if (calls < 3) throw new Error("provider down");
      return "third time lucky";
    };
    const outcome = await runAiTurn({
      repo,
      ownerId: ownerA,
      sessionId,
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
      ttlSeconds: 30,
      provider,
      requestTimeoutMs: 5_000,
      maxRetries: 2,
      fallbackRng: createQuick6Rng(seedBytesFromInt(24)),
      choiceIds: ["a", "b", "c"],
    });
    expect(outcome).toMatchObject({ source: "provider", output: "third time lucky", attempts: 3 });

    const session = await repo.getSession(ownerA, sessionId);
    expect(session!.aiBudgetConsumed).toBe(3);
    const run = await repo.getAiRun(ownerA, sessionId, {
      seat: 1,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run!.attempts).toBe(3);
    expect(run!.status).toBe("succeeded");

    await expect(
      repo.claimAiLease(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        ttlSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
  });

  it("a timed-out provider attempt counts too, then the deterministic fallback answers", async () => {
    const server = await startMockServer();
    try {
      const { sessionId } = await createSession(ownerA, 25, 1);
      const outcome = await runAiTurn({
        repo,
        ownerId: ownerA,
        sessionId,
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        ttlSeconds: 30,
        provider: async (signal) => {
          // Hangs until the request timeout aborts it.
          await fetch(`http://127.0.0.1:${server.port}/hang`, { signal });
          return "never";
        },
        requestTimeoutMs: 400,
        maxRetries: 0,
        fallbackRng: createQuick6Rng(seedBytesFromInt(25)),
        choiceIds: ["a", "b", "c"],
      });
      expect(outcome.source).toBe("fallback");
      expect(outcome.attempts).toBe(1);

      const session = await repo.getSession(ownerA, sessionId);
      expect(session!.aiBudgetConsumed).toBe(1);
      const run = await repo.getAiRun(ownerA, sessionId, {
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
      });
      expect(run!.status).toBe("timeout");
      expect(run!.attempts).toBe(1);

      await expect(
        repo.claimAiLease(ownerA, sessionId, {
          seat: 1,
          phaseToken: "night:1",
          purpose: "wolf-kill",
          ttlSeconds: 30,
        }),
      ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
    } finally {
      await server.close();
    }
  });

  it("no network call happens inside a transaction", async () => {
    const server = await startMockServer();
    try {
      const { sessionId } = await createSession(ownerA, 26);
      const provider = async (signal?: AbortSignal) => {
        // The provider runs strictly outside any transaction lifecycle.
        assertNoOpenTransaction("test provider");
        expect(transactionDepth()).toBe(0);
        const response = await fetch(`http://127.0.0.1:${server.port}/complete`, { signal });
        // While the network call is in flight (the server delays 400ms), no
        // application connection may sit in a transaction.
        const [probe] = await client`select count(*)::int as n from pg_stat_activity where state = 'idle in transaction'`;
        expect(probe.n).toBe(0);
        return ((await response.json()) as { answer: string }).answer;
      };
      const outcome = await runAiTurn({
        repo,
        ownerId: ownerA,
        sessionId,
        seat: 1,
        phaseToken: "night:1",
        purpose: "wolf-kill",
        ttlSeconds: 30,
        provider,
        requestTimeoutMs: 5_000,
        maxRetries: 0,
        fallbackRng: createQuick6Rng(seedBytesFromInt(26)),
        choiceIds: ["a"],
      });
      expect(outcome).toMatchObject({ source: "provider", output: "ok" });
      expect(transactionDepth()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("fallback choice derives from (seed, phaseToken, seat, purpose) and ignores completion order", async () => {
    const seed = seedBytesFromInt(27);
    const phaseToken = "night:1";
    const seat = 3;
    const purpose = "wolf-kill";
    const choiceIds = ["alpha", "beta", "gamma"];

    // Order-independence of the stream derivation itself: creating other
    // streams first never changes this stream's draws.
    const pathOf = (s: number) => [
      "bot",
      `phase:${phaseToken}`,
      `seat:${s}`,
      `purpose:${purpose}`,
    ] as const;
    const f1 = createQuick6Rng(seed);
    const seat3First = f1.stream(...pathOf(3)).next();
    const seat4First = f1.stream(...pathOf(4)).next();
    const f2 = createQuick6Rng(seed);
    const seat4Second = f2.stream(...pathOf(4)).next();
    const seat3Second = f2.stream(...pathOf(3)).next();
    expect(seat3Second).toBe(seat3First);
    expect(seat4Second).toBe(seat4First);
    const expected = deriveFallbackChoice(createQuick6Rng(seed), phaseToken, seat, purpose, choiceIds);

    // Two sessions with the same seed: providers fail at different times,
    // concurrent completion order differs — the fallback is identical.
    const { sessionId: s1 } = await createSession(ownerA, 27);
    const { sessionId: s2 } = await createSession(ownerA, 27);
    const run = (sessionId: string, delayMs: number) =>
      runAiTurn({
        repo,
        ownerId: ownerA,
        sessionId,
        seat,
        phaseToken,
        purpose,
        ttlSeconds: 30,
        provider: async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          throw new Error("provider down");
        },
        requestTimeoutMs: 5_000,
        maxRetries: 0,
        fallbackRng: createQuick6Rng(seed),
        choiceIds,
      });
    const [out1, out2] = await Promise.all([run(s1, 300), run(s2, 0)]);
    expect(out1).toMatchObject({ source: "fallback", choiceId: expected });
    expect(out2).toMatchObject({ source: "fallback", choiceId: expected });
  });

  it("the session seed lives only in SYSTEM-private state", async () => {
    const { sessionId } = await createSession(ownerA, 28);
    const dispatch = makeDispatcher(ownerA, sessionId);
    await dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    await dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 4 });
    const execute = makeActionExecutor(ownerA, sessionId);
    await execute("seed-key", { type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 });

    const seedHex = seedBytesToHex(seedBytesFromInt(28));
    const priv = await repo.getSystemPrivate(ownerA, sessionId);
    expect(seedBytesToHex(priv.seedBytes)).toBe(seedHex);

    // Never in events…
    const [inEvents] = await client`select count(*)::int as n from game_events where session_id = ${sessionId} and payload::text like ${"%" + seedHex + "%"}`;
    expect(inEvents.n).toBe(0);
    // …nor in receipts…
    const [inReceipts] = await client`select count(*)::int as n from game_action_receipts where session_id = ${sessionId} and response_json::text like ${"%" + seedHex + "%"}`;
    expect(inReceipts.n).toBe(0);

    // …nor in any seat projection.
    const loaded = await repo.loadState(ownerA, sessionId, new Quick6Definition(), makeReplay());
    const definition = new Quick6Definition();
    const state = loaded.state as Quick6State;
    const views = [
      JSON.stringify(definition.publicView(state)),
      ...Array.from({ length: 6 }, (_, seat) => JSON.stringify(definition.viewFor(state, seat))),
    ];
    for (const view of views) {
      expect(view.includes(seedHex)).toBe(false);
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
        // Never respond; the client's AbortSignal ends the request.
        return;
      }
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ answer: "ok" }));
      }, 400);
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
