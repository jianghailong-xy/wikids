import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------- Auth.js tables ----------

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// ---------- Domain tables ----------

export const lessonStatusEnum = pgEnum("lesson_status", [
  "in_progress",
  "completed",
]);

// Progress is keyed by (user, textbook slug, lesson slug). Slugs come from the
// content registry — we treat them as stable identifiers so we don't need to
// sync MDX content into the database.
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textbookSlug: text("textbook_slug").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    status: lessonStatusEnum("status").notNull().default("in_progress"),
    lastViewedAt: timestamp("last_viewed_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (t) => ({
    userLessonUnique: uniqueIndex("lesson_progress_user_lesson_unique").on(
      t.userId,
      t.textbookSlug,
      t.lessonSlug,
    ),
  }),
);

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textbookSlug: text("textbook_slug").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => ({
    userLessonUnique: uniqueIndex("favorites_user_lesson_unique").on(
      t.userId,
      t.textbookSlug,
      t.lessonSlug,
    ),
  }),
);

// Favorites at the whole-textbook level (the heart on textbook cards). Kept
// separate from `favorites` above, which is per-lesson and requires a lesson
// slug — a textbook favorite has no lesson.
export const textbookFavorites = pgTable(
  "textbook_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textbookSlug: text("textbook_slug").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => ({
    userTextbookUnique: uniqueIndex(
      "textbook_favorites_user_textbook_unique",
    ).on(t.userId, t.textbookSlug),
  }),
);

export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  textbookSlug: text("textbook_slug").notNull(),
  lessonSlug: text("lesson_slug").notNull(),
  quizId: text("quiz_id").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  score: integer("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  passed: boolean("passed").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// Active study time, bucketed into one row per (user, calendar day). The
// lesson tracker flushes accumulated seconds and we increment the day's total,
// so row growth is bounded (one per user per day) and homepage stats —
// total / today / this week / streak — are cheap to compute.
export const studyTimeDaily = pgTable(
  "study_time_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Calendar day "YYYY-MM-DD" in the app timezone (see lib/study-stats.ts).
    day: date("day", { mode: "string" }).notNull(),
    seconds: integer("seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => ({
    userDayUnique: uniqueIndex("study_time_daily_user_day_unique").on(
      t.userId,
      t.day,
    ),
  }),
);

// ---------- Game persistence (P3) ----------
//
// Architecture invariants (see lib/games/core/repository.ts):
// - game_events is the fact stream / source of truth. Every legal state is
//   reachable by replaying the stream; (session_id, seq) is unique and seq
//   is contiguous from 0.
// - game_snapshots is a pure cache: one row per session carrying
//   last_event_seq, a checksum over the cached state and the four frozen
//   version stamps. A missing/corrupt/out-of-date snapshot is discarded and
//   rebuilt from the event stream — never trusted.
// - The session seed lives ONLY in game_system_private (SYSTEM-private
//   state): never in events, receipts, projections or any client payload.
// - All repository queries are owner-scoped: every SQL statement filters on
//   game_sessions.owner_id.

export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    definitionId: text("definition_id").notNull(),
    title: text("title").notNull(),
    // Frozen version stamps of the definition this session was created with.
    definitionVersion: text("definition_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    eventSchemaVersion: text("event_schema_version").notNull(),
    prngVersion: text("prng_version").notNull(),
    status: text("status").notNull().default("active"),
    // CAS tokens: revision bumps by exactly 1 per accepted transition and
    // phase_token is the definition's phase token, both updated atomically
    // with every event append.
    revision: integer("revision").notNull().default(0),
    phaseToken: text("phase_token").notNull().default(""),
    // AI budget: every provider attempt (timeouts/failures/retries included)
    // consumes one unit; claims are refused past the limit.
    aiBudgetLimit: integer("ai_budget_limit").notNull().default(100),
    aiBudgetConsumed: integer("ai_budget_consumed").notNull().default(0),
    // P4.1 orchestration counters: provider-backed decisions made and provider
    // response tokens received (failed attempts are charged by the claim, see
    // ai_budget_consumed above). Both are updated by the orchestration layer
    // (lib/games/orchestration) and read as budget pre-checks before a
    // decision goes to the provider; exhaustion forces the fallback.
    aiLogicalCalls: integer("ai_logical_calls").notNull().default(0),
    aiTokensConsumed: integer("ai_tokens_consumed").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index("game_sessions_owner_idx").on(t.ownerId),
  }),
);

export const gameEvents = pgTable(
  "game_events",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    // Contiguous event index within the session, starting at 0.
    seq: integer("seq").notNull(),
    // Revision that produced this event.
    revision: integer("revision").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.seq] }),
    seqCheck: check("game_events_seq_nonnegative", sql`${t.seq} >= 0`),
  }),
);

export const gameSnapshots = pgTable("game_snapshots", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => gameSessions.id, { onDelete: "cascade" }),
  lastEventSeq: integer("last_event_seq").notNull(),
  revision: integer("revision").notNull(),
  // sha256 over the canonical {definitionId, versions, lastEventSeq,
  // revision, stateJson} tuple — see lib/games/core/checksum.ts.
  checksum: text("checksum").notNull(),
  stateJson: text("state_json").notNull(),
  definitionVersion: text("definition_version").notNull(),
  rulesVersion: text("rules_version").notNull(),
  eventSchemaVersion: text("event_schema_version").notNull(),
  prngVersion: text("prng_version").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export const gameActionReceipts = pgTable(
  "game_action_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    // Client-supplied idempotency key, unique per session.
    key: text("key").notNull(),
    // sha256 of the canonical request payload.
    requestHash: text("request_hash").notNull(),
    // Stable response: returned verbatim on every replay of this key.
    responseJson: jsonb("response_json").$type<unknown>().notNull(),
    responseHash: text("response_hash").notNull(),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionKeyUnique: uniqueIndex("game_action_receipts_session_key_unique").on(
      t.sessionId,
      t.key,
    ),
  }),
);

export const gameAiRuns = pgTable(
  "game_ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    phaseToken: text("phase_token").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("idle"), // idle|claimed|running|succeeded|failed|timeout
    // Lease (database-time based): a claim sets claim_token/claim_generation
    // and lease_expires_at = now() + ttl; expiry or terminal status releases
    // the lease for reclamation.
    claimToken: uuid("claim_token"),
    claimGeneration: integer("claim_generation").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date", withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runUnique: uniqueIndex(
      "game_ai_runs_session_seat_phase_purpose_unique",
    ).on(t.sessionId, t.seat, t.phaseToken, t.purpose),
  }),
);

export const gameSystemPrivate = pgTable("game_system_private", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => gameSessions.id, { onDelete: "cascade" }),
  // Hex-encoded session seed. The durable home of the seed: it survives
  // snapshot loss and must never be projected to any seat or client.
  seedHex: text("seed_hex").notNull(),
  startOptions: jsonb("start_options").$type<unknown>(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type LessonProgress = typeof lessonProgress.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type TextbookFavorite = typeof textbookFavorites.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type StudyTimeDaily = typeof studyTimeDaily.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type GameEventRow = typeof gameEvents.$inferSelect;
export type GameSnapshot = typeof gameSnapshots.$inferSelect;
export type GameActionReceipt = typeof gameActionReceipts.$inferSelect;
export type GameAiRun = typeof gameAiRuns.$inferSelect;
export type GameSystemPrivate = typeof gameSystemPrivate.$inferSelect;
