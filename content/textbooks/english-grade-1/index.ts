import type { Textbook } from "@/lib/content/types";

const textbook: Textbook = {
  slug: "english-grade-1",
  title: "English, Grade 1",
  description: "Letters, sounds, and your first reading adventures.",
  subject: "English",
  gradeLevel: "Grade 1",
  cover: "/covers/english-grade-1.svg",
  lessons: [
    {
      slug: "01-the-alphabet",
      title: "The Alphabet",
      description: "Meet the 26 letters of English.",
      estimatedMinutes: 10,
    },
  ],
};

export default textbook;
