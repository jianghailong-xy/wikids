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
    {
      slug: "06-present-simple-negative",
      title: "I don't ... (present simple negative)",
      description:
        "Say what you don't do with don't / doesn't + verb — and dodge the trap of leaving an -s on the verb.",
      estimatedMinutes: 20,
    },
    {
      slug: "07-do-does-questions",
      title: "Do you ... ? (present simple questions)",
      description:
        "Ask about other people's habits with do and does — word order, wh-questions, always/usually, and short answers.",
      estimatedMinutes: 20,
    },
    {
      slug: "08-now-or-in-general",
      title: "I am doing and I do (now or in general)",
      description:
        "Pick the right tense: present continuous for right now, present simple for in general — plus the verbs that never take -ing.",
      estimatedMinutes: 25,
    },
    {
      slug: "09-have-and-have-got",
      title: "I have ... and I've got ...",
      description:
        "Two ways to talk about possession: have / has and have got / has got — with negatives, questions, and short answers.",
      estimatedMinutes: 25,
    },
    {
      slug: "10-was-were",
      title: "was / were",
      description:
        "Travel back in time: how am/is/are turn into was and were so you can talk about yesterday, last night, and last week.",
      estimatedMinutes: 20,
    },
    {
      slug: "11-past-simple",
      title: "worked / got / went (past simple)",
      description:
        "Tell what you did yesterday: the -ed ending for regular verbs, the spelling tweaks, and the irregular shape-shifters you just have to learn.",
      estimatedMinutes: 25,
    },
    {
      slug: "12-past-simple-negative-questions",
      title: "I didn't ... / Did you ... ? (past simple negative and questions)",
      description:
        "Say what you didn't do and ask what someone else did with did and didn't + infinitive — plus word order, wh-questions, and short answers.",
      estimatedMinutes: 25,
    },
    {
      slug: "13-past-continuous",
      title: "I was doing (past continuous)",
      description:
        "Say what was in the middle of happening at a moment in the past with was/were + -ing — plus negatives, questions, and how it differs from the present continuous.",
      estimatedMinutes: 25,
    },
    {
      slug: "14-past-continuous-and-past-simple",
      title: "I was doing (past continuous) and I did (past simple)",
      description:
        "Tell past stories with both tenses at once: past simple for what happened, past continuous for what was already going on — and how when/while glue them together.",
      estimatedMinutes: 25,
    },
    {
      slug: "15-present-perfect",
      title: "I have done (present perfect 1)",
      description:
        "Tie a past action to a result you can see right now: have/has + past participle, regular -ed and the irregular ones to know.",
      estimatedMinutes: 25,
    },
    {
      slug: "16-just-already-yet",
      title: "I've just ... I've already ... I haven't ... yet",
      description:
        "Three tiny time-words that ride along with the present perfect: just (a moment ago), already (sooner than expected), and yet (still waiting).",
      estimatedMinutes: 25,
    },
    {
      slug: "17-have-you-ever",
      title: "Have you ever ... ? (present perfect 3)",
      description:
        "Ask about a person's whole life so far with have/has + been, done, seen — plus ever, never, and the tricky pair gone vs been.",
      estimatedMinutes: 25,
    },
  ],
};

export default textbook;
