/**
 * Owner-scoped game persistence repository (P3).
 *
 * This is the persistence boundary of the games core. It receives the
 * drizzle database as a dependency (injected, like every other port), so the
 * core stays free of environment access; everything else in lib/games stays
 * pure. The repository implements the P3 guarantees:
 *
 * - Event stream is the source of truth. Every accepted transition is
 *   appended to game_events with contiguous seq (unique (session_id, seq));
 *   any state is recoverable by replaying the stream.
 * - game_snapshots is a pure cache: one row per session carrying
 *   last_event_seq, a checksum over the cached state and the four frozen
 *   version stamps. A missing, corrupt or out-of-date snapshot is discarded
 *   and rebuilt from the event stream — never trusted.
 * - Event append + session CAS + snapshot update + receipt write happen in
 *   ONE transaction: readers never observe a partial commit.
 * - Every SQL statement is owner-scoped: the owner_id filter is part of the
 *   SQL condition itself (never applied afterwards in application code).
 * - Idempotent receipts: unique (session_id, key); the same key with the
 *   same request hash returns the stored stable response verbatim (applied
 *   exactly once), the same key with a different hash is a conflict.
 * - revision/phase_token CAS: appends carrying a stale revision or a stale
 *   phase token are rejected and write nothing.
 * - AI claims use database-time leases: claim/expiry/reclamation are decided
 *   by now() inside SQL, and results delivered under an expired or reclaimed
 *   lease are rejected (STALE_LEASE).
 * - The session seed lives ONLY in game_system_private (SYSTEM-private
 *   state): never in events, receipts, projections or any client payload.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import {
  computeSnapshotChecksum,
  isValidSnapshotChecksum,
  sha256Hex,
} from "./checksum";
import { withTx, type TransactionTarget } from "./tx";
import type { GameVersions } from "./types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PersistenceErrorCode =
  /** The session does not exist or belongs to another owner (never leaks which). */
  | "NOT_FOUND"
  /** Definition id/version stamps do not match the session's frozen stamps. */
  | "VERSION_MISMATCH"
  /** The expectedRevision does not match the session's current revision. */
  | "STALE_REVISION"
  /** The expectedPhaseToken does not match the session's current phase token. */
  | "STALE_PHASE_TOKEN"
  /** The idempotency key exists with a different request hash. */
  | "IDEMPOTENCY_CONFLICT"
  /** The AI budget is exhausted: this attempt was not counted nor run. */
  | "BUDGET_EXHAUSTED"
  /** The owner's concurrent active-game budget is exhausted (P4.1 create guard). */
  | "USER_BUDGET_EXHAUSTED"
  /**
   * The session exists for the owner but is not playable: abandoned by the
   * owner or aborted by the round budget (P5.1). Mutating calls refuse it;
   * reads still serve the frozen projection.
   */
  | "NOT_ACTIVE"
  /** The lease was reclaimed or expired: this result is not accepted. */
  | "STALE_LEASE"
  /** Malformed input (bad checksum format, empty event batch, ...). */
  | "INVALID_ARGUMENT"
  /** The supplied snapshot checksum does not match the supplied state. */
  | "INVALID_CHECKSUM";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  constructor(code: PersistenceErrorCode, message: string) {
    super(`game persistence (${code}): ${message}`);
    this.name = "PersistenceError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One event row of the fact stream (seq = contiguous index). */
export interface PersistedEvent {
  readonly seq: number;
  readonly revision: number;
  readonly payload: unknown;
}

/** The definition surface the repository needs (satisfied by Quick6Definition). */
export interface RepositoryDefinition<State> {
  readonly id: string;
  readonly title: string;
  readonly versions: GameVersions;
  initialState(seedBytes: Uint8Array, options?: unknown): State;
  serializeState(state: State): string;
  deserializeState(json: string): State;
  phaseToken(state: State): string;
}

/** Rebuilds a state by folding the event stream (e.g. replayQuick6). */
export type ReplayFn<State> = (
  seedBytes: Uint8Array,
  startOptions: unknown,
  events: readonly PersistedEvent[],
) => State;

export interface SessionInfo {
  readonly id: string;
  readonly ownerId: string;
  readonly definitionId: string;
  readonly title: string;
  readonly versions: GameVersions;
  readonly status: string;
  readonly revision: number;
  readonly phaseToken: string;
  readonly aiBudgetLimit: number;
  readonly aiBudgetConsumed: number;
  /** P4.1 orchestration counters: provider-backed decisions and tokens. */
  readonly aiLogicalCalls: number;
  readonly aiTokensConsumed: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** SYSTEM-private state: the seed and the start options. */
export interface SystemPrivate {
  readonly seedBytes: Uint8Array;
  readonly startOptions: unknown;
}

export interface AppendInput {
  readonly expectedRevision: number;
  readonly expectedPhaseToken: string;
  readonly newPhaseToken: string;
  /** Raw event payloads, in order; seqs and revisions are assigned here. */
  readonly events: readonly unknown[];
  readonly stateJson: string;
  readonly checksum: string;
  readonly definitionId: string;
  readonly versions: GameVersions;
}

export interface AppendResult {
  readonly revision: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface ExecuteActionInput extends AppendInput {
  readonly key: string;
  readonly requestHash: string;
  readonly responseJson: unknown;
}

export type ExecuteActionResult =
  | {
      readonly applied: true;
      readonly revision: number;
      readonly firstSeq: number;
      readonly lastSeq: number;
      readonly response: unknown;
    }
  | {
      readonly applied: false;
      readonly revision: number;
      readonly response: unknown;
      readonly responseHash: string;
    };

export interface LoadStateResult<State> {
  readonly state: State;
  readonly source: "snapshot" | "replay";
  /** Why the snapshot cache was rejected (null when served from it). */
  readonly snapshotRejectedReason: string | null;
  /**
   * Whether the state is complete enough to DISPATCH commands from. A
   * snapshot-served state always is. A replayed state is only dispatchable
   * when the event stream fully accounts for the session's revision — i.e.
   * the last event's revision equals the session revision. Mid-collection
   * states (night submissions) bump the revision WITHOUT events, so a
   * replayed state there is a read-only projection and must not be
   * dispatched (docs: night buffers are unreconstructable mid-night).
   */
  readonly dispatchable: boolean;
}

export interface AiLease {
  readonly claimToken: string;
  readonly generation: number;
  readonly leaseExpiresAt: Date;
  readonly attempts: number;
  readonly budgetConsumed: number;
  readonly budgetLimit: number;
}

export type AiRunStatus = "succeeded" | "failed" | "timeout";

export interface CompleteAiRunInput {
  readonly seat: number;
  readonly phaseToken: string;
  readonly purpose: string;
  readonly claimToken: string;
  readonly generation: number;
  readonly status: AiRunStatus;
  readonly result?: unknown;
  readonly error?: string | null;
}

export interface AiRunInfo {
  readonly id: string;
  readonly seat: number;
  readonly phaseToken: string;
  readonly purpose: string;
  readonly status: string;
  readonly claimGeneration: number;
  readonly leaseExpiresAt: Date | null;
  readonly attempts: number;
  readonly result: unknown;
  readonly lastError: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

type Tx = TransactionTarget<PostgresJsDatabase<typeof schema>>;

function toSessionInfo(row: typeof schema.gameSessions.$inferSelect): SessionInfo {
  return {
    id: row.id,
    ownerId: row.ownerId,
    definitionId: row.definitionId,
    title: row.title,
    versions: {
      definition: row.definitionVersion,
      rules: row.rulesVersion,
      eventSchema: row.eventSchemaVersion,
      prng: row.prngVersion,
    },
    status: row.status,
    revision: row.revision,
    phaseToken: row.phaseToken,
    aiBudgetLimit: row.aiBudgetLimit,
    aiBudgetConsumed: row.aiBudgetConsumed,
    aiLogicalCalls: row.aiLogicalCalls,
    aiTokensConsumed: row.aiTokensConsumed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function versionsMatch(
  a: { id: string; versions: GameVersions },
  b: { definitionId: string; versions: GameVersions },
): boolean {
  return (
    a.id === b.definitionId &&
    a.versions.definition === b.versions.definition &&
    a.versions.rules === b.versions.rules &&
    a.versions.eventSchema === b.versions.eventSchema &&
    a.versions.prng === b.versions.prng
  );
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class GameRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  // -------------------------------------------------------------------------
  // Sessions (owner-scoped metadata; the seed never lives here)
  // -------------------------------------------------------------------------

  /** Create a session, its initial events and its initial snapshot atomically. */
  async createSession<
    State extends {
      readonly revision: number;
      readonly events: readonly { index: number; revision: number; payload: unknown }[];
    },
  >(
    ownerId: string,
    definition: RepositoryDefinition<State>,
    seedBytes: Uint8Array,
    options?: unknown,
    budget?: { readonly limit: number },
    /**
     * Optional per-user concurrency guard (P4.1): refuse the create when the
     * owner already has maxActiveGames sessions in status 'active'. The
     * count runs inside the same transaction as the insert, serialized by an
     * owner-scoped advisory lock so concurrent creates for one owner cannot
     * both pass the check (the refusal rolls the whole transaction back).
     */
    concurrencyGuard?: { readonly maxActiveGames: number },
  ): Promise<{ sessionId: string; revision: number; phaseToken: string }> {
    // Pure domain computation happens OUTSIDE the transaction: transactions
    // contain database statements only.
    const state = definition.initialState(seedBytes, options);
    const initialEvents = state.events;
    for (let i = 0; i < initialEvents.length; i++) {
      if (initialEvents[i].index !== i) {
        throw new PersistenceError(
          "INVALID_ARGUMENT",
          `initial event at position ${i} has non-contiguous index ${initialEvents[i].index}`,
        );
      }
    }
    const stateJson = definition.serializeState(state);
    const revision = state.revision;
    const phaseToken = definition.phaseToken(state);
    const lastEventSeq = initialEvents.length - 1;
    const versions = definition.versions;
    const checksum = computeSnapshotChecksum({
      definitionId: definition.id,
      versions,
      lastEventSeq,
      revision,
      stateJson,
    });
    const seedHex = bytesToHex(seedBytes);
    const normalizedOptions =
      options === undefined ? null : JSON.parse(JSON.stringify(options));

    return withTx(this.db, async (tx) => {
      if (concurrencyGuard) {
        // Serialize concurrent creates of one owner (advisory lock held for
        // the transaction), then enforce the active-games budget inside the
        // same transaction as the insert: exceeding it throws, which rolls
        // the insert AND the lock back together.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`game-create:${ownerId}`}))`,
        );
        const [countRow] = await tx.execute(
          sql`select count(*)::int as n from ${schema.gameSessions}
              where owner_id = ${ownerId} and status = 'active'`,
        );
        const active = (countRow as { n: number }).n;
        if (active >= concurrencyGuard.maxActiveGames) {
          throw new PersistenceError(
            "USER_BUDGET_EXHAUSTED",
            `owner already has ${active} active games (limit ${concurrencyGuard.maxActiveGames})`,
          );
        }
      }
      const [session] = await tx
        .insert(schema.gameSessions)
        .values({
          ownerId,
          definitionId: definition.id,
          title: definition.title,
          definitionVersion: versions.definition,
          rulesVersion: versions.rules,
          eventSchemaVersion: versions.eventSchema,
          prngVersion: versions.prng,
          revision,
          phaseToken,
          aiBudgetLimit: budget?.limit ?? 100,
        })
        .returning();
      await tx.insert(schema.gameSystemPrivate).values({
        sessionId: session.id,
        seedHex,
        startOptions: normalizedOptions,
      });
      if (initialEvents.length > 0) {
        await tx.insert(schema.gameEvents).values(
          initialEvents.map((e) => ({
            sessionId: session.id,
            seq: e.index,
            revision: e.revision,
            payload: e.payload,
          })),
        );
      }
      await tx.insert(schema.gameSnapshots).values({
        sessionId: session.id,
        lastEventSeq,
        revision,
        checksum,
        stateJson,
        definitionVersion: versions.definition,
        rulesVersion: versions.rules,
        eventSchemaVersion: versions.eventSchema,
        prngVersion: versions.prng,
      });
      return { sessionId: session.id, revision, phaseToken };
    });
  }

  /** Owner-scoped session metadata, or null. */
  async getSession(
    ownerId: string,
    sessionId: string,
  ): Promise<SessionInfo | null> {
    const rows = await this.db
      .select()
      .from(schema.gameSessions)
      .where(
        and(
          eq(schema.gameSessions.id, sessionId),
          eq(schema.gameSessions.ownerId, ownerId),
        ),
      )
      .limit(1);
    return rows[0] ? toSessionInfo(rows[0]) : null;
  }

  /**
   * Owner-scoped session list, newest first, with optional definition /
   * status filters (P5.1 lobby queries). The owner filter is always part of
   * the SQL condition itself.
   */
  async listSessions(
    ownerId: string,
    limit = 50,
    filter?: { readonly definitionId?: string; readonly status?: string },
  ): Promise<SessionInfo[]> {
    const conditions = [eq(schema.gameSessions.ownerId, ownerId)];
    if (filter?.definitionId !== undefined) {
      conditions.push(eq(schema.gameSessions.definitionId, filter.definitionId));
    }
    if (filter?.status !== undefined) {
      conditions.push(eq(schema.gameSessions.status, filter.status));
    }
    const rows = await this.db
      .select()
      .from(schema.gameSessions)
      .where(and(...conditions))
      .orderBy(desc(schema.gameSessions.createdAt))
      .limit(limit);
    return rows.map(toSessionInfo);
  }

  /**
   * SYSTEM-only: the durable seed + start options. Nothing in the games
   * layer may hand this to a seat, a projection or a client.
   */
  async getSystemPrivate(
    ownerId: string,
    sessionId: string,
  ): Promise<SystemPrivate> {
    const rows = await this.db.execute(
      sql`select p.seed_hex, p.start_options
          from ${schema.gameSystemPrivate} p
          join ${schema.gameSessions} s on s.id = p.session_id
          where p.session_id = ${sessionId} and s.owner_id = ${ownerId}
          limit 1`,
    );
    const row = rows[0] as { seed_hex: string; start_options: unknown } | undefined;
    if (!row) {
      throw new PersistenceError("NOT_FOUND", `session ${sessionId}`);
    }
    return { seedBytes: hexToBytes(row.seed_hex), startOptions: row.start_options };
  }

  // -------------------------------------------------------------------------
  // State loading: snapshot fast path, event-stream fallback
  // -------------------------------------------------------------------------

  /**
   * Load the current state. The snapshot cache is only used when it passes
   * EVERY check (version stamps, checksum, lastEventSeq vs the event stream,
   * revision, deserialization, engine invariants); otherwise it is rejected
   * and the state is rebuilt by replaying the event stream, after which the
   * snapshot is healed.
   */
  async loadState<
    State extends {
      readonly revision: number;
      readonly events: readonly { index: number; revision: number }[];
    },
  >(
    ownerId: string,
    sessionId: string,
    definition: {
      readonly id: string;
      readonly versions: GameVersions;
      serializeState(state: State): string;
      deserializeState(json: string): State;
    },
    replay: ReplayFn<State>,
  ): Promise<LoadStateResult<State>> {
    const session = await this.getSession(ownerId, sessionId);
    if (!session) {
      throw new PersistenceError("NOT_FOUND", `session ${sessionId}`);
    }
    if (!versionsMatch(definition, session)) {
      throw new PersistenceError(
        "VERSION_MISMATCH",
        `definition ${definition.id}@${definition.versions.definition} does not match session ${sessionId}@${session.versions.definition}`,
      );
    }

    // Snapshot fast path: ONE statement reads the snapshot row, the session
    // row and the event-stream max seq together, so the three can never be
    // observed in a mixture from racing appends (a concurrent append either
    // committed before this read — snapshot+seq+revision all new — or after
    // it — all old). A snapshot that fails ANY check is rejected and the
    // state is rebuilt from the event stream.
    const snapRows = await this.db.execute(
      sql`select snap.last_event_seq, snap.revision, snap.checksum, snap.state_json,
                 snap.definition_version, snap.rules_version, snap.event_schema_version, snap.prng_version,
                 s.revision as session_revision,
                 coalesce((select max(seq) from ${schema.gameEvents} e
                           where e.session_id = snap.session_id), -1)::int as max_seq
          from ${schema.gameSnapshots} snap
          join ${schema.gameSessions} s on s.id = snap.session_id
          where snap.session_id = ${sessionId} and s.owner_id = ${ownerId}
          limit 1`,
    );
    const snap = snapRows[0] as
      | {
          last_event_seq: number;
          revision: number;
          checksum: string;
          state_json: string;
          definition_version: string;
          rules_version: string;
          event_schema_version: string;
          prng_version: string;
          session_revision: number;
          max_seq: number;
        }
      | undefined;

    let rejected: string | null = "missing_snapshot";
    if (snap) {
      const snapshotVersions: GameVersions = {
        definition: snap.definition_version,
        rules: snap.rules_version,
        eventSchema: snap.event_schema_version,
        prng: snap.prng_version,
      };
      const snapshotOk =
        snapshotVersions.definition === session.versions.definition &&
        snapshotVersions.rules === session.versions.rules &&
        snapshotVersions.eventSchema === session.versions.eventSchema &&
        snapshotVersions.prng === session.versions.prng;
      if (!snapshotOk) {
        rejected = "snapshot_version_mismatch";
      } else if (
        !isValidSnapshotChecksum(snap.checksum) ||
        snap.checksum !==
          computeSnapshotChecksum({
            definitionId: session.definitionId,
            versions: session.versions,
            lastEventSeq: snap.last_event_seq,
            revision: snap.revision,
            stateJson: snap.state_json,
          })
      ) {
        rejected = "checksum_mismatch";
      } else if (snap.revision !== snap.session_revision) {
        rejected = "revision_mismatch";
      } else if (snap.last_event_seq !== snap.max_seq) {
        rejected = "seq_mismatch";
      } else {
        let snapshotState: State | null = null;
        try {
          snapshotState = definition.deserializeState(snap.state_json);
        } catch {
          rejected = "deserialize_failed";
        }
        if (snapshotState !== null) {
          const events = snapshotState.events;
          // Zero-event transitions advance the revision without appending
          // an event, so the last event's producing revision may be below
          // the state revision — never above it.
          const contiguous =
            events.length === snap.last_event_seq + 1 &&
            events.every((e, i) => e.index === i) &&
            snapshotState.revision === snap.revision &&
            (events.length === 0 ||
              events[events.length - 1].revision <= snap.revision);
          if (contiguous) {
            return {
              state: snapshotState,
              source: "snapshot",
              snapshotRejectedReason: null,
              dispatchable: true,
            };
          }
          rejected = "state_inconsistent";
        }
      }
    }

    // Rebuild from the event stream (the source of truth).
    const eventRows = await this.db.execute(
      sql`select seq, revision, payload
          from ${schema.gameEvents}
          where session_id = ${sessionId}
          order by seq asc`,
    );
    const events: PersistedEvent[] = (
      eventRows as unknown as Array<{
        seq: number;
        revision: number;
        payload: unknown;
      }>
    ).map((r) => ({ seq: r.seq, revision: r.revision, payload: r.payload }));

    const { seedBytes, startOptions } = await this.getSystemPrivate(
      ownerId,
      sessionId,
    );
    const state = replay(seedBytes, startOptions, events);

    const lastEventSeq = events.length - 1;
    const revision = state.revision;
    const stateJson = definition.serializeState(state);
    const checksum = computeSnapshotChecksum({
      definitionId: session.definitionId,
      versions: session.versions,
      lastEventSeq,
      revision,
      stateJson,
    });

    // A replayed state is dispatchable only when the event stream fully
    // accounts for the session revision: the last event's producing revision
    // must equal it. Zero-event transitions (night submissions) leave the
    // event stream behind the session, and the replayed state is then a
    // read-only projection (night buffers are unreconstructable).
    const lastEventRevision = events.length > 0 ? events[events.length - 1].revision : 0;
    const dispatchable = lastEventRevision === session.revision;

    // Heal the cache. When a bad row was observed, the heal is a
    // compare-and-swap on its checksum: it overwrites only if the row is
    // still the same bad one (a concurrent append rewrites the checksum and
    // wins). When no row existed, the heal only moves the snapshot forward,
    // so it can never regress a snapshot a concurrent append advanced past.
    const healWhere =
      snap !== undefined
        ? sql`game_snapshots.checksum = ${snap.checksum}`
        : sql`game_snapshots.last_event_seq < excluded.last_event_seq`;
    await this.db.execute(
      sql`insert into game_snapshots
            (session_id, last_event_seq, revision, checksum, state_json,
             definition_version, rules_version, event_schema_version, prng_version,
             created_at, updated_at)
          values
            (${sessionId}, ${lastEventSeq}, ${revision}, ${checksum}, ${stateJson},
             ${session.versions.definition}, ${session.versions.rules},
             ${session.versions.eventSchema}, ${session.versions.prng},
             now(), now())
          on conflict (session_id) do update set
            last_event_seq = excluded.last_event_seq,
            revision = excluded.revision,
            checksum = excluded.checksum,
            state_json = excluded.state_json,
            definition_version = excluded.definition_version,
            rules_version = excluded.rules_version,
            event_schema_version = excluded.event_schema_version,
            prng_version = excluded.prng_version,
            updated_at = now()
          where ${healWhere}`,
    );

    return { state, source: "replay", snapshotRejectedReason: rejected, dispatchable };
  }

  // -------------------------------------------------------------------------
  // Atomic append: events + session CAS + snapshot, one transaction
  // -------------------------------------------------------------------------

  /**
   * Append events (possibly none — a transition may only change private
   * state) under revision/phase-token CAS. All statements run in one
   * transaction; readers never observe a partial commit, and a stale
   * revision or phase token writes nothing.
   */
  async appendAndSnapshot(
    ownerId: string,
    sessionId: string,
    input: AppendInput,
  ): Promise<AppendResult> {
    return withTx(this.db, async (tx) => {
      const session = await lockSession(tx, ownerId, sessionId);
      return commitAppend(tx, session, input);
    });
  }

  /**
   * Idempotent action execution: one transaction that serializes on the
   * session row, then either replays the stored receipt (same key + same
   * request hash -> the stored stable response, applied exactly once),
   * refuses a conflicting payload (same key + different hash), or appends
   * and records the receipt.
   */
  async executeAction(
    ownerId: string,
    sessionId: string,
    input: ExecuteActionInput,
  ): Promise<ExecuteActionResult> {
    return withTx(this.db, async (tx) => {
      const session = await lockSession(tx, ownerId, sessionId);
      const existing = await tx
        .select()
        .from(schema.gameActionReceipts)
        .where(
          and(
            eq(schema.gameActionReceipts.sessionId, sessionId),
            eq(schema.gameActionReceipts.key, input.key),
          ),
        )
        .limit(1);
      const receipt = existing[0];
      if (receipt) {
        if (receipt.requestHash !== input.requestHash) {
          throw new PersistenceError(
            "IDEMPOTENCY_CONFLICT",
            `key ${input.key} already used with a different request hash`,
          );
        }
        return {
          applied: false,
          revision: receipt.revision,
          response: receipt.responseJson,
          responseHash: receipt.responseHash,
        };
      }
      const appended = await commitAppend(tx, session, input);
      const responseHash = sha256Hex(JSON.stringify(input.responseJson));
      // Return the STORED response (jsonb-normalized), so the applied path
      // and the replayed path return byte-identical payloads.
      const stored = await tx
        .insert(schema.gameActionReceipts)
        .values({
          sessionId,
          key: input.key,
          requestHash: input.requestHash,
          responseJson: input.responseJson,
          responseHash,
          revision: appended.revision,
        })
        .returning({ responseJson: schema.gameActionReceipts.responseJson });
      return {
        applied: true,
        revision: appended.revision,
        firstSeq: appended.firstSeq,
        lastSeq: appended.lastSeq,
        response: stored[0].responseJson,
      };
    });
  }

  /**
   * Owner-scoped lookup of one idempotency receipt. Callers use this to
   * replay a stored stable response WITHOUT re-running the action; the
   * authoritative check still lives inside executeAction's transaction.
   */
  async getActionReceipt(
    ownerId: string,
    sessionId: string,
    key: string,
  ): Promise<{
    requestHash: string;
    responseJson: unknown;
    responseHash: string;
    revision: number;
  } | null> {
    const rows = await this.db.execute(
      sql`select r.request_hash, r.response_json, r.response_hash, r.revision
          from ${schema.gameActionReceipts} r
          join ${schema.gameSessions} s on s.id = r.session_id
          where r.session_id = ${sessionId} and r.key = ${key} and s.owner_id = ${ownerId}
          limit 1`,
    );
    const row = rows[0] as
      | {
          request_hash: string;
          response_json: unknown;
          response_hash: string;
          revision: number;
        }
      | undefined;
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseJson: row.response_json,
      responseHash: row.response_hash,
      revision: row.revision,
    };
  }

  // -------------------------------------------------------------------------
  // AI claims: database-time leases, attempts and budget
  // -------------------------------------------------------------------------

  /**
   * Claim the AI turn for (session, seat, phaseToken, purpose). One
   * transaction: the claim and the budget increment are atomic — a claim
   * that would exceed the budget is rolled back entirely and raises
   * BUDGET_EXHAUSTED. A claim while an unexpired lease is held returns null
   * (the holder may still finish). Expiry is database time (now() in SQL).
   */
  async claimAiLease(
    ownerId: string,
    sessionId: string,
    input: {
      seat: number;
      phaseToken: string;
      purpose: string;
      ttlSeconds: number;
    },
  ): Promise<AiLease | null> {
    return withTx(this.db, async (tx) => {
      const session = await lockSession(tx, ownerId, sessionId);

      const claimRows = await tx.execute(
        sql`
        insert into game_ai_runs
          (session_id, seat, phase_token, purpose, status, claim_token,
           claim_generation, lease_expires_at, attempts, started_at, created_at, updated_at)
        select s.id, ${input.seat}, ${input.phaseToken}, ${input.purpose},
               'claimed', gen_random_uuid(), 1, now() + make_interval(secs => ${input.ttlSeconds}),
               1, now(), now(), now()
        from ${schema.gameSessions} s
        where s.id = ${sessionId} and s.owner_id = ${ownerId}
        on conflict (session_id, seat, phase_token, purpose) do update set
          status = 'claimed',
          claim_token = gen_random_uuid(),
          claim_generation = game_ai_runs.claim_generation + 1,
          lease_expires_at = now() + make_interval(secs => ${input.ttlSeconds}),
          started_at = now(),
          attempts = game_ai_runs.attempts + 1,
          completed_at = null,
          result = null,
          last_error = null,
          updated_at = now()
        where game_ai_runs.status not in ('claimed', 'running')
           or game_ai_runs.lease_expires_at < now()
        returning claim_token::text, claim_generation, lease_expires_at, attempts`,
      );
      const row = claimRows[0] as
        | {
            claim_token: string;
            claim_generation: number;
            lease_expires_at: Date;
            attempts: number;
          }
        | undefined;
      if (!row) {
        // A live lease is held by another worker: no budget is consumed.
        return null;
      }

      const budgetRows = await tx.execute(
        sql`update game_sessions
            set ai_budget_consumed = ai_budget_consumed + 1, updated_at = now()
            where id = ${sessionId} and owner_id = ${ownerId}
              and ai_budget_consumed < ai_budget_limit
            returning ai_budget_consumed, ai_budget_limit`,
      );
      const budget = budgetRows[0] as
        | { ai_budget_consumed: number; ai_budget_limit: number }
        | undefined;
      if (!budget) {
        // Rolling back the whole transaction also undoes the claim above.
        throw new PersistenceError(
          "BUDGET_EXHAUSTED",
          `session ${sessionId} AI budget ${session.aiBudgetLimit} exhausted`,
        );
      }

      return {
        claimToken: row.claim_token,
        generation: row.claim_generation,
        leaseExpiresAt: row.lease_expires_at,
        attempts: row.attempts,
        budgetConsumed: budget.ai_budget_consumed,
        budgetLimit: budget.ai_budget_limit,
      };
    });
  }

  /**
   * Finish a claimed run. Accepted only while the same claim token and
   * generation still hold an unexpired lease (database time): a result
   * delivered under an expired or reclaimed lease is rejected with
   * STALE_LEASE.
   */
  async completeAiRun(
    ownerId: string,
    sessionId: string,
    input: CompleteAiRunInput,
  ): Promise<{ attempts: number }> {
    const rows = await this.db.execute(
      sql`update game_ai_runs r
          set status = ${input.status},
              completed_at = now(),
              result = ${input.result === undefined ? null : JSON.stringify(input.result)}::jsonb,
              last_error = ${input.error ?? null},
              updated_at = now()
          from ${schema.gameSessions} s
          where r.session_id = s.id and s.owner_id = ${ownerId}
            and r.session_id = ${sessionId}
            and r.seat = ${input.seat}
            and r.phase_token = ${input.phaseToken}
            and r.purpose = ${input.purpose}
            and r.claim_token = ${input.claimToken}
            and r.claim_generation = ${input.generation}
            and r.status = 'claimed'
            and r.lease_expires_at >= now()
          returning r.attempts`,
    );
    const row = rows[0] as { attempts: number } | undefined;
    if (!row) {
      throw new PersistenceError(
        "STALE_LEASE",
        `claim ${input.claimToken}#${input.generation} for seat ${input.seat} (${input.phaseToken}/${input.purpose}) was reclaimed or expired`,
      );
    }
    return { attempts: row.attempts };
  }

  /** Gracefully release a live claim; releasing a lost lease raises STALE_LEASE. */
  async releaseAiLease(
    ownerId: string,
    sessionId: string,
    input: {
      seat: number;
      phaseToken: string;
      purpose: string;
      claimToken: string;
      generation: number;
    },
  ): Promise<void> {
    const rows = await this.db.execute(
      sql`update game_ai_runs r
          set status = 'idle',
              claim_token = null,
              lease_expires_at = null,
              completed_at = now(),
              updated_at = now()
          from ${schema.gameSessions} s
          where r.session_id = s.id and s.owner_id = ${ownerId}
            and r.session_id = ${sessionId}
            and r.seat = ${input.seat}
            and r.phase_token = ${input.phaseToken}
            and r.purpose = ${input.purpose}
            and r.claim_token = ${input.claimToken}
            and r.claim_generation = ${input.generation}
            and r.status = 'claimed'
          returning r.id`,
    );
    if (!rows[0]) {
      throw new PersistenceError(
        "STALE_LEASE",
        `claim ${input.claimToken}#${input.generation} for seat ${input.seat} was reclaimed or expired`,
      );
    }
  }

  /** Owner-scoped AI run row for one (session, seat, phaseToken, purpose). */
  async getAiRun(
    ownerId: string,
    sessionId: string,
    input: { seat: number; phaseToken: string; purpose: string },
  ): Promise<AiRunInfo | null> {
    const rows = await this.db.execute(
      sql`select r.id, r.seat, r.phase_token, r.purpose, r.status,
                 r.claim_generation, r.lease_expires_at, r.attempts, r.result, r.last_error
          from ${schema.gameAiRuns} r
          join ${schema.gameSessions} s on s.id = r.session_id
          where r.session_id = ${sessionId} and s.owner_id = ${ownerId}
            and r.seat = ${input.seat}
            and r.phase_token = ${input.phaseToken}
            and r.purpose = ${input.purpose}
          limit 1`,
    );
    const row = rows[0] as
      | {
          id: string;
          seat: number;
          phase_token: string;
          purpose: string;
          status: string;
          claim_generation: number;
          lease_expires_at: Date | null;
          attempts: number;
          result: unknown;
          last_error: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      seat: row.seat,
      phaseToken: row.phase_token,
      purpose: row.purpose,
      status: row.status,
      claimGeneration: row.claim_generation,
      leaseExpiresAt: row.lease_expires_at,
      attempts: row.attempts,
      result: row.result,
      lastError: row.last_error,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (all receive an open transaction)
// ---------------------------------------------------------------------------

/** Lock and fetch the session row; owner mismatch and absence are NOT_FOUND. */
async function lockSession(
  tx: Tx,
  ownerId: string,
  sessionId: string,
): Promise<ReturnType<typeof toSessionInfo>> {
  const rows = await tx
    .select()
    .from(schema.gameSessions)
    .where(
      and(
        eq(schema.gameSessions.id, sessionId),
        eq(schema.gameSessions.ownerId, ownerId),
      ),
    )
    .for("update")
    .limit(1);
  if (!rows[0]) {
    throw new PersistenceError("NOT_FOUND", `session ${sessionId}`);
  }
  return toSessionInfo(rows[0]);
}

/** Append inside an open transaction: CAS, events, session, snapshot. */
async function commitAppend(
  tx: Tx,
  session: SessionInfo,
  input: AppendInput,
): Promise<AppendResult> {
  // Zero-event appends are legal: a transition may change only private
  // state (e.g. a night submission), which must still persist the snapshot
  // under the same CAS — otherwise a restart would lose it.
  if (session.revision !== input.expectedRevision) {
    throw new PersistenceError(
      "STALE_REVISION",
      `expected revision ${input.expectedRevision}, current is ${session.revision}`,
    );
  }
  if (session.phaseToken !== input.expectedPhaseToken) {
    throw new PersistenceError(
      "STALE_PHASE_TOKEN",
      `expected phase token ${input.expectedPhaseToken}, current is ${session.phaseToken}`,
    );
  }
  if (
    !versionsMatch(
      { id: input.definitionId, versions: input.versions },
      session,
    )
  ) {
    throw new PersistenceError(
      "VERSION_MISMATCH",
      `append versions do not match session ${session.id}`,
    );
  }
  if (!isValidSnapshotChecksum(input.checksum)) {
    throw new PersistenceError("INVALID_ARGUMENT", "checksum is not a sha256 hex digest");
  }

  const newRevision = session.revision + 1;
  const [maxRow] = await tx.execute(
    sql`select coalesce(max(seq) + 1, 0)::int as next
        from ${schema.gameEvents}
        where session_id = ${session.id}`,
  );
  const nextSeq = (maxRow as { next: number }).next;
  const lastSeq = nextSeq + input.events.length - 1;

  const computed = computeSnapshotChecksum({
    definitionId: session.definitionId,
    versions: session.versions,
    lastEventSeq: lastSeq,
    revision: newRevision,
    stateJson: input.stateJson,
  });
  if (computed !== input.checksum) {
    throw new PersistenceError(
      "INVALID_CHECKSUM",
      `supplied checksum ${input.checksum} does not match the supplied state`,
    );
  }

  if (input.events.length > 0) {
    await tx.insert(schema.gameEvents).values(
      input.events.map((payload, i) => ({
        sessionId: session.id,
        seq: nextSeq + i,
        revision: newRevision,
        payload,
      })),
    );
  }
  await tx
    .update(schema.gameSessions)
    .set({
      revision: newRevision,
      phaseToken: input.newPhaseToken,
      updatedAt: new Date(),
    })
    .where(eq(schema.gameSessions.id, session.id));
  await tx
    .insert(schema.gameSnapshots)
    .values({
      sessionId: session.id,
      lastEventSeq: lastSeq,
      revision: newRevision,
      checksum: input.checksum,
      stateJson: input.stateJson,
      definitionVersion: session.versions.definition,
      rulesVersion: session.versions.rules,
      eventSchemaVersion: session.versions.eventSchema,
      prngVersion: session.versions.prng,
    })
    .onConflictDoUpdate({
      target: schema.gameSnapshots.sessionId,
      set: {
        lastEventSeq: lastSeq,
        revision: newRevision,
        checksum: input.checksum,
        stateJson: input.stateJson,
        definitionVersion: session.versions.definition,
        rulesVersion: session.versions.rules,
        eventSchemaVersion: session.versions.eventSchema,
        prngVersion: session.versions.prng,
        updatedAt: new Date(),
      },
    });

  return { revision: newRevision, firstSeq: nextSeq, lastSeq };
}
