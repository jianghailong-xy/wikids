/**
 * Orchestration persistence helpers (P4.1, extended P6.3), kept apart from
 * the P3 repository: these statements serve the application service's
 * budgets and status bookkeeping. Everything is owner-scoped inside the SQL
 * condition and each write is one short database-only statement (or
 * transaction) — no network call may sit inside them (enforced by
 * core/tx.ts, which every repository transaction goes through).
 *
 * P6.3 additions: separate input/output token counters, and the per-user
 * DAILY logical-call budget enforced atomically inside the reservation
 * (serialized by an owner-scoped advisory lock, database-day based).
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { withTx } from "@/lib/games/core";

/** Budget counters the orchestration reads before each provider decision. */
export interface SessionBudgetState {
  readonly aiBudgetLimit: number;
  readonly aiBudgetConsumed: number;
  readonly aiLogicalCalls: number;
  readonly aiTokensConsumed: number;
  readonly aiInputTokensConsumed: number;
  readonly aiOutputTokensConsumed: number;
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
      sql`select ai_budget_limit, ai_budget_consumed, ai_logical_calls, ai_tokens_consumed,
                 ai_input_tokens_consumed, ai_output_tokens_consumed
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
          ai_input_tokens_consumed: number;
          ai_output_tokens_consumed: number;
        }
      | undefined;
    if (!row) return null;
    return {
      aiBudgetLimit: row.ai_budget_limit,
      aiBudgetConsumed: row.ai_budget_consumed,
      aiLogicalCalls: row.ai_logical_calls,
      aiTokensConsumed: row.ai_tokens_consumed,
      aiInputTokensConsumed: row.ai_input_tokens_consumed,
      aiOutputTokensConsumed: row.ai_output_tokens_consumed,
    };
  }

  /**
   * Atomically reserve one logical AI call under BOTH the per-game cap and
   * the owner's daily cap: a single guarded UPDATE inside a transaction
   * serialized by an owner-scoped advisory lock, so concurrent decisions of
   * one owner cannot both pass either boundary. The reservation is charged
   * up front — a provider attempt that later fails still counts (failed
   * attempts are charged), and a decision that ends up deferred (lease held
   * by another worker) refunds it via {@link refundLogicalCall}.
   *
   * Returns false when either cap would be exceeded (nothing recorded).
   */
  async tryReserveLogicalCall(
    ownerId: string,
    sessionId: string,
    cap: number,
    dailyCap?: number,
  ): Promise<boolean> {
    return withTx(this.db, async (tx) => {
      if (dailyCap !== undefined) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`ai-daily:${ownerId}`}))`,
        );
      }
      const rows = await tx.execute(
        sql`update ${schema.gameSessions}
            set ai_logical_calls = ai_logical_calls + 1, updated_at = now()
            where id = ${sessionId} and owner_id = ${ownerId}
              and ai_logical_calls < ${cap}
              ${
                dailyCap !== undefined
                  ? sql`and (select coalesce(sum(g.ai_logical_calls), 0)::int
                             from ${schema.gameSessions} g
                             where g.owner_id = ${ownerId}
                               and g.created_at >= date_trunc('day', now())) < ${dailyCap}`
                  : sql``
              }
            returning ai_logical_calls`,
      );
      return rows.length > 0;
    });
  }

  /** Refund a reservation that never reached the provider (never below 0). */
  async refundLogicalCall(ownerId: string, sessionId: string): Promise<void> {
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set ai_logical_calls = greatest(ai_logical_calls - 1, 0), updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId}`,
    );
  }

  /**
   * Add provider token usage to the per-game counters: the P6.3 input/
   * output split plus the P4.1 total (kept in sync for compatibility).
   */
  async addTokenUsage(
    ownerId: string,
    sessionId: string,
    usage: { readonly inputTokens: number; readonly outputTokens: number },
  ): Promise<void> {
    const inputTokens = Math.max(0, Math.trunc(usage.inputTokens));
    const outputTokens = Math.max(0, Math.trunc(usage.outputTokens));
    if (inputTokens + outputTokens <= 0) return;
    await this.db.execute(
      sql`update ${schema.gameSessions}
          set ai_input_tokens_consumed = ai_input_tokens_consumed + ${inputTokens},
              ai_output_tokens_consumed = ai_output_tokens_consumed + ${outputTokens},
              ai_tokens_consumed = ai_tokens_consumed + ${inputTokens + outputTokens},
              updated_at = now()
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

  /**
   * Mark an active game abandoned by its owner (P5.1): it stops counting
   * against the per-user active-games budget and can no longer be advanced.
   * Returns true when a row transitioned, false when the session was no
   * longer active (e.g. it finished between the check and this write).
   */
  async markAbandoned(ownerId: string, sessionId: string): Promise<boolean> {
    const rows = await this.db.execute(
      sql`update ${schema.gameSessions}
          set status = 'abandoned', updated_at = now()
          where id = ${sessionId} and owner_id = ${ownerId} and status = 'active'
          returning id`,
    );
    return rows.length > 0;
  }

  /** Truncate every game row for this owner (test helper scope). */
  async deleteOwnerGames(ownerId: string): Promise<void> {
    await this.db.execute(sql`delete from ${schema.gameSessions} where owner_id = ${ownerId}`);
  }
}
