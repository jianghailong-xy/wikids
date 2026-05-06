"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

// Animated visualization of the statement → question flip in English.
// Subject and verb are colored so the learner sees them swap places;
// the trailing words and the punctuation also morph (`.` → `?`).
//
// Cycles: 0 statement, 1 question, then loops back. Uses framer-motion
// `layout` so the chips physically slide past each other rather than
// re-rendering in place.
export function WordFlip({
  subject,
  verb,
  rest = "",
  caption,
  intervalMs = 2200,
}: {
  subject: string;
  verb: string;
  rest?: string;
  caption?: string;
  intervalMs?: number;
}) {
  const [isQuestion, setIsQuestion] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setIsQuestion((v) => !v), intervalMs);
    return () => clearTimeout(t);
  }, [isQuestion, intervalMs, runId]);

  function replay() {
    setIsQuestion(false);
    setRunId((n) => n + 1);
  }

  // Capitalize the first chip in either order so it reads naturally.
  const subjectDisplay = isQuestion ? subject.toLowerCase() : capitalize(subject);
  const verbDisplay = isQuestion ? capitalize(verb) : verb.toLowerCase();
  const punctuation = isQuestion ? "?" : ".";

  // Order of the layout chips changes between the two states.
  const order = isQuestion
    ? ["verb", "subject", "rest"]
    : ["subject", "verb", "rest"];

  const chips: Record<string, React.ReactNode> = {
    subject: (
      <motion.span
        layout
        layoutId="subject"
        className="inline-block rounded-lg bg-rose-100 px-2 py-0.5 text-rose-800"
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        {subjectDisplay}
      </motion.span>
    ),
    verb: (
      <motion.span
        layout
        layoutId="verb"
        className="inline-block rounded-lg bg-sky-100 px-2 py-0.5 text-sky-800"
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        {verbDisplay}
      </motion.span>
    ),
    rest: rest ? (
      <motion.span
        layout
        layoutId="rest"
        className="inline-block text-slate-700"
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        {rest}
      </motion.span>
    ) : null,
  };

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Watch the words flip
        </span>
        <button
          type="button"
          onClick={replay}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-900"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </div>

      <motion.div
        layout
        className="flex min-h-[5rem] flex-wrap items-baseline justify-center gap-x-2 gap-y-2 text-3xl font-bold tracking-tight sm:text-4xl"
      >
        {order.map((id) => (
          <span key={id}>{chips[id]}</span>
        ))}
        <motion.span
          key={punctuation}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 20 }}
          className={
            isQuestion ? "inline-block text-amber-600" : "inline-block text-slate-500"
          }
        >
          {punctuation}
        </motion.span>
      </motion.div>

      <div className="mt-3 flex justify-center gap-2 text-xs font-medium uppercase tracking-wider">
        <span className={isQuestion ? "text-slate-400" : "text-amber-700"}>
          statement
        </span>
        <span className="text-slate-300">·</span>
        <span className={isQuestion ? "text-amber-700" : "text-slate-400"}>
          question
        </span>
      </div>

      {caption ? (
        <p className="mt-2 text-center text-sm text-slate-600">{caption}</p>
      ) : null}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
