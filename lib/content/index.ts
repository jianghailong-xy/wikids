import type { Lesson, Textbook } from "./types";
import { textbooks as textbookRegistry } from "@/content/textbooks";

// Lessons live as `app/textbooks/<book>/<lesson>/page.mdx` so MDX is
// compiled at build time. This registry mirrors that structure with
// metadata (title, ordering, descriptions) used by overview pages and
// the lesson chrome (prev/next, breadcrumb).

export function getAllTextbooks(): Textbook[] {
  return textbookRegistry;
}

export function getTextbook(slug: string): Textbook | undefined {
  return textbookRegistry.find((t) => t.slug === slug);
}

export function getLesson(
  textbookSlug: string,
  lessonSlug: string,
): { textbook: Textbook; lesson: Lesson; index: number } | undefined {
  const textbook = getTextbook(textbookSlug);
  if (!textbook) return undefined;
  const index = textbook.lessons.findIndex((l) => l.slug === lessonSlug);
  if (index === -1) return undefined;
  return { textbook, lesson: textbook.lessons[index], index };
}

export function getAdjacentLessons(
  textbookSlug: string,
  lessonSlug: string,
): { prev?: Lesson; next?: Lesson } {
  const located = getLesson(textbookSlug, lessonSlug);
  if (!located) return {};
  const { textbook, index } = located;
  return {
    prev: index > 0 ? textbook.lessons[index - 1] : undefined,
    next:
      index < textbook.lessons.length - 1
        ? textbook.lessons[index + 1]
        : undefined,
  };
}
