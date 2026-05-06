"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

// One character's role in a contraction.
//   keep — the character stays unchanged
//   drop — the character disappears (e.g. the space in "I am")
//   swap — the character morphs into another (e.g. "a" → "'")
export type Segment =
  | { keep: string }
  | { drop: string }
  | { swap: string; to: string };

// Stages: 0 idle full form, 1 highlight changes, 2 transform, 3 hold short form.
const STAGE_MS = [1700, 1100, 900, 2200];

// Animated visualization of an English contraction. Walks the learner from
// the long form ("I am") to the short form ("I'm") character by character:
// 1) shows the full form, 2) flashes the parts that will change in red,
// 3) drops the spare characters and morphs the apostrophe in, 4) lets the
// remaining letters slide together via layout animation, then loops.
export function Contraction({
  segments,
  caption,
}: {
  segments: Segment[];
  caption?: string;
}) {
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const t = setTimeout(
      () => setStage((s) => (s + 1) % STAGE_MS.length),
      STAGE_MS[stage],
    );
    return () => clearTimeout(t);
  }, [stage, runId]);

  function replay() {
    setStage(0);
    setRunId((n) => n + 1);
  }

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Watch the words shrink
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
        className="flex min-h-[5rem] items-baseline justify-center text-4xl font-bold tracking-tight text-slate-800 sm:text-5xl"
      >
        {segments.map((seg, i) => (
          <SegmentChar key={i} segment={seg} stage={stage} />
        ))}
      </motion.div>

      {caption ? (
        <p className="mt-2 text-center text-sm text-slate-600">{caption}</p>
      ) : null}
    </div>
  );
}

function SegmentChar({ segment, stage }: { segment: Segment; stage: number }) {
  if ("keep" in segment) {
    return (
      <motion.span layout style={{ whiteSpace: "pre", display: "inline-block" }}>
        {segment.keep}
      </motion.span>
    );
  }

  if ("drop" in segment) {
    const visible = stage < 2;
    return (
      <AnimatePresence mode="popLayout" initial={false}>
        {visible ? (
          <motion.span
            key="drop"
            layout
            animate={{
              color: stage === 1 ? "#dc2626" : "#1e293b",
              scale: stage === 1 ? 1.35 : 1,
              y: stage === 1 ? -6 : 0,
            }}
            exit={{ opacity: 0, scale: 0.2, y: -36 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            style={{ whiteSpace: "pre", display: "inline-block" }}
          >
            {segment.drop === " " ? " " : segment.drop}
          </motion.span>
        ) : null}
      </AnimatePresence>
    );
  }

  // swap
  const showFrom = stage < 2;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {showFrom ? (
        <motion.span
          key="from"
          layout
          animate={{
            color: stage === 1 ? "#dc2626" : "#1e293b",
            scale: stage === 1 ? 1.35 : 1,
            y: stage === 1 ? -6 : 0,
          }}
          exit={{ opacity: 0, scale: 0.3 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          style={{ whiteSpace: "pre", display: "inline-block" }}
        >
          {segment.swap}
        </motion.span>
      ) : (
        <motion.span
          key="to"
          layout
          initial={{ opacity: 0, scale: 2.2, color: "#0284c7", rotate: -20 }}
          animate={{
            opacity: 1,
            scale: stage === 2 ? 1.4 : 1,
            color: stage === 3 ? "#0369a1" : "#0284c7",
            rotate: 0,
          }}
          transition={{ type: "spring", stiffness: 240, damping: 18 }}
          style={{ whiteSpace: "pre", display: "inline-block" }}
        >
          {segment.to}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
