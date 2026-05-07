// Single source of truth for the irregular-verb deck. Each verb is tagged
// with the lesson where it's first taught; <IrregularVerbDeck unlockedBy="…" />
// shows every verb unlocked in that lesson or any earlier one, so kids
// accumulate their personal deck as they progress.

export interface IrregularVerb {
  base: string;
  past: string;
  participle: string;
  unlockedIn: string;
}

// Lessons that unlock new irregular verbs, in textbook order. The deck
// uses this list to decide whether a verb is "unlocked yet".
export const IRREGULAR_VERB_LESSON_ORDER = [
  "11-past-simple",
  "15-present-perfect",
  "17-have-you-ever",
];

// 40+ irregular verbs, each tagged by the lesson that first introduces
// them. L11 unlocks the original past-simple table. L15 doesn't add new
// verbs (it just teaches the participle for many of these). L17 adds the
// few extras introduced in the "have you ever" lesson.
export const IRREGULAR_VERBS: IrregularVerb[] = [
  { base: "begin", past: "began", participle: "begun", unlockedIn: "11-past-simple" },
  { base: "break", past: "broke", participle: "broken", unlockedIn: "11-past-simple" },
  { base: "bring", past: "brought", participle: "brought", unlockedIn: "11-past-simple" },
  { base: "build", past: "built", participle: "built", unlockedIn: "11-past-simple" },
  { base: "buy", past: "bought", participle: "bought", unlockedIn: "11-past-simple" },
  { base: "catch", past: "caught", participle: "caught", unlockedIn: "11-past-simple" },
  { base: "come", past: "came", participle: "come", unlockedIn: "11-past-simple" },
  { base: "do", past: "did", participle: "done", unlockedIn: "11-past-simple" },
  { base: "drink", past: "drank", participle: "drunk", unlockedIn: "11-past-simple" },
  { base: "eat", past: "ate", participle: "eaten", unlockedIn: "11-past-simple" },
  { base: "fall", past: "fell", participle: "fallen", unlockedIn: "11-past-simple" },
  { base: "find", past: "found", participle: "found", unlockedIn: "11-past-simple" },
  { base: "fly", past: "flew", participle: "flown", unlockedIn: "11-past-simple" },
  { base: "forget", past: "forgot", participle: "forgotten", unlockedIn: "11-past-simple" },
  { base: "get", past: "got", participle: "got", unlockedIn: "11-past-simple" },
  { base: "give", past: "gave", participle: "given", unlockedIn: "11-past-simple" },
  { base: "go", past: "went", participle: "gone", unlockedIn: "11-past-simple" },
  { base: "have", past: "had", participle: "had", unlockedIn: "11-past-simple" },
  { base: "hear", past: "heard", participle: "heard", unlockedIn: "11-past-simple" },
  { base: "know", past: "knew", participle: "known", unlockedIn: "11-past-simple" },
  { base: "leave", past: "left", participle: "left", unlockedIn: "11-past-simple" },
  { base: "lose", past: "lost", participle: "lost", unlockedIn: "11-past-simple" },
  { base: "make", past: "made", participle: "made", unlockedIn: "11-past-simple" },
  { base: "meet", past: "met", participle: "met", unlockedIn: "11-past-simple" },
  { base: "pay", past: "paid", participle: "paid", unlockedIn: "11-past-simple" },
  { base: "put", past: "put", participle: "put", unlockedIn: "11-past-simple" },
  { base: "read", past: "read", participle: "read", unlockedIn: "11-past-simple" },
  { base: "ring", past: "rang", participle: "rung", unlockedIn: "11-past-simple" },
  { base: "say", past: "said", participle: "said", unlockedIn: "11-past-simple" },
  { base: "see", past: "saw", participle: "seen", unlockedIn: "11-past-simple" },
  { base: "sell", past: "sold", participle: "sold", unlockedIn: "11-past-simple" },
  { base: "sit", past: "sat", participle: "sat", unlockedIn: "11-past-simple" },
  { base: "sleep", past: "slept", participle: "slept", unlockedIn: "11-past-simple" },
  { base: "speak", past: "spoke", participle: "spoken", unlockedIn: "11-past-simple" },
  { base: "stand", past: "stood", participle: "stood", unlockedIn: "11-past-simple" },
  { base: "take", past: "took", participle: "taken", unlockedIn: "11-past-simple" },
  { base: "tell", past: "told", participle: "told", unlockedIn: "11-past-simple" },
  { base: "think", past: "thought", participle: "thought", unlockedIn: "11-past-simple" },
  { base: "win", past: "won", participle: "won", unlockedIn: "11-past-simple" },
  { base: "write", past: "wrote", participle: "written", unlockedIn: "11-past-simple" },
  { base: "be", past: "was / were", participle: "been", unlockedIn: "17-have-you-ever" },
  { base: "drive", past: "drove", participle: "driven", unlockedIn: "17-have-you-ever" },
];

export function verbsUnlockedBy(lessonSlug: string): IrregularVerb[] {
  const cutoff = IRREGULAR_VERB_LESSON_ORDER.indexOf(lessonSlug);
  if (cutoff === -1) return IRREGULAR_VERBS;
  return IRREGULAR_VERBS.filter(
    (v) => IRREGULAR_VERB_LESSON_ORDER.indexOf(v.unlockedIn) <= cutoff,
  );
}
