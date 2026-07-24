export type Subject =
  | "Math"
  | "English"
  | "Science"
  | "History"
  | "Art"
  | "Other";

export interface Lesson {
  slug: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
}

export interface Textbook {
  slug: string;
  title: string;
  description: string;
  subject: Subject;
  gradeLevel: string;
  /**
   * Optional series this book belongs to (e.g. "New Concept English").
   * Books sharing a series are grouped together on the overview page.
   */
  series?: string;
  cover?: string;
  lessons: Lesson[];
}
