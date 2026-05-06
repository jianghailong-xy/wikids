"use client";

import { useMemo, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MatchPair {
  id: string;
  left: string;
  right: string;
}

interface DragState {
  rightId: string;
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Drag a chip from the right column onto its matching left item. Uses
// Pointer Events so it works the same with mouse, pen, and touch. On
// submit, posts the result to /api/quiz so signed-in users see the
// attempt in their history.
export function Match({
  id,
  pairs,
  title = "Match the pairs",
  textbookSlug,
  lessonSlug,
}: {
  id: string;
  pairs: MatchPair[];
  title?: string;
  textbookSlug?: string;
  lessonSlug?: string;
}) {
  // The right column is rendered in a stable shuffled order; the left
  // column keeps its declaration order.
  const shuffledRights = useMemo(() => shuffle(pairs.map((p) => p.id)), [pairs]);
  // Map from leftId -> rightId
  const [pairings, setPairings] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverLeftId, setHoverLeftId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const allPaired = Object.keys(pairings).length === pairs.length;
  const score = pairs.reduce(
    (acc, p) => acc + (pairings[p.id] === p.id ? 1 : 0),
    0,
  );
  const total = pairs.length;

  const usedRights = new Set(Object.values(pairings));

  function findLeftIdAt(x: number, y: number): string | null {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const closest = (el as HTMLElement).closest?.("[data-left-id]");
      if (closest) return closest.getAttribute("data-left-id");
    }
    return null;
  }

  function startDrag(rightId: string) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      if (submitted) return;
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        rightId,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height,
      });
    };
  }

  function onMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
    setHoverLeftId(findLeftIdAt(e.clientX, e.clientY));
  }

  function onUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const leftId = findLeftIdAt(e.clientX, e.clientY);
    if (leftId) {
      setPairings((prev) => {
        const next: Record<string, string> = {};
        // Drop any previous pairings that used the same right or left.
        for (const [l, r] of Object.entries(prev)) {
          if (l !== leftId && r !== drag.rightId) next[l] = r;
        }
        next[leftId] = drag.rightId;
        return next;
      });
    }
    setDrag(null);
    setHoverLeftId(null);
  }

  function reset() {
    setPairings({});
    setSubmitted(false);
  }

  async function submit() {
    setSubmitted(true);
    if (!textbookSlug || !lessonSlug) return;
    setSaving(true);
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quizId: id,
          textbookSlug,
          lessonSlug,
          answers: pairings,
          score,
          totalQuestions: total,
        }),
      });
    } catch {
      // Best-effort save; user is signed out or offline.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="not-prose my-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-600">
        {title}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <ul className="space-y-2">
          {pairs.map((p) => {
            const pairedRight = pairings[p.id];
            const right = pairedRight
              ? pairs.find((pp) => pp.id === pairedRight)?.right
              : null;
            const isCorrect = submitted && pairedRight === p.id;
            const isWrong = submitted && pairedRight && pairedRight !== p.id;
            const isHover = hoverLeftId === p.id;
            return (
              <li
                key={p.id}
                data-left-id={p.id}
                className={cn(
                  "flex min-h-[3rem] items-center justify-between gap-3 rounded-lg border-2 border-dashed px-3 py-2 transition",
                  "border-slate-300 bg-slate-50",
                  pairedRight && "border-solid",
                  isHover && "border-brand-500 bg-brand-50",
                  isCorrect && "border-emerald-500 bg-emerald-50",
                  isWrong && "border-rose-500 bg-rose-50",
                )}
              >
                <span className="font-medium text-slate-900">{p.left}</span>
                {right ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (submitted) return;
                      setPairings((prev) => {
                        const next = { ...prev };
                        delete next[p.id];
                        return next;
                      });
                    }}
                    className={cn(
                      "rounded-md bg-white px-2.5 py-1 text-sm shadow-sm",
                      "border border-slate-200 hover:border-rose-300",
                      isCorrect && "border-emerald-500",
                      isWrong && "border-rose-500",
                    )}
                  >
                    {right}
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">drop here</span>
                )}
              </li>
            );
          })}
        </ul>

        <ul className="space-y-2">
          {shuffledRights.map((rightId) => {
            const p = pairs.find((pp) => pp.id === rightId)!;
            const used = usedRights.has(rightId);
            const isDragging = drag?.rightId === rightId;
            return (
              <li key={rightId} className="flex justify-end">
                <button
                  type="button"
                  data-right-id={rightId}
                  onPointerDown={startDrag(rightId)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  disabled={used || submitted}
                  className={cn(
                    "min-w-[6rem] cursor-grab touch-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition",
                    "hover:border-brand-400 active:cursor-grabbing",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    isDragging && "opacity-30",
                  )}
                >
                  {p.right}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <RefreshCw className="h-4 w-4" /> Reset
        </button>
        <div className="flex items-center gap-3">
          {submitted ? (
            <p className="text-sm text-slate-700">
              Score: <span className="font-semibold">{score}</span> / {total}
              {saving ? " · saving…" : ""}
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={!allPaired || submitted}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {submitted ? "Submitted" : "Check"}
          </button>
        </div>
      </div>

      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex items-center justify-center rounded-md border border-brand-400 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-lg"
          style={{
            left: drag.x - drag.width / 2,
            top: drag.y - drag.height / 2,
            width: drag.width,
            height: drag.height,
          }}
        >
          {pairs.find((p) => p.id === drag.rightId)?.right}
        </div>
      ) : null}
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
