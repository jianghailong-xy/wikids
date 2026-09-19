/**
 * Orchestration persistence helpers (P4.1), kept apart from the P3
 * repository: these statements serve the application service's budgets and
 * status bookkeeping. Everything is owner-scoped inside the SQL condition
 * and each write is one short database-only statement (or transaction) —
 * no network call may sit inside them (enforced by core/tx.ts, which every
 * repository transaction goes through).
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

/** Budget counters the orchestration reads before each provider decision. */
export interface SessionBudgetState {
  readonly aiBudgetLimit: number;
  readonly aiBudgetConsumed: number;
  readonly aiLogicalCalls: number;
  readonly aiTokensConsumed: number;
}

export class OrchestrationStore {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  /** Count the owner's active (unfinished) games — the per-user budget. */
  async countActiveSessions(ownerId: string): Promise<number> {
    const rows = await this.db.execute(
      sql`select count(*)::int as n from ${schema.gameSessions}
          where owner_id = ${ownerId} and status = 'active'`,
    );
    return (rows[0] as { n: number }).n;
  }

  /** Owner-scoped budget counters, or null when the session does not exist. */
  async getBudgetState(ownerId: string, sessionId: string): Promise<SessionBudgetState | null> {
    const rows = await this.db.execute(
      sql`select ai_budget_limit, ai_budget_consumed, ai_logical_calls, ai_tokens_consumed
          from ${schema.gameSessions}
          where id = ${sessionId} and owner_id = ${ownerId}
          limit 1`,
    );
    const row = rows[0] as
      | {
          ai_budget_limit: number;
          ai_budget_consumed: number;
          ai_logical_calls: number;
          ai_tokens_consumed: number;
        }
      | undefined;
    if (!row) return null;
    return {
      aiBudgetLimit: row.ai_budget_limit,
      aiBudgetConsumed: row.ai_budget_consumed,
      aiLogicalCalls: row.ai_logical_calls,
      aiTokensConsumed: row.ai_tokens_consumed,
    };
  }

  /**
   * Atomically reserve one logical AI call: a single guarded UPDATE that
   * increments the counter only while it stays under the cap, so the
   * per-game logical-call budget holds strictly even when several
   * decisions run concurrently. The reservation is charged up front — a
   * provider attempt that later fails still counts (failed attempts are
   * charged), and a decision that ends up deferred (lease held by another
   * worker) refunds it via {@link refundLogicalCall}.
   */
  async tryReserveLogicalCall(
    ownerId: string,
    sessionId: string,
    cap: number,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      sql`update ${schema.gameSessions}
          set ai_logical_calls = ai_logical_calls + 1, updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}
            and ai_logical_calls < ${cap}
          returning ai_logical_calls`,
    );
    return rows.length > 0;
  }

  /** Refund a reservation that never reached the provider (never below 0). */
  async refundLogicalCall(ownerId: string, sessionId: string): Promise<void> {
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set ai_logical_calls = greatest(ai_logical_calls - 1, 0), updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}`,
    );
  }

  /** Add provider response tokens to the per-game token counter. */
  async addTokens(ownerId: string, sessionId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set ai_tokens_consumed = ai_tokens_consumed + ${tokens}, updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}`,
    );
  }

  /**
   * Mark a finished game inactive so it no longer counts against the
   * per-user concurrent-games budget. One short statement.
   */
  async markFinished(ownerId: string, sessionId: string): Promise<void> {
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set status = 'finished', updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}`,
    );
  }

  /**
   * Mark a round-budget-aborted game: it too stops counting against the
   * per-user budget (an aborted game is never played again).
   */
  async markAborted(ownerId: string, sessionId: string): Promise<void> {
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set status = 'aborted', updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}`,
    );
  }

  /** Truncate every game row for this owner (test helper scope). */
  async deleteOwnerGames(ownerId: string): Promise<void> {
    await this.db.execute(sql`delete from ${schema.gameSessions} where owner_id = ${ownerId}`);
  }
}
