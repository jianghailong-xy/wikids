import Link from "next/link";
import { getAllTextbooks } from "@/lib/content";

export default function TextbooksPage() {
  const textbooks = getAllTextbooks();

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Textbooks</h1>
      <p className="mb-8 text-slate-600">
        Choose a textbook to start learning.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {textbooks.map((t) => (
          <Link
            key={t.slug}
            href={`/textbooks/${t.slug}`}
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t.subject} · {t.gradeLevel}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              {t.title}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{t.description}</p>
            <p className="mt-3 text-xs text-slate-500">
              {t.lessons.length} lesson{t.lessons.length === 1 ? "" : "s"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
