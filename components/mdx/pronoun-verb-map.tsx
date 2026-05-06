"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

interface RowSpec {
  pronouns: string[];
  verb: string;
  example: string;
  palette: {
    chip: string;
    chipText: string;
    arrow: string;
    verb: string;
    verbBg: string;
  };
}

const ROWS: RowSpec[] = [
  {
    pronouns: ["I"],
    verb: "am",
    example: "I am happy.",
    palette: {
      chip: "bg-rose-100",
      chipText: "text-rose-800",
      arrow: "#e11d48",
      verb: "text-rose-700",
      verbBg: "bg-rose-50 ring-rose-300",
    },
  },
  {
    pronouns: ["he", "she", "it"],
    verb: "is",
    example: "She is my friend.",
    palette: {
      chip: "bg-sky-100",
      chipText: "text-sky-800",
      arrow: "#0284c7",
      verb: "text-sky-700",
      verbBg: "bg-sky-50 ring-sky-300",
    },
  },
  {
    pronouns: ["we", "you", "they"],
    verb: "are",
    example: "They are at school.",
    palette: {
      chip: "bg-emerald-100",
      chipText: "text-emerald-800",
      arrow: "#059669",
      verb: "text-emerald-700",
      verbBg: "bg-emerald-50 ring-emerald-300",
    },
  },
];

// Visual map of subject → be-verb. Each row shows the pronoun chips
// landing one by one, then a colored arrow draws across to the matching
// verb, then the verb pops in. The three rows are color-coded so the
// learner sees at a glance which pronouns share a verb.
export function PronounVerbMap() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <div
      ref={ref}
      className="not-prose my-6 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="mb-4 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
        The big rule — who uses which verb
      </p>

      <div className="space-y-5">
        {ROWS.map((row, rowIndex) => (
          <Row
            key={row.verb}
            row={row}
            rowIndex={rowIndex}
            inView={inView}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  rowIndex,
  inView,
}: {
  row: RowSpec;
  rowIndex: number;
  inView: boolean;
}) {
  const baseDelay = 0.2 + rowIndex * 1.2;
  const arrowDelay = baseDelay + row.pronouns.length * 0.18 + 0.1;
  const verbDelay = arrowDelay + 0.55;
  const exampleDelay = verbDelay + 0.4;

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 sm:gap-5">
      <div className="flex flex-wrap justify-end gap-2">
        {row.pronouns.map((p, i) => (
          <motion.span
            key={p}
            initial={{ opacity: 0, x: -24, scale: 0.7 }}
            animate={inView ? { opacity: 1, x: 0, scale: 1 } : {}}
            transition={{
              delay: baseDelay + i * 0.18,
              type: "spring",
              stiffness: 240,
              damping: 22,
            }}
            className={`rounded-full px-3 py-1 text-base font-semibold ${row.palette.chip} ${row.palette.chipText}`}
          >
            {p}
          </motion.span>
        ))}
      </div>

      <svg
        width="64"
        height="28"
        viewBox="0 0 64 28"
        className="overflow-visible"
        aria-hidden
      >
        <motion.path
          d="M 4 14 L 50 14"
          stroke={row.palette.arrow}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={inView ? { pathLength: 1 } : {}}
          transition={{ delay: arrowDelay, duration: 0.5, ease: "easeOut" }}
        />
        <motion.path
          d="M 44 6 L 56 14 L 44 22"
          stroke={row.palette.arrow}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={inView ? { pathLength: 1 } : {}}
          transition={{ delay: arrowDelay + 0.4, duration: 0.25 }}
        />
      </svg>

      <motion.div
        initial={{ opacity: 0, scale: 0.4 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{
          delay: verbDelay,
          type: "spring",
          stiffness: 260,
          damping: 16,
        }}
        className={`rounded-xl px-4 py-2 text-2xl font-bold ring-2 ${row.palette.verb} ${row.palette.verbBg}`}
      >
        {row.verb}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ delay: exampleDelay, duration: 0.4 }}
        className="col-span-3 -mt-1 text-right text-sm italic text-slate-500"
      >
        e.g. {row.example}
      </motion.p>
    </div>
  );
}
