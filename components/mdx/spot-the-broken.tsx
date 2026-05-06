"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpotItem {
  id: string;
  text: string;
  isCorrect: boolean;
  fix?: string; // shown when the broken sentence is judged
}

type Verdict = "good" | "broken";

interface Judgement {
  verdict: Verdict;
  right: boolean;
}

// Mini-judging game: each sentence is either a well-formed question or
// has a broken word order. Learner taps ✓ or ✗ on each card. Used as a
// playful drill for the "don't break the sentence" rule from this
// lesson, but designed so any future lesson can plug in its own items.
export function SpotTheBroken({
  id,
  items,
  textbookSlug,
  lessonSlug,
  title = "Good question, or broken?",
}: {
  id: string;
  items: SpotItem[];
  textbookSlug?: string;
  lessonSlug?: string;
  title?: string;
}) {
  const [judgements, setJudgements] = useState<Record<string, Judgement>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const judgedCount = Object.keys(judgements).length;
  const allDone = judgedCount === items.length;
  const score = Object.values(judgements).filter((j) => j.right).length;

  function judge(item: SpotItem, verdict: Verdict) {
    if (item.id in judgements) return;
    const right =
      (verdict === "good" && item.isCorrect) ||
      (verdict === "broken" && !item.isCorrect);
    const next = { ...judgements, [item.id]: { verdict, right } };
    setJudgements(next);
    if (Object.keys(next).length === items.length) void save(next);
  }

  async function save(final: Record<string, Judgement>) {
    if (!textbookSlug || !lessonSlug || saved) return;
    setSaved(true);
    setSaving(true);
    const finalScore = Object.values(final).filter((j) => j.right).length;
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quizId: id,
          textbookSlug,
          lessonSlug,
          answers: final,
          score: finalScore,
          totalQuestions: items.length,
        }),
      });
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setJudgements({});
    setSaved(false);
  }

  return (
    <div className="not-prose my-8 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-rose-50 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-bold uppercase tracking-wider text-amber-700">
          {title}
        </p>
        <p className="text-xs text-slate-600">
          {judgedCount} / {items.length}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const j = judgements[item.id];
          const judged = !!j;
          return (
            <motion.div
              key={item.id}
              animate={
                judged && !j.right
                  ? { x: [0, -6, 6, -4, 4, 0] }
                  : { x: 0 }
              }
              transition={{ duration: 0.4 }}
              className={cn(
                "rounded-xl border-2 bg-white p-3 shadow-sm transition",
                !judged && "border-slate-200",
                judged && j.right && "border-emerald-400 bg-emerald-50",
                judged && !j.right && "border-rose-400 bg-rose-50",
              )}
            >
              <p className="text-base font-medium text-slate-800">
                &ldquo;{item.text}&rdquo;
              </p>

              {judged ? (
                <div className="mt-2 flex items-start gap-2 text-xs">
                  {j.right ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  )}
                  <p className="text-slate-700">
                    {item.isCorrect ? (
                      <>This is a <strong>good</strong> question.</>
                    ) : (
                      <>
                        Word order is <strong>broken</strong>.
                        {item.fix ? (
                          <>
                            {" "}Should be:{" "}
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                              {item.fix}
                            </span>
                          </>
                        ) : null}
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => judge(item, "good")}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <ThumbsUp className="h-4 w-4" /> Good
                  </button>
                  <button
                    type="button"
                    onClick={() => judge(item, "broken")}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <ThumbsDown className="h-4 w-4" /> Broken
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={reset}
          disabled={judgedCount === 0}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40"
        >
          <RefreshCw className="h-4 w-4" /> Reset
        </button>
        {allDone ? (
          <p className="text-sm text-slate-700">
            Score: <span className="font-semibold">{score}</span> /{" "}
            {items.length}
            {saving ? " · saving…" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
