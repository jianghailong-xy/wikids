"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Character {
  id: string;
  name: string;
  emoji: string;
  flag: string;
  age: number;
  job: string;
  married: boolean;
  region: "Europe" | "Asia" | "Africa" | "Americas";
  isStudent: boolean;
  isCreative: boolean;
  isDoctor: boolean;
}

interface Question {
  id: string;
  text: string;
  test: (c: Character) => boolean;
}

const CHARACTERS: Character[] = [
  {
    id: "maria",
    name: "Maria",
    emoji: "👩🏻‍🎨",
    flag: "🇮🇹",
    age: 27,
    job: "designer",
    married: true,
    region: "Europe",
    isStudent: false,
    isCreative: true,
    isDoctor: false,
  },
  {
    id: "tom",
    name: "Tom",
    emoji: "👨🏻‍💼",
    flag: "🇬🇧",
    age: 30,
    job: "lawyer",
    married: false,
    region: "Europe",
    isStudent: false,
    isCreative: false,
    isDoctor: false,
  },
  {
    id: "akiko",
    name: "Akiko",
    emoji: "👩🏻‍🎓",
    flag: "🇯🇵",
    age: 22,
    job: "student",
    married: false,
    region: "Asia",
    isStudent: true,
    isCreative: false,
    isDoctor: false,
  },
  {
    id: "pierre",
    name: "Pierre",
    emoji: "👨🏼‍⚕️",
    flag: "🇫🇷",
    age: 45,
    job: "doctor",
    married: true,
    region: "Europe",
    isStudent: false,
    isCreative: false,
    isDoctor: true,
  },
  {
    id: "sara",
    name: "Sara",
    emoji: "👩🏽‍🎓",
    flag: "🇪🇸",
    age: 19,
    job: "student",
    married: false,
    region: "Europe",
    isStudent: true,
    isCreative: false,
    isDoctor: false,
  },
  {
    id: "kwame",
    name: "Kwame",
    emoji: "👨🏾‍🏫",
    flag: "🇬🇭",
    age: 35,
    job: "teacher",
    married: true,
    region: "Africa",
    isStudent: false,
    isCreative: false,
    isDoctor: false,
  },
];

const QUESTIONS: Question[] = [
  { id: "student", text: "Are you a student?", test: (c) => c.isStudent },
  { id: "married", text: "Are you married?", test: (c) => c.married },
  { id: "european", text: "Are you European?", test: (c) => c.region === "Europe" },
  { id: "asian", text: "Are you from Asia?", test: (c) => c.region === "Asia" },
  { id: "under25", text: "Are you under 25?", test: (c) => c.age < 25 },
  { id: "over40", text: "Are you over 40?", test: (c) => c.age > 40 },
  { id: "creative", text: "Is your job creative?", test: (c) => c.isCreative },
  { id: "doctor", text: "Are you a doctor?", test: (c) => c.isDoctor },
];

interface Asked {
  questionId: string;
  answer: boolean;
}

