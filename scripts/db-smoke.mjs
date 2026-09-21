// Migration smoke assertions: verifies that applying ./drizzle from scratch
// against the DATABASE_URL in the environment produced the full expected
// schema. Only ever pointed at the throwaway Postgres container started by
// verify-security-baseline.mjs — never at a development database.

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Domain/auth tables live in `public`; the drizzle-kit migrator keeps its
// bookkeeping table in the `drizzle` schema.
const EXPECTED_TABLES = {
  public: [
    "users",
    "accounts",
    "sessions",
    "verification_tokens",
    "lesson_progress",
    "favorites",
    "textbook_favorites",
    "quiz_attempts",
    "study_time_daily",
    "game_sessions",
    "game_events",
    "game_snapshots",
    "game_action_receipts",
    "game_ai_runs",
    "game_system_private",
  ],
  drizzle: ["__drizzle_migrations"],
};

const EXPECTED_MIGRATIONS = 6; // 0000_init .. 0005_p6_game_safety_metadata

const sql = postgres(connectionString, { max: 1 });

try {
  const tables = await sql`
    select schemaname, tablename from pg_tables
    where schemaname in ('public', 'drizzle')
  `;
  const have = new Map();
  for (const r of tables) {
    if (!have.has(r.schemaname)) have.set(r.schemaname, new Set());
    have.get(r.schemaname).add(r.tablename);
  }
  const totalExpected = Object.values(EXPECTED_TABLES).reduce(
    (n, l) => n + l.length,
    0,
  );
  const missing = [];
  for (const [schema, names] of Object.entries(EXPECTED_TABLES)) {
    for (const t of names) {
      if (!have.get(schema)?.has(t)) missing.push(`${schema}.${t}`);
    }
  }
  if (missing.length > 0) {
    console.error(`Missing tables: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${totalExpected} expected tables present.`);
  }

  const enums = await sql`
    select typname from pg_type where typtype = 'e' and typname = 'lesson_status'
  `;
  if (enums.length !== 1) {
    console.error("Expected enum lesson_status to exist");
    process.exitCode = 1;
  } else {
    console.log("Enum lesson_status present.");
  }

  const [migRow] = await sql`
    select count(*)::int as n from drizzle.__drizzle_migrations
  `;
  if (migRow.n !== EXPECTED_MIGRATIONS) {
    console.error(
      `Expected ${EXPECTED_MIGRATIONS} applied migrations, found ${migRow.n}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`All ${EXPECTED_MIGRATIONS} migrations recorded.`);
  }

  // P4.1 orchestration budget columns on game_sessions.
  const budgetColumns = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'game_sessions'
      and column_name in ('ai_logical_calls', 'ai_tokens_consumed')
  `;
  const haveBudget = new Set(budgetColumns.map((r) => r.column_name));
  const missingBudget = ["ai_logical_calls", "ai_tokens_consumed"].filter(
    (c) => !haveBudget.has(c),
  );
  if (missingBudget.length > 0) {
    console.error(`Missing game_sessions budget columns: ${missingBudget.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("game_sessions budget columns present.");
  }

  // P6.3: separate input/output token counters + sanitized run metadata.
  const tokenColumns = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'game_sessions'
      and column_name in ('ai_input_tokens_consumed', 'ai_output_tokens_consumed')
  `;
  const haveTokens = new Set(tokenColumns.map((r) => r.column_name));
  const missingTokens = ["ai_input_tokens_consumed", "ai_output_tokens_consumed"].filter(
    (c) => !haveTokens.has(c),
  );
  if (missingTokens.length > 0) {
    console.error(`Missing game_sessions token columns: ${missingTokens.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("game_sessions token columns present.");
  }

  const runColumns = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'game_ai_runs'
      and column_name in ('provider', 'requested_model', 'response_model', 'response_id',
                          'system_fingerprint', 'prompt_version', 'latency_ms',
                          'input_tokens', 'output_tokens', 'total_tokens',
                          'cached_input_tokens', 'fallback', 'error_code')
  `;
  const haveRun = new Set(runColumns.map((r) => r.column_name));
  const missingRun = [
    "provider", "requested_model", "response_model", "response_id",
    "system_fingerprint", "prompt_version", "latency_ms",
    "input_tokens", "output_tokens", "total_tokens",
    "cached_input_tokens", "fallback", "error_code",
  ].filter((c) => !haveRun.has(c));
  if (missingRun.length > 0) {
    console.error(`Missing game_ai_runs metadata columns: ${missingRun.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("game_ai_runs sanitized metadata columns present.");
  }

  const dropped = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'game_ai_runs'
      and column_name in ('result', 'last_error')
  `;
  if (dropped.length > 0) {
    console.error("game_ai_runs still carries result/last_error columns");
    process.exitCode = 1;
  } else {
    console.log("game_ai_runs raw result/error columns absent.");
  }
} catch (err) {
  console.error("DB smoke failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
