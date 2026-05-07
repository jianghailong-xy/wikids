"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type LessonStarSummary,
  onScoreChange,
  summarizeLesson,
} from "@/lib/lesson-stars";

const ENCOURAGEMENT: Record<0 | 1 | 2 | 3, string> = {
  0: "Have a go at the quizzes to earn your first star!",
  1: "One star earned — keep going for two!",
  2: "Two stars! Aim for a near-perfect run for the third.",
  3: "Three stars — total mastery! 🎉",
};

// Lives next to the lesson title. Reads the kid's local quiz scores for
// this lesson and shows 0–3 stars + a one-line encouragement, refreshing
// instantly when a Quiz on the page is submitted.
export function LessonStars({
  textbookSlug,
  lessonSlug,
}: {
  textbookSlug: string;
  lessonSlug: string;
}) {
  const [summary, setSummary] = useState<LessonStarSummary | null>(null);

  useEffect(() => {
    const refresh = () => setSummary(summarizeLesson(textbookSlug, lessonSlug));
    refresh();
    return onScoreChange(refresh);
  }, [textbookSlug, lessonSlug]);

  // Don't render anything until we've checked localStorage on the client —
  // avoids a flash of empty stars during SSR/hydration.
  if (!summary) return null;
  if (summary.quizCount === 0) return null;

  return (
    <div
      aria-label={`${summary.stars} of 3 stars`}
      className="not-prose mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm shadow-sm"
    >
      <span className="flex">
        {[0, 1, 2].map((i) => (
          <Star
            key={i}
            className={cn(
              "h-4 w-4",
              i < summary.stars
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-amber-300",
            )}
          />
        ))}
      </span>
      <span className="text-xs font-medium text-amber-900">
        {summary.earned} / {summary.outOf} ·{" "}
        <span className="text-amber-700">{ENCOURAGEMENT[summary.stars]}</span>
      </span>
    </div>
  );
}
