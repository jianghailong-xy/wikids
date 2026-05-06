"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BuilderPuzzle {
  id: string;
  prompt?: string;
  // The sentence broken into the tokens the learner must order. Punctuation
  // can be its own token (e.g. ["Is", "your", "mother", "at", "home", "?"])
  // or merged into a word — author's choice.
  correctOrder: string[];
  hint?: string;
}

interface Token {
  id: string;
  word: string;
}

// Click-to-build word-order puzzle. Tokens sit in a shuffled pool; tapping
// one moves it to the next answer slot, tapping a slotted token sends it
// back. On Check, the slot row turns green or red word-by-word and the
// correct answer is revealed if wrong. Inspired by the question-building
// drills in Duolingo.
export function QuestionBuilder({
  id,
  prompts,
  textbookSlug,
  lessonSlug,
  title = "Build the question",
}: {
  id: string;
  prompts: BuilderPuzzle[];
  textbookSlug?: string;
  lessonSlug?: string;
  title?: string;
}) {
  const [current, setCurrent] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const puzzle = prompts[current];
  const total = prompts.length;

  // Stable shuffled token list per puzzle id. Different runs can reshuffle
  // because the seed is the puzzle id concatenated with a random nonce that
  // only changes when the component remounts — we want fresh order each
  // time the lesson loads but stable order while a user is solving.
  const tokens = useMemo<Token[]>(
    () =>
      shuffle(
        puzzle.correctOrder.map((word, i) => ({
          id: `${puzzle.id}-${i}`,
          word,
        })),
      ),
    [puzzle.id, puzzle.correctOrder],
  );

  const slotted = picked[puzzle.id] ?? [];
  const isChecked = puzzle.id in results;
  const isCorrect = results[puzzle.id];
  const usedIds = new Set(slotted);
  const slotsFull = slotted.length === puzzle.correctOrder.length;

  function pickToken(tokenId: string) {
    if (isChecked) return;
    if (usedIds.has(tokenId)) return;
    setPicked((prev) => ({
      ...prev,
      [puzzle.id]: [...slotted, tokenId],
    }));
  }

  function unpickAt(slotIdx: number) {
    if (isChecked) return;
    setPicked((prev) => ({
      ...prev,
      [puzzle.id]: slotted.filter((_, i) => i !== slotIdx),
    }));
  }

  function reset() {
    if (isChecked) return;
    setPicked((prev) => ({ ...prev, [puzzle.id]: [] }));
  }

  function check() {
    const guess = slotted.map((tid) => tokens.find((t) => t.id === tid)!.word);
    const ok = arraysEqual(guess, puzzle.correctOrder);
    setResults((prev) => ({ ...prev, [puzzle.id]: ok }));
  }

  async function next() {
    if (current < total - 1) {
      setCurrent(current + 1);
      return;
    }
    setDone(true);
    if (!textbookSlug || !lessonSlug) return;
    const score = Object.values(results).filter(Boolean).length;
    setSaving(true);
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quizId: id,
          textbookSlug,
          lessonSlug,
          answers: picked,
          score,
          totalQuestions: total,
        }),
      });
    } catch {
      // best-effort save
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    const score = Object.values(results).filter(Boolean).length;
    return (
      <div className="not-prose my-8 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 p-6 text-center shadow-sm">
        <Sparkles className="mx-auto h-10 w-10 text-emerald-500" />
        <p className="mt-3 text-2xl font-bold text-slate-900">
          {score} / {total} sentences built!
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {score === total
            ? "Perfect — every word in the right place."
            : score >= total - 1
            ? "Almost flawless. Take another lap if you like."
            : "Good effort. Tap Try again to keep practising."}
        </p>
        <button
          type="button"
          onClick={() => {
            setCurrent(0);
            setPicked({});
            setResults({});
            setDone(false);
          }}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-400"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        {saving ? (
          <p className="mt-2 text-xs text-slate-400">saving…</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="not-prose my-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          {title}
        </p>
        <p className="text-sm text-slate-500">
          {current + 1} / {total}
        </p>
      </div>

      {puzzle.prompt ? (
        <p className="mb-3 text-base text-slate-700">
          <span className="text-slate-400">Goal: </span>
          {puzzle.prompt}
        </p>
      ) : null}

      <div
        className={cn(
          "mb-3 flex min-h-[3.5rem] flex-wrap items-center gap-2 rounded-xl border-2 border-dashed p-3",
          !isChecked && "border-slate-300 bg-slate-50",
          isChecked && isCorrect && "border-emerald-400 bg-emerald-50",
          isChecked && !isCorrect && "border-rose-400 bg-rose-50",
        )}
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {slotted.length === 0 ? (
            <motion.span
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm italic text-slate-400"
            >
              Tap the words below to build your sentence…
            </motion.span>
          ) : (
            slotted.map((tid, i) => {
              const token = tokens.find((t) => t.id === tid)!;
              return (
                <motion.button
                  key={tid}
                  type="button"
                  layout
                  initial={{ opacity: 0, y: -10, scale: 0.7 }}
                  animate={{
                    opacity: 1,
                    y: isChecked && !isCorrect ? [0, -3, 3, -2, 2, 0] : 0,
                    scale: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ type: "spring", stiffness: 280, damping: 22 }}
                  onClick={() => unpickAt(i)}
                  disabled={isChecked}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-base font-medium shadow-sm transition",
                    !isChecked &&
                      "border-brand-300 bg-white text-slate-800 hover:border-rose-300",
                    isChecked &&
                      isCorrect &&
                      "border-emerald-400 bg-emerald-100 text-emerald-900",
                    isChecked &&
                      !isCorrect &&
                      "border-rose-400 bg-rose-100 text-rose-900",
                  )}
                >
                  {token.word}
                </motion.button>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {isChecked && !isCorrect ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Correct answer:{" "}
          <span className="font-semibold">
            {puzzle.correctOrder.join(" ")}
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tokens.map((t) => {
          const used = usedIds.has(t.id);
          return (
            <motion.button
              key={t.id}
              type="button"
              layout
              onClick={() => pickToken(t.id)}
              disabled={used || isChecked}
              whileTap={!used && !isChecked ? { scale: 0.92 } : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-base font-medium shadow-sm transition",
                "border-slate-300 bg-white text-slate-800",
                !used && !isChecked && "hover:border-brand-400",
                used && "opacity-30",
                isChecked && "cursor-default",
              )}
            >
              {t.word}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={reset}
          disabled={isChecked || slotted.length === 0}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40"
        >
          <RefreshCw className="h-4 w-4" /> Reset
        </button>
        {!isChecked ? (
          <button
            type="button"
            onClick={check}
            disabled={!slotsFull}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Check
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {current === total - 1 ? "Finish" : "Next"}
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
