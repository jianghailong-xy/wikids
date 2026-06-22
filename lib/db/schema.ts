import {
  boolean,
  date,
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type LessonProgress = typeof lessonProgress.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type StudyTimeDaily = typeof studyTimeDaily.$inferSelect;
