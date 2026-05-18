"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Volume2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type IrregularVerb,
  verbsUnlockedBy,
} from "@/content/irregular-verbs";

// localStorage shape: per-verb practice stats. streak is the current run
// of consecutive "Got it" answers. seen is the ISO date last reviewed —
// kept around so a future scheduler can re-surface old verbs.
type VerbStats = { streak: number; seen: string };
type AllStats = Record<string, VerbStats>;

const STORAGE_KEY = "wikids.irregular-verb-stats";
const MASTERED_AT = 3;

function loadStats(): AllStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AllStats) : {};
  } catch {
    return {};
  }
}

function saveStats(stats: AllStats) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore quota / private mode failures — UI keeps working in-memory.
  }
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "en-US";
  utt.rate = 0.9;
  window.speechSynthesis.speak(utt);
}

// Cumulative flashcard deck for irregular verbs. Pulls every verb unlocked
// by `unlockedBy` (this lesson) or any earlier one. Sorts low-streak first
// so kids practise the verbs they keep missing. Persists per-verb streaks
// in localStorage so the deck remembers progress across visits.
export function IrregularVerbDeck({
  unlockedBy,
  title,
}: {
  unlockedBy: string;
  title?: string;
}) {
  const allUnlocked = useMemo(() => verbsUnlockedBy(unlockedBy), [unlockedBy]);

  const [stats, setStats] = useState<AllStats>({});
  const [hydrated, setHydrated] = useState(false);
  const [order, setOrder] = useState<IrregularVerb[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<"practice" | "list">("practice");

  useEffect(() => {
    const loaded = loadStats();
    setStats(loaded);
    setOrder(buildOrder(allUnlocked, loaded));
    setHydrated(true);
  }, [allUnlocked]);

  const total = allUnlocked.length;
  const masteredCount = useMemo(
    () =>
      allUnlocked.filter((v) => (stats[v.base]?.streak ?? 0) >= MASTERED_AT)
        .length,
    [allUnlocked, stats],
  );

  const verb = order[index];
  const finished = hydrated && index >= order.length;

  function record(correct: boolean) {
    if (!verb) return;
    const today = new Date().toISOString().slice(0, 10);
    const prev = stats[verb.base]?.streak ?? 0;
    const next: VerbStats = {
      streak: correct ? prev + 1 : 0,
      seen: today,
    };
    const merged = { ...stats, [verb.base]: next };
    setStats(merged);
    saveStats(merged);
    setRevealed(false);
    setIndex((i) => i + 1);
  }

  function restart() {
    setOrder(buildOrder(allUnlocked, stats));
    setIndex(0);
    setRevealed(false);
  }

  if (!hydrated) {
    return (
      <div className="not-prose my-6 rounded-2xl border-2 border-purple-200 bg-purple-50 p-5 text-sm text-slate-500">
        Loading your verb deck…
      </div>
    );
  }

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 via-fuchsia-50 to-rose-50 p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
          {title ?? "Your irregular-verb deck"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-purple-700">
            ⭐ {masteredCount} / {total} mastered
          </span>
          <button
            type="button"
            onClick={() =>
              setMode((m) => (m === "practice" ? "list" : "practice"))
            }
            className="rounded-full border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50"
          >
            {mode === "practice" ? "Show all →" : "← Practice"}
          </button>
        </div>
      </div>

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-purple-400 to-fuchsia-500 transition-all"
          style={{
            width: `${total === 0 ? 0 : Math.round((masteredCount / total) * 100)}%`,
          }}
        />
      </div>

      {mode === "list" ? (
        <VerbTable verbs={allUnlocked} stats={stats} />
      ) : finished ? (
        <FinishedCard
          masteredCount={masteredCount}
          total={total}
          onRestart={restart}
        />
      ) : verb ? (
        <Card
          verb={verb}
          revealed={revealed}
          streak={stats[verb.base]?.streak ?? 0}
          index={index}
          length={order.length}
          onReveal={() => setRevealed(true)}
          onCorrect={() => record(true)}
          onWrong={() => record(false)}
        />
      ) : null}
    </div>
  );
}

function VerbTable({
  verbs,
  stats,
}: {
  verbs: IrregularVerb[];
  stats: AllStats;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-purple-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-purple-50">
          <tr className="text-xs font-bold uppercase tracking-wider text-purple-700">
            <th className="px-3 py-2 text-left">Base</th>
            <th className="px-3 py-2 text-left">Past</th>
            <th className="px-3 py-2 text-left">Past participle</th>
            <th className="px-3 py-2 text-right">Streak</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-purple-100">
          {verbs.map((v) => {
            const streak = stats[v.base]?.streak ?? 0;
            const mastered = streak >= MASTERED_AT;
            return (
              <tr key={v.base} className="hover:bg-purple-50/40">
                <td className="px-3 py-2 font-medium text-slate-900">
                  <span className="inline-flex items-center gap-1.5">
                    {v.base}
                    <button
                      type="button"
                      onClick={() =>
                        speak(`${v.base}, ${v.past}, ${v.participle}`)
                      }
                      aria-label={`Pronounce ${v.base}, ${v.past}, ${v.participle}`}
                      className="rounded-full p-0.5 text-purple-500 hover:bg-purple-100 hover:text-purple-700"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{v.past}</td>
                <td className="px-3 py-2 text-slate-700">{v.participle}</td>
                <td className="px-3 py-2 text-right text-xs">
                  {mastered ? (
                    <span className="font-medium text-emerald-600">
                      ⭐ mastered
                    </span>
                  ) : streak > 0 ? (
                    <span className="text-purple-600">
                      {"⭐".repeat(streak)}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Card({
  verb,
  revealed,
  streak,
  index,
  length,
  onReveal,
  onCorrect,
  onWrong,
}: {
  verb: IrregularVerb;
  revealed: boolean;
  streak: number;
  index: number;
  length: number;
  onReveal: () => void;
  onCorrect: () => void;
  onWrong: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>
          Card {index + 1} / {length}
        </span>
        <span className="rounded-full bg-white px-2 py-0.5">
          streak: {"⭐".repeat(Math.min(streak, MASTERED_AT))}
          {streak === 0 ? "—" : ""}
        </span>
      </div>

      <div className="rounded-xl border-2 border-purple-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-purple-600">
          base form
        </p>
        <p className="mt-1 flex items-center justify-center gap-2 text-3xl font-bold text-slate-900 sm:text-4xl">
          {verb.base}
          <button
            type="button"
            onClick={() => speak(verb.base)}
            aria-label={`Pronounce ${verb.base}`}
            className="rounded-full border border-purple-200 bg-purple-50 p-1.5 text-purple-700 hover:bg-purple-100"
          >
            <Volume2 className="h-4 w-4" />
          </button>
        </p>

        {revealed ? (
          <>
            <div className="mt-5 flex items-center justify-center gap-3 text-xl font-semibold text-slate-700 sm:text-2xl">
              <span className="text-slate-400">{verb.base}</span>
              <ArrowRight className="h-4 w-4 text-purple-400" />
              <span className="text-slate-900">{verb.past}</span>
              <ArrowRight className="h-4 w-4 text-purple-400" />
              <span className="text-slate-900">{verb.participle}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              base · past simple · past participle
            </p>
            <button
              type="button"
              onClick={() => speak(`${verb.base}, ${verb.past}, ${verb.participle}`)}
              className="mt-3 inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
            >
              <Volume2 className="h-3.5 w-3.5" /> Say all three
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            className="mt-5 rounded-full border-2 border-purple-500 bg-purple-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-600"
          >
            Show past + participle
          </button>
        )}
      </div>

      {revealed ? (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onWrong}
            className="rounded-full border-2 border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            Need practice
          </button>
          <button
            type="button"
            onClick={onCorrect}
            className="rounded-full border-2 border-emerald-300 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
          >
            Got it ✓
          </button>
        </div>
      ) : null}
    </>
  );
}

function FinishedCard({
  masteredCount,
  total,
  onRestart,
}: {
  masteredCount: number;
  total: number;
  onRestart: () => void;
}) {
  const allMastered = masteredCount === total;
  return (
    <div className="rounded-xl border-2 border-purple-200 bg-white p-6 text-center shadow-sm">
      <p className="text-2xl font-bold text-purple-800">
        {allMastered ? "All verbs mastered! 🎉" : "Nice round!"}
      </p>
      <p className="mt-2 text-sm text-slate-600">
        You&apos;ve mastered <strong>{masteredCount}</strong> out of{" "}
        <strong>{total}</strong> verbs so far. Come back tomorrow to keep the
        streaks alive.
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border-2 border-purple-500 bg-purple-500 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-600"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Run another pass
      </button>
    </div>
  );
}

// Lowest streak first → that's where practice matters most. Within a
// streak group, oldest-seen verbs come first so we resurface stale ones.
// Verbs the kid has never seen sort right after streak 0.
function buildOrder(
  verbs: IrregularVerb[],
  stats: AllStats,
): IrregularVerb[] {
  return [...verbs].sort((a, b) => {
    const sa = stats[a.base]?.streak ?? 0;
    const sb = stats[b.base]?.streak ?? 0;
    if (sa !== sb) return sa - sb;
    const seenA = stats[a.base]?.seen ?? "";
    const seenB = stats[b.base]?.seen ?? "";
    return seenA.localeCompare(seenB);
  });
}
