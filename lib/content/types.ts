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
  cover?: string;
  lessons: Lesson[];
}
