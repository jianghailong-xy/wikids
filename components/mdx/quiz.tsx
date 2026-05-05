"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answer: string;
}

export interface QuizProps {
  id: string;
  questions: QuizQuestion[];
  textbookSlug?: string;
  lessonSlug?: string;
}

export function Quiz({ id, questions, textbookSlug, lessonSlug }: QuizProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const score = questions.reduce(
    (acc, q) => acc + (answers[q.id] === q.answer ? 1 : 0),
    0,
  );
  const total = questions.length;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          answers,
          score,
          totalQuestions: total,
        }),
      });
    } catch {
      // Best-effort: don't block the UI if the user is signed out.
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="my-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm not-prose"
    >
      <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-600">
        Practice quiz
      </p>
      <ol className="space-y-5">
        {questions.map((q, qi) => (
          <li key={q.id}>
            <p className="mb-2 font-medium text-slate-900">
              {qi + 1}. {q.prompt}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.choices.map((c) => {
                const selected = answers[q.id] === c;
                const correct = submitted && c === q.answer;
                const wrong = submitted && selected && c !== q.answer;
                return (
                  <label
                    key={c}
                    className={cn(
                      "cursor-pointer rounded-md border px-3 py-1.5 text-sm",
                      "border-slate-300 hover:border-brand-500",
                      selected && !submitted && "border-brand-500 bg-brand-50",
                      correct && "border-emerald-500 bg-emerald-50",
                      wrong && "border-rose-500 bg-rose-50",
                    )}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={c}
                      className="sr-only"
                      checked={selected}
                      disabled={submitted}
                      onChange={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: c }))
                      }
                    />
                    {c}
                  </label>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex items-center justify-between">
        <button
          type="submit"
          disabled={submitted || Object.keys(answers).length < total}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitted ? "Submitted" : "Check answers"}
        </button>
        {submitted ? (
          <p className="text-sm text-slate-700">
            Score: <span className="font-semibold">{score}</span> / {total}
            {saving ? " · saving…" : ""}
          </p>
        ) : null}
      </div>
    </form>
  );
}
