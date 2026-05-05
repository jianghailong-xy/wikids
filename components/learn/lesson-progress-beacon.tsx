"use client";

import { useEffect, useState } from "react";

export function LessonProgressBeacon({
  textbookSlug,
  lessonSlug,
}: {
  textbookSlug: string;
  lessonSlug: string;
}) {
  const [completed, setCompleted] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        textbookSlug,
        lessonSlug,
        status: "in_progress",
      }),
    });
  }, [textbookSlug, lessonSlug]);

  async function markComplete() {
    setPending(true);
    try {
      await fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          textbookSlug,
          lessonSlug,
          status: "completed",
        }),
      });
      setCompleted(true);
    } finally {
      setPending(false);
    }
  }

  async function toggleFavorite() {
    setPending(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ textbookSlug, lessonSlug }),
      });
      if (res.ok) {
        const data: { favorited: boolean } = await res.json();
        setFavorited(data.favorited);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-10 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={markComplete}
        disabled={pending || completed}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {completed ? "Completed ✓" : "Mark as complete"}
      </button>
      <button
        type="button"
        onClick={toggleFavorite}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {favorited ? "★ Favorited" : "☆ Favorite"}
      </button>
    </div>
  );
}