// Yes/No reasoning game inspired by the classic "Guess Who?" board game.
// A random character is chosen as the mystery; the learner asks be-questions
// from a fixed pool, and each Yes/No reply automatically dims characters
// that don't match. Pure practice for am/is/are questions in the wild.
export function MysteryPerson({
  textbookSlug,
  lessonSlug,
  id = "mystery-person",
}: {
  textbookSlug?: string;
  lessonSlug?: string;
  id?: string;
}) {
  const [seed, setSeed] = useState(0);
  const mystery = useMemo(
    () => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed],
  );
  const [asked, setAsked] = useState<Asked[]>([]);
  const [guess, setGuess] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const eliminated = useMemo(() => {
    const out = new Set<string>();
    for (const c of CHARACTERS) {
      for (const a of asked) {
        const q = QUESTIONS.find((q) => q.id === a.questionId)!;
        if (q.test(c) !== a.answer) {
          out.add(c.id);
          break;
        }
      }
    }
    return out;
  }, [asked]);

  const remaining = CHARACTERS.filter((c) => !eliminated.has(c.id));
  const ended = guess !== null;
  const won = guess === mystery.id;

  function ask(q: Question) {
    if (ended) return;
    if (asked.some((a) => a.questionId === q.id)) return;
    setAsked((prev) => [...prev, { questionId: q.id, answer: q.test(mystery) }]);
  }

  async function makeGuess(charId: string) {
    if (ended) return;
    setGuess(charId);
    if (!textbookSlug || !lessonSlug || saved) return;
    setSaved(true);
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quizId: id,
          textbookSlug,
          lessonSlug,
          answers: { asked, guess: charId, mystery: mystery.id },
          score: charId === mystery.id ? 1 : 0,
          totalQuestions: 1,
        }),
      });
    } catch {
      // best-effort
    }
  }

  function reset() {
    setAsked([]);
    setGuess(null);
    setSaved(false);
    setSeed((s) => s + 1);
  }

  return (
    <div className="not-prose my-8 overflow-hidden rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-violet-700">
            Mystery person
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            One of these six is hiding. Ask <strong>be</strong>-questions, then
            tap who you think it is.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-violet-400"
        >
          <RefreshCw className="h-3.5 w-3.5" /> New game
        </button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {CHARACTERS.map((c) => {
          const isOut = eliminated.has(c.id) && !ended;
          const isGuessed = guess === c.id;
          const isMystery = ended && c.id === mystery.id;
          return (
            <motion.button
              key={c.id}
              type="button"
              layout
              onClick={() => makeGuess(c.id)}
              disabled={ended || isOut}
              whileTap={!ended && !isOut ? { scale: 0.95 } : undefined}
              animate={{
                opacity: isOut ? 0.25 : 1,
                scale: isMystery && won ? [1, 1.15, 1] : 1,
              }}
              transition={{ duration: 0.4 }}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-xl border-2 bg-white px-2 py-3 shadow-sm transition",
                "border-slate-200",
                !ended && !isOut && "hover:border-violet-400 hover:shadow",
                isMystery && won && "border-emerald-500 bg-emerald-50",
                isMystery && !won && "border-emerald-500 bg-emerald-50",
                isGuessed && !won && "border-rose-500 bg-rose-50",
              )}
            >
              <span aria-hidden className="text-3xl">
                {c.emoji}
              </span>
              <span className="text-xs font-semibold text-slate-800">
                {c.name} {c.flag}
              </span>
              {isOut ? (
                <span className="absolute right-1 top-1 rounded-full bg-rose-500 p-0.5 text-white">
                  <X className="h-3 w-3" />
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {ended ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "mb-4 rounded-xl border-2 px-4 py-3 text-center",
              won
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-rose-300 bg-rose-50 text-rose-900",
            )}
          >
            {won ? (
              <p className="flex items-center justify-center gap-2 font-semibold">
                <Sparkles className="h-5 w-5" /> Got it! It was {mystery.name}.
              </p>
            ) : (
              <p className="font-semibold">
                Not quite. The mystery person was {mystery.name} {mystery.flag}{" "}
                — a {mystery.age}-year-old {mystery.job}
                {mystery.married ? "" : " (single)"}.
              </p>
            )}
            <p className="mt-1 text-xs text-slate-600">
              Asked {asked.length} {asked.length === 1 ? "question" : "questions"}.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <HelpCircle className="h-4 w-4" /> Pick a question
      </p>
      <ul className="space-y-1.5">
        {QUESTIONS.map((q) => {
          const a = asked.find((a) => a.questionId === q.id);
          const wasAsked = !!a;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => ask(q)}
                disabled={wasAsked || ended}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-sm transition",
                  "border-slate-200",
                  !wasAsked && !ended && "hover:border-violet-400",
                  wasAsked && a.answer && "border-emerald-300 bg-emerald-50",
                  wasAsked && !a.answer && "border-rose-300 bg-rose-50",
                  ended && !wasAsked && "opacity-50",
                )}
              >
                <span className="font-medium text-slate-800">{q.text}</span>
                {wasAsked ? (
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-bold uppercase",
                      a.answer
                        ? "bg-emerald-600 text-white"
                        : "bg-rose-600 text-white",
                    )}
                  >
                    {a.answer ? "Yes" : "No"}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        {remaining.length} {remaining.length === 1 ? "person" : "people"} left.
        {!ended && asked.length === 0
          ? " Ask a question to start narrowing it down."
          : null}
      </p>
    </div>
  );
}
