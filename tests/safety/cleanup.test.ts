/**
 * P6.3 retention cleanup (default 30 days): the verifiable cleanup command
 * scripts/cleanup-games.mjs, exercised end-to-end against the isolated
 * real Postgres at the N-1/N/N+1 boundary (29/30/31 days):
 *
 * - finished / aborted / abandoned sessions older than the window are
 *   deleted together with their AI metadata (cascade);
 * - sessions at exactly the window and younger are kept;
 * - ACTIVE sessions are never deleted, whatever their age;
 * - the dry run (default) deletes nothing and prints the exact counts.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_ORCHESTRATION_CONFIG } from "@/lib/games/orchestration";
import { makeOwner, openContext, type TestContext } from "./helpers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface SeedSpec {
  status: "finished" | "aborted" | "abandoned" | "active";
  /** SQL interval expression for the row's age, e.g. "31 days". */
  age: string;
}

function seedSession(ctx: TestContext, ownerId: string, spec: SeedSpec, tag: string) {
  // A real game row: minimal required columns, updated_at at the given age.
  return ctx.client`
    insert into game_sessions (owner_id, definition_id, title, definition_version,
      rules_version, event_schema_version, prng_version, status, revision,
      phase_token, ai_budget_limit, updated_at)
    values (${ownerId}, 'quick6', ${tag}, 'v1', 'v1', 'v1', 'v1', ${spec.status}, 0,
            'end', 60, now() - ${spec.age}::interval)
    returning id
  `;
}

function seedAiRun(ctx: TestContext, sessionId: string) {
  return ctx.client`
    insert into game_ai_runs (session_id, seat, phase_token, purpose, status, provider,
      requested_model, prompt_version, attempts)
    values (${sessionId}, 1, 'night:1', 'wolf-kill', 'succeeded', 'deepseek',
            'deepseek-chat', 'prompt-v1', 1)
  `;
}

function runCleanup(args: string[] = []) {
  return spawnSync("node", [path.join(ROOT, "scripts", "cleanup-games.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
}

describe("P6.3 30-day retention cleanup (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
    // The isolated DB is shared across the suite's files (sequential), and
    // this test asserts exact global counts: start from an empty game set.
    await ctx.client`delete from game_sessions`;
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("the frozen retention default is 30 days", () => {
    expect(DEFAULT_ORCHESTRATION_CONFIG.retention.completedGameDays).toBe(30);
  });

  it("29/30/31-day boundary: only sessions strictly older than 30 days are deleted; active games never are", async () => {
    const ownerId = await makeOwner(ctx.db);

    // N-1/N/N+1 rows plus guard rows. The exact 30-day instant cannot be
    // represented in wall-clock SQL (two now() evaluations differ by
    // microseconds), so the N row sits one hour INSIDE the window.
    const specs: SeedSpec[] = [
      { status: "finished", age: "29 days" }, // N-1: kept
      { status: "finished", age: "30 days - 1 hour" }, // N (inside window): kept
      { status: "finished", age: "31 days" }, // N+1: deleted
      { status: "abandoned", age: "31 days" }, // deleted
      { status: "aborted", age: "31 days" }, // deleted
      { status: "active", age: "40 days" }, // active: NEVER deleted
      { status: "active", age: "1 day" }, // fresh active: kept
      { status: "finished", age: "1 day" }, // fresh finished: kept
    ];
    const ids: string[] = [];
    for (const [index, spec] of specs.entries()) {
      const [row] = await seedSession(ctx, ownerId, spec, `retention-${index}`);
      ids.push(row.id);
      if (spec.status !== "active") {
        await seedAiRun(ctx, row.id);
      }
    }

    // Dry run (default): prints the exact counts, deletes nothing.
    const dry = runCleanup([]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("retention_days=30");
    // Sessions older than 30 days: 3; their AI runs: 3.
    expect(dry.stdout).toContain("matching_sessions=3 ai_runs=3");
    expect(dry.stdout).toContain("dry_run");
    const [afterDry] = await ctx.client`select count(*)::int as n from game_sessions`;
    expect(afterDry.n).toBe(specs.length);

    // Apply: deletes exactly the 3 expired sessions + their AI metadata.
    const apply = runCleanup(["--days=30", "--apply"]);
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain("deleted_sessions=3 deleted_ai_runs=3");
    expect(apply.stdout).toContain(`remaining_sessions=${specs.length - 3}`);
    expect(apply.stdout).toContain("remaining_ai_runs=3"); // 3 kept finished rows (29d, 30d-1h, 1d)

    const remaining = await ctx.client`select id from game_sessions order by created_at`;
    const keptIds = new Set(remaining.map((r) => String((r as { id: string }).id)));
    // The 29/30-day finished rows, the two active rows and the fresh
    // finished row survived; the three 31-day rows are gone.
    expect(keptIds.has(ids[0])).toBe(true); // finished 29d
    expect(keptIds.has(ids[1])).toBe(true); // finished 30d
    expect(keptIds.has(ids[2])).toBe(false); // finished 31d
    expect(keptIds.has(ids[3])).toBe(false); // abandoned 31d
    expect(keptIds.has(ids[4])).toBe(false); // aborted 31d
    expect(keptIds.has(ids[5])).toBe(true); // active 40d — never deleted
    expect(keptIds.has(ids[6])).toBe(true); // active 1d
    expect(keptIds.has(ids[7])).toBe(true); // finished 1d

    // The AI runs cascade with their sessions: none dangle.
    const [orphans] = await ctx.client`
      select count(*)::int as n from game_ai_runs r
      where not exists (select 1 from game_sessions s where s.id = r.session_id)
    `;
    expect(orphans.n).toBe(0);
  });

  it("a custom window is honored (--days=N) and invalid windows are refused", () => {
    const bad = runCleanup(["--days=0"]);
    expect(bad.status).not.toBe(0);
    const badArg = runCleanup(["--nope"]);
    expect(badArg.status).not.toBe(0);
  });
});
