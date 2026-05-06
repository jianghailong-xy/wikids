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
      slug: "04-present-continuous-questions",
      title: "are you doing? (present continuous questions)",
      description:
        "Flip am/is/are to the front and ask what someone is doing right now — plus wh-questions and short answers.",
      estimatedMinutes: 20,
    },
    {
      slug: "05-present-simple",
      title: "I do / work / like (present simple)",
      description:
        "Talk about habits, routines, and things that are always true — the he/she/it -s rule, spelling tricks, and how often things happen.",
      estimatedMinutes: 25,
    },
  ],
};

export default textbook;
