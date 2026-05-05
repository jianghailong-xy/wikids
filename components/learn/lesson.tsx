import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonProgressBeacon } from "./lesson-progress-beacon";
import { getAdjacentLessons, getLesson } from "@/lib/content";

// Wraps a lesson MDX file with the standard chrome (breadcrumb, title,
// prose container, prev/next nav, progress beacon). Authors put the
// textbook + lesson slugs at the top of each .mdx so this component can
// look up neighbors from the registry.
export function Lesson({
  textbook: textbookSlug,
  slug: lessonSlug,
  children,
}: {
  textbook: string;
  slug: string;
  children: React.ReactNode;
}) {
  const located = getLesson(textbookSlug, lessonSlug);
  if (!located) notFound();
  const { textbook, lesson } = located;
  const { prev, next } = getAdjacentLessons(textbookSlug, lessonSlug);

  return (
    <article>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        <Link href={`/textbooks/${textbook.slug}`} className="hover:underline">
          {textbook.title}
        </Link>
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">{lesson.title}</h1>

      <div className="prose prose-slate mt-8 max-w-none">{children}</div>

      <LessonProgressBeacon
        textbookSlug={textbookSlug}
        lessonSlug={lessonSlug}
      />

      <nav className="mt-12 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
        {prev ? (
          <Link
            href={`/textbooks/${textbook.slug}/${prev.slug}`}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/textbooks/${textbook.slug}/${next.slug}`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
