import type { Textbook } from "@/lib/content/types";

const textbook: Textbook = {
  slug: "math-grade-1",
  title: "Math, Grade 1",
  description:
    "A friendly first walk through numbers, counting, and simple comparisons.",
  subject: "Math",
  gradeLevel: "Grade 1",
  cover: "/covers/math-grade-1.svg",
  lessons: [
    {
      slug: "01-counting-to-ten",
      title: "Counting to 10",
      description: "Count from 1 to 10 with everyday objects.",
      estimatedMinutes: 10,
    },
    {
      slug: "02-comparing-numbers",
      title: "Comparing Numbers",
      description: "Which is bigger? Use < and > to compare.",
      estimatedMinutes: 12,
    },
  ],
};

export default textbook;
