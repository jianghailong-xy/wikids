"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

interface SubjectSpec {
  subject: string;
  verb: "am" | "is" | "are";
  color: string;
}

const SUBJECTS: SubjectSpec[] = [
  { subject: "I", verb: "am", color: "#e11d48" },
  { subject: "He", verb: "is", color: "#0284c7" },
  { subject: "She", verb: "is", color: "#0284c7" },
  { subject: "It", verb: "is", color: "#0284c7" },
  { subject: "We", verb: "are", color: "#059669" },
  { subject: "You", verb: "are", color: "#059669" },
  { subject: "They", verb: "are", color: "#059669" },
];

// Auto-cycles through every subject pronoun and shows the verb of "to be"
// updating to match. The subject and verb cross-fade together so the
// learner sees the cause-and-effect: change the subject, the verb has
// to change too.
export function Conjugation({
  ending = "happy.",
  intervalMs = 1900,
}: {
  ending?: string;
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const current = SUBJECTS[index];

  useEffect(() => {
    const t = setTimeout(
      () => setIndex((i) => (i + 1) % SUBJECTS.length),
      intervalMs,
    );
    return () => clearTimeout(t);
  }, [index, intervalMs]);

  return (
    <div className="not-prose my-6 rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-5 shadow-sm">
      <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-indigo-700">
        Change the subject — the verb changes too
      </p>

      <div className="flex min-h-[5rem] flex-wrap items-baseline justify-center gap-x-2 text-3xl font-bold sm:text-4xl">
        <AnimatePresence mode="wait">
          <motion.span
            key={`s-${index}`}
            initial={{ opacity: 0, y: 16, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1, color: current.color }}
            exit={{ opacity: 0, y: -16, scale: 0.7 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="inline-block"
          >
            {current.subject}
          </motion.span>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.span
            key={`v-${current.verb}-${index}`}
            initial={{ opacity: 0, y: -20, scale: 0.5 }}
            animate={{ opacity: 1, y: 0, scale: 1, color: current.color }}
            exit={{ opacity: 0, y: 20, scale: 0.5 }}
            transition={{
              type: "spring",
              stiffness: 240,
              damping: 18,
              delay: 0.08,
            }}
            className="inline-block underline decoration-dotted underline-offset-4"
          >
            {current.verb}
          </motion.span>
        </AnimatePresence>

        <span className="inline-block text-slate-700">{ending}</span>
      </div>

      <div className="mt-4 flex justify-center gap-1.5">
        {SUBJECTS.map((s, i) => (
          <button
            key={s.subject}
            type="button"
            aria-label={`Show ${s.subject}`}
            onClick={() => setIndex(i)}
            className="h-2 w-2 rounded-full transition"
            style={{
              backgroundColor: i === index ? s.color : "#cbd5e1",
              transform: i === index ? "scale(1.4)" : "scale(1)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
