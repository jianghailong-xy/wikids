import Link from "next/link";
import type { StudyStats } from "@/lib/study-stats";
import { formatDuration } from "@/lib/study-stats";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "YYYY-MM-DD" → short weekday label. The key is a pure calendar date, so we
// read it back at UTC midnight to get a stable weekday.
function weekdayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Homepage panel summarizing how much the signed-in learner has studied.
export function StudyStatsOverview({ stats }: { stats: StudyStats }) {
  const cards = [
    { label: "Total study time", value: formatDuration(stats.totalSeconds) },
    { label: "This week", value: formatDuration(stats.weekSeconds) },
    { label: "Today", value: formatDuration(stats.todaySeconds) },
    {
      label: "Day streak",
      value: `${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`,
    },
  ];

  // Scale bars against the busiest day in the window (min 1 to avoid /0).
  const maxSeconds = Math.max(1, ...stats.daily.map((d) => d.seconds));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-slate-900">Your learning</h2>
        <Link
          href="/progress"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          View progress →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-slate-100 bg-slate-50 p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {c.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Last 7 days
        </p>
        <div className="flex items-end gap-2">
          {stats.daily.map((d) => {
            const heightPct = Math.round((d.seconds / maxSeconds) * 100);
            return (
              <div
                key={d.day}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${weekdayLabel(d.day)}: ${formatDuration(d.seconds)}`}
              >
                <div className="flex h-24 w-full items-end">
                  <div
                    className="w-full rounded-t bg-brand-500"
                    style={{
                      // Floor non-zero days at a sliver so they stay visible.
                      height: `${d.seconds > 0 ? Math.max(heightPct, 6) : 0}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-slate-500">
                  {weekdayLabel(d.day)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
