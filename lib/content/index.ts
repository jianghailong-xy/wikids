import fs from "node:fs/promises";
import path from "node:path";
import type { Lesson, Textbook } from "./types";
import { textbooks as textbookRegistry } from "@/content/textbooks";

const CONTENT_ROOT = path.join(process.cwd(), "content", "textbooks");

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

export async function readLessonSource(
  textbookSlug: string,
  lessonSlug: string,
): Promise<string | undefined> {
  const filePath = path.join(CONTENT_ROOT, textbookSlug, `${lessonSlug}.mdx`);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}
