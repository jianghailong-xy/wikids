import type { Textbook } from "@/lib/content/types";

const textbook: Textbook = {
  slug: "essential-grammar-in-use",
  title: "Essential Grammar in Use",
  description:
    "Friendly, bite-sized lessons on the building blocks of English grammar.",
  subject: "English",
  gradeLevel: "Beginner",
  lessons: [
    {
      slug: "01-am-is-are",
      title: "am / is / are",
      description:
        "Your first English grammar: how to use am, is, and are (and their short forms).",
      estimatedMinutes: 20,
    },
    {
      slug: "02-am-is-are-questions",
      title: "am / is / are (questions)",
      description:
        "Ask and answer questions with be: word order, question words, and short answers.",
      estimatedMinutes: 20,
    },
    {
      slug: "03-present-continuous",
      title: "I am doing (present continuous)",
      description:
        "Say what's happening right now with am/is/are + -ing — including the spelling rules and how to say no.",
      estimatedMinutes: 20,
    },
    {
      slug: "08-now-or-in-general",
      title: "I am doing and I do (now or in general)",
      description:
        "Pick the right tense: present continuous for right now, present simple for in general — plus the verbs that never take -ing.",
      estimatedMinutes: 25,
    },
  ],
};

export default textbook;
