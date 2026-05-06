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
    {
      slug: "02-animal-words",
      title: "Animal Words",
      description: "Learn animal names with flashcards, sound, and matching.",
      estimatedMinutes: 15,
    },
    {
      slug: "03-am-is-are",
      title: "am / is / are",
      description: "Your first English grammar: how to use am, is, and are (and their short forms).",
      estimatedMinutes: 20,
    },
  ],
};

export default textbook;
