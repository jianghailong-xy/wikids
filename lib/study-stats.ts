import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studyTimeDaily } from "@/lib/db/schema";

// Bucket study time by calendar day in one fixed timezone so "today", weekly
// totals, and streaks line up with the learner's day regardless of where the
// server runs. The audience is China-based, hence UTC+8.
export const APP_TIMEZONE = "Asia/Shanghai";

// "YYYY-MM-DD" for the given instant in APP_TIMEZONE. 'en-CA' formats dates as
// ISO-like YYYY-MM-DD, exactly the shape stored in the `day` column.
export function dayKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Shift a "YYYY-MM-DD" key by a whole number of days. The key is a pure
// calendar date, so we anchor it at UTC midnight to avoid DST/offset drift.
function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// Human-readable duration, e.g. "1h 5m", "42m", "<1m", "0m".
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

export type StudyStats = {
  totalSeconds: number;
  todaySeconds: number;
  weekSeconds: number;
  streakDays: number;
  // Last 7 days, oldest → newest, with zero-filled gaps.
  daily: { day: string; seconds: number }[];
};

export async function getStudyStats(userId: string): Promise<StudyStats> {
  const rows = await db
    .select({ day: studyTimeDaily.day, seconds: studyTimeDaily.seconds })
    .from(studyTimeDaily)
    .where(eq(studyTimeDaily.userId, userId));

  const byDay = new Map<string, number>();
  let totalSeconds = 0;
  for (const r of rows) {
    byDay.set(r.day, r.seconds);
    totalSeconds += r.seconds;
  }

  const today = dayKey();

  const daily: { day: string; seconds: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i);
    daily.push({ day: key, seconds: byDay.get(key) ?? 0 });
  }
  const weekSeconds = daily.reduce((sum, d) => sum + d.seconds, 0);
  const todaySeconds = byDay.get(today) ?? 0;

  // Consecutive days with study time, counting back from today.
  let streakDays = 0;
  for (let i = 0; ; i++) {
    if ((byDay.get(addDays(today, -i)) ?? 0) > 0) streakDays++;
    else break;
  }

  return { totalSeconds, todaySeconds, weekSeconds, streakDays, daily };
}
