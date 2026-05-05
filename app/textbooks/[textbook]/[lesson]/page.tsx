import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { buildMdxComponents } from "@/components/mdx/components";
import { LessonProgressBeacon } from "@/components/learn/lesson-progress-beacon";
import {
  getAdjacentLessons,
  getAllTextbooks,
  getLesson,
  readLessonSource,
} from "@/lib/content";

export function generateStaticParams() {
  return getAllTextbooks().flatMap((t) =>
    t.lessons.map((l) => ({ textbook: t.slug, lesson: l.slug })),
  );
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ textbook: string; lesson: string }>;
}) {
  const { textbook: textbookSlug, lesson: lessonSlug } = await params;
  const located = getLesson(textbookSlug, lessonSlug);
  if (!located) notFound();
  const { textbook, lesson } = located;

  const source = await readLessonSource(textbookSlug, lessonSlug);
  if (!source) notFound();

  const { prev, next } = getAdjacentLessons(textbookSlug, lessonSlug);
  const components = buildMdxComponents({ textbookSlug, lessonSlug });

  return (
    <article>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        <Link href={`/textbooks/${textbook.slug}`} className="hover:underline">
          {textbook.title}
        </Link>
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">{lesson.title}</h1>

      <div className="prose prose-slate mt-8 max-w-none">
        <MDXRemote source={source} components={components} />
      </div>

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
