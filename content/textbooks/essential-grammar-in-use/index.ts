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
      slug: "06-present-simple-negative",
      title: "I don't ... (present simple negative)",
      description:
        "Say what you don't do with don't / doesn't + verb — and dodge the trap of leaving an -s on the verb.",
      estimatedMinutes: 20,
    },
  ],
};

export default textbook;
