// Tiny client-side store that aggregates each kid's quiz scores by lesson
// so we can show 0–3 stars in the Lesson header. Lives entirely in
// localStorage; the canonical record is still saved to the server via
// /api/quiz when the kid is signed in.

const STORAGE_KEY = "wikids.quiz-scores";
const UPDATE_EVENT = "wikids:quiz-score-updated";

type QuizScore = { score: number; total: number };
type LessonScores = Record<string, QuizScore>;
type TextbookScores = Record<string, LessonScores>;
type AllScores = Record<string, TextbookScores>;

export interface LessonStarSummary {
  earned: number;
  outOf: number;
  percent: number;
  stars: 0 | 1 | 2 | 3;
  quizCount: number;
}

function readAll(): AllScores {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AllScores) : {};
  } catch {
    return {};
  }
}

function writeAll(all: AllScores) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // Quota / private mode — UI keeps working without persistence.
  }
}

// Persist a single quiz result. Always overwrites — if a kid retakes the
// quiz they get whatever they scored most recently.
export function writeLocalScore(
  textbookSlug: string,
  lessonSlug: string,
  quizId: string,
  score: number,
  total: number,
) {
  const all = readAll();
  const tb = all[textbookSlug] ?? {};
  const lesson = tb[lessonSlug] ?? {};
  lesson[quizId] = { score, total };
  tb[lessonSlug] = lesson;
  all[textbookSlug] = tb;
  writeAll(all);
}

// Sum every quiz score recorded for one lesson into a star summary.
export function summarizeLesson(
  textbookSlug: string,
  lessonSlug: string,
): LessonStarSummary {
  const all = readAll();
  const lesson = all[textbookSlug]?.[lessonSlug] ?? {};
  const quizzes = Object.values(lesson);
  const earned = quizzes.reduce((acc, q) => acc + q.score, 0);
  const outOf = quizzes.reduce((acc, q) => acc + q.total, 0);
  const percent = outOf === 0 ? 0 : earned / outOf;
  // Star thresholds: 0 stars below 50%, 1 from 50%, 2 from 75%, 3 from 95%.
  // Tuned to feel encouraging — most kids should get at least 2 on a
  // careful run, with 3 reserved for near-perfect.
  let stars: 0 | 1 | 2 | 3 = 0;
  if (outOf > 0) {
    if (percent >= 0.95) stars = 3;
    else if (percent >= 0.75) stars = 2;
    else if (percent >= 0.5) stars = 1;
  }
  return {
    earned,
    outOf,
    percent,
    stars,
    quizCount: quizzes.length,
  };
}

// Subscribe to score updates from anywhere in the page (same Quiz dispatches
// the event after writing) and from other tabs (the native `storage` event).
export function onScoreChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => handler();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) handler();
  };
  window.addEventListener(UPDATE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UPDATE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
