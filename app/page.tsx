import Link from "next/link";
import { getAllTextbooks } from "@/lib/content";

const HIDDEN_ON_HOME = new Set(["math-grade-1", "english-grade-1"]);

export default function HomePage() {
  const textbooks = getAllTextbooks().filter(
    (t) => !HIDDEN_ON_HOME.has(t.slug),
  );

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Welcome to Wikids
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
          Bite-sized lessons for curious kids.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Pick a textbook, work through the lessons at your own pace, and keep
          track of what you&apos;ve mastered.
        </p>
        <div className="mt-6">
          <Link
            href="/textbooks"
            className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Browse textbooks
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold text-slate-900">
          Featured textbooks
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {textbooks.slice(0, 4).map((t) => (
            <Link
              key={t.slug}
              href={`/textbooks/${t.slug}`}
              className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.subject} · {t.gradeLevel}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                {t.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600">{t.description}</p>
              <p className="mt-3 text-xs text-slate-500">
                {t.lessons.length} lesson{t.lessons.length === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
