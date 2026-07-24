import type { Lesson, Textbook } from "./types";
import { textbooks as textbookRegistry } from "@/content/textbooks";

// Lessons live as `app/textbooks/<book>/<lesson>/page.mdx` so MDX is
// compiled at build time. This registry mirrors that structure with
// metadata (title, ordering, descriptions) used by overview pages and
// the lesson chrome (prev/next, breadcrumb).

export function getAllTextbooks(): Textbook[] {
  return textbookRegistry;
}

export interface TextbookGroup {
  /**
   * The series these textbooks belong to (e.g. "New Concept English"), or
   * null for a standalone book that isn't part of a series.
   */
  series: string | null;
  textbooks: Textbook[];
}

/**
 * Groups textbooks by `series` for grouped display on the overview page.
 * Series order follows first appearance in the registry; standalone books
 * (no `series`) each become their own single-book group in place.
 */
export function getTextbookGroups(): TextbookGroup[] {
  const groups: TextbookGroup[] = [];
  const bySeries = new Map<string, TextbookGroup>();
  for (const textbook of textbookRegistry) {
    if (!textbook.series) {
      groups.push({ series: null, textbooks: [textbook] });
      continue;
    }
    let group = bySeries.get(textbook.series);
    if (!group) {
      group = { series: textbook.series, textbooks: [] };
      bySeries.set(textbook.series, group);
      groups.push(group);
    }
    group.textbooks.push(textbook);
  }
  return groups;
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
