// P6.3 retention cleanup: delete finished games and their AI metadata
// older than the retention window (default 30 days).
//
//   node scripts/cleanup-games.mjs [--days N] [--apply]
//
// Without --apply the command is a dry run: it prints exactly what it
// would delete and exits 0 without writing. With --apply it deletes and
// prints what was deleted. Active games are NEVER deleted, whatever their
// age — only finished / aborted / abandoned sessions whose updated_at is
// older than `now() - days` are removed (game_ai_runs and every other
// game row cascade with the session).
//
// Output lines (parseable for verification):
//   retention_days=N
//   matching_sessions=N ai_runs=M
//   deleted_sessions=N deleted_ai_runs=M   (only with --apply)
//   remaining_sessions=N remaining_ai_runs=M
//
// Requires DATABASE_URL (the same server-side connection the app uses).

import postgres from "postgres";

const DEFAULT_RETENTION_DAYS = 30;

function fail(message) {
  console.error(`cleanup-games: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let days = DEFAULT_RETENTION_DAYS;
let apply = false;
for (const arg of args) {
  if (arg === "--apply") {
    apply = true;
  } else if (arg.startsWith("--days=")) {
    days = Number(arg.slice("--days=".length));
  } else if (arg === "--days") {
    fail("--days must be given as --days=N");
  } else {
    fail(`unknown argument: ${arg}`);
  }
}
if (!Number.isInteger(days) || days < 1 || days > 3650) {
  fail(`--days must be an integer in 1..3650, got ${days}`);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail("DATABASE_URL is required");
}

const sql = postgres(connectionString, { max: 1 });

try {
  const [matching] = await sql`
    select
      (select count(*)::int from game_sessions
        where status in ('finished', 'aborted', 'abandoned')
          and updated_at < now() - make_interval(days => ${days})) as sessions,
      (select count(*)::int from game_ai_runs r
        join game_sessions s on s.id = r.session_id
        where s.status in ('finished', 'aborted', 'abandoned')
          and s.updated_at < now() - make_interval(days => ${days})) as ai_runs
  `;
  console.log(`retention_days=${days}`);
  console.log(`matching_sessions=${matching.sessions} ai_runs=${matching.ai_runs}`);

  if (!apply) {
    console.log("dry_run (no --apply): nothing deleted");
  } else {
    const [result] = await sql`
      with deleted as (
        delete from game_sessions
        where status in ('finished', 'aborted', 'abandoned')
          and updated_at < now() - make_interval(days => ${days})
        returning id
      )
      select (select count(*)::int from deleted) as sessions
    `;
    // AI runs cascade with their sessions; the matching count captured
    // before the delete is the number that went with them.
    console.log(`deleted_sessions=${result.sessions} deleted_ai_runs=${matching.ai_runs}`);
  }

  const [remaining] = await sql`
    select (select count(*)::int from game_sessions) as sessions,
           (select count(*)::int from game_ai_runs) as ai_runs
  `;
  console.log(`remaining_sessions=${remaining.sessions} remaining_ai_runs=${remaining.ai_runs}`);
} catch (err) {
  console.error("cleanup-games failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
