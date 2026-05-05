import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllTextbooks, getTextbook } from "@/lib/content";

export function generateStaticParams() {
  return getAllTextbooks().map((t) => ({ textbook: t.slug }));
}

export default async function TextbookPage({
  params,
}: {
  params: Promise<{ textbook: string }>;
}) {
  const { textbook: textbookSlug } = await params;
  const textbook = getTextbook(textbookSlug);
  if (!textbook) notFound();

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {textbook.subject} · {textbook.gradeLevel}
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">
        {textbook.title}
      </h1>
      <p className="mt-2 max-w-2xl text-slate-600">{textbook.description}</p>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-slate-900">
        Lessons
      </h2>
      <ol className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {textbook.lessons.map((l, i) => (
          <li key={l.slug}>
            <Link
              href={`/textbooks/${textbook.slug}/${l.slug}`}
              className="flex items-start gap-4 p-4 transition hover:bg-slate-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                {i + 1}
              </span>
              <span className="flex-1">
                <span className="block font-medium text-slate-900">
                  {l.title}
                </span>
                {l.description ? (
                  <span className="mt-0.5 block text-sm text-slate-600">
                    {l.description}
                  </span>
                ) : null}
              </span>
              {l.estimatedMinutes ? (
                <span className="shrink-0 text-xs text-slate-500">
                  {l.estimatedMinutes} min
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
