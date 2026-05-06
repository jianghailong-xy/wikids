"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FlashcardSide {
  text?: string;
  emoji?: string;
  image?: string;
  caption?: string;
}

export function Flashcard({
  front,
  back,
  className,
}: {
  front: React.ReactNode | FlashcardSide;
  back: React.ReactNode | FlashcardSide;
  className?: string;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className={cn("not-prose my-6 inline-block w-full", className)}>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        className="group relative h-56 w-full max-w-md select-none [perspective:1000px]"
      >
        <div
          className="relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
        >
          <CardFace side="front">{renderSide(front)}</CardFace>
          <CardFace side="back">{renderSide(back)}</CardFace>
        </div>
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs font-medium text-slate-500 shadow-sm backdrop-blur">
          <RotateCw className="h-3 w-3" /> Flip
        </span>
      </button>
    </div>
  );
}

function CardFace({
  side,
  children,
}: {
  side: "front" | "back";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center rounded-2xl border bg-white p-6 shadow-md [backface-visibility:hidden]",
        side === "front"
          ? "border-brand-200 bg-gradient-to-br from-brand-50 to-white"
          : "border-amber-200 bg-gradient-to-br from-amber-50 to-white",
      )}
      style={side === "back" ? { transform: "rotateY(180deg)" } : undefined}
    >
      <div className="text-center">{children}</div>
    </div>
  );
}

function isFlashcardSide(side: unknown): side is FlashcardSide {
  return (
    !!side &&
    typeof side === "object" &&
    !Array.isArray(side) &&
    !("type" in (side as object)) &&
    ("text" in (side as object) ||
      "emoji" in (side as object) ||
      "image" in (side as object) ||
      "caption" in (side as object))
  );
}

function renderSide(side: React.ReactNode | FlashcardSide) {
  if (isFlashcardSide(side)) {
    return (
      <>
        {side.emoji ? (
          <div className="text-6xl" aria-hidden>
            {side.emoji}
          </div>
        ) : null}
        {side.image ? (
          <img src={side.image} alt="" className="mx-auto max-h-32" />
        ) : null}
        {side.text ? (
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {side.text}
          </div>
        ) : null}
        {side.caption ? (
          <div className="mt-1 text-sm text-slate-500">{side.caption}</div>
        ) : null}
      </>
    );
  }
  return (
    <div className="text-2xl font-semibold text-slate-900">
      {side as React.ReactNode}
    </div>
  );
}

export function FlashcardDeck({
  cards,
  title = "Flashcards",
}: {
  cards: { front: FlashcardSide | React.ReactNode; back: FlashcardSide | React.ReactNode }[];
  title?: string;
}) {
  const [index, setIndex] = useState(0);
  const [keyTick, setKeyTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset flip state on navigation by remounting the card
  useEffect(() => setKeyTick((t) => t + 1), [index]);

  function go(delta: number) {
    setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));
  }

  return (
    <div
      ref={containerRef}
      className="not-prose my-8 rounded-2xl border border-slate-200 bg-slate-50 p-5"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
      tabIndex={0}
      aria-label={title}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          {title}
        </p>
        <p className="text-sm text-slate-500">
          {index + 1} / {cards.length}
        </p>
      </div>
      <Flashcard
        key={keyTick}
        front={cards[index].front}
        back={cards[index].back}
      />
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400 disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === cards.length - 1}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400 disabled:opacity-50"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
