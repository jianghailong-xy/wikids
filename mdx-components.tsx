import type { MDXComponents } from "mdx/types";
import { Audio, SayIt } from "@/components/mdx/audio";
import { Callout } from "@/components/mdx/callout";
import { CharacterCard } from "@/components/mdx/character-card";
import { ChatDialog } from "@/components/mdx/chat-dialog";
import { Conjugation } from "@/components/mdx/conjugation";
import { Contraction } from "@/components/mdx/contraction";
import { Flashcard, FlashcardDeck } from "@/components/mdx/flashcard";
import { Gallery } from "@/components/mdx/gallery";
import { Match } from "@/components/mdx/match";
import { MysteryPerson } from "@/components/mdx/mystery-person";
import { PronounVerbMap } from "@/components/mdx/pronoun-verb-map";
import { QuestionBuilder } from "@/components/mdx/question-builder";
import { Quiz } from "@/components/mdx/quiz";
import { SpotTheBroken } from "@/components/mdx/spot-the-broken";
import { WordFlip } from "@/components/mdx/word-flip";
import { Lesson } from "@/components/learn/lesson";

// Components declared here are available in every .mdx file under app/
// without an explicit import. Used by @next/mdx via Next.js convention.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Audio,
    Callout,
    CharacterCard,
    ChatDialog,
    Conjugation,
    Contraction,
    Flashcard,
    FlashcardDeck,
    Gallery,
    Lesson,
    Match,
    MysteryPerson,
    PronounVerbMap,
    QuestionBuilder,
    Quiz,
    SayIt,
    SpotTheBroken,
    WordFlip,
    ...components,
  };
}
