"use client";

import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  CONTRACTION_STAGES,
  SegmentChar,
  type Segment,
} from "./contraction";

export interface ContractionGridItem {
  segments: Segment[];
  // Plain-text labels shown under the animation. `long` is the full form
  // ("what is"), `short` is the contracted form ("what's"); `example` is
  // a sample sentence using the short form.
  long: string;
  short: string;
  example?: string;
}

const STAGE_MS = [1700, 1100, 900, 2200];

// Compact tiled version of <Contraction>. A single shared title and
// replay button frame a grid of mini animations — useful when a lesson
// wants to show many contractions of the same family side by side
// (e.g. what's / where's / who's / how's). Cells share one timer, so
// they all shrink in lockstep.
export function ContractionGrid({
  items,
  title = "Watch them shrink together",
}: {
  items: ContractionGridItem[];
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!inView) return;
    setStarted(true);
  }, [inView]);

  useEffect(() => {
    if (!started) return;
    const t = setTimeout(
      () => setStage((s) => (s + 1) % CONTRACTION_STAGES),
      STAGE_MS[stage],
    );
    return () => clearTimeout(t);
  }, [stage, started, runId]);

  function replay() {
    setStage(0);
    setRunId((n) => n + 1);
    setStarted(true);
  }

  return (
    <div
      ref={ref}
      className="not-prose my-6 overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
          {title}
        </span>
        <button
          type="button"
          onClick={replay}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-900"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item, i) => (
          <Cell key={i} item={item} stage={started ? stage : 0} />
        ))}
      </div>
    </div>
  );
}

function Cell({ item, stage }: { item: ContractionGridItem; stage: number }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white/70 p-3 shadow-sm">
      <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-amber-700">
        {item.long} → {item.short}
      </p>
      <motion.div
        layout
        className="flex min-h-[3.25rem] items-baseline justify-center text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl"
      >
        {item.segments.map((seg, i) => (
          <SegmentChar key={i} segment={seg} stage={stage} />
        ))}
      </motion.div>
      {item.example ? (
        <p className="mt-1 text-center text-xs italic text-slate-500">
          “{item.example}”
        </p>
      ) : null}
    </div>
  );
}
