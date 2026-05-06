import type { MDXComponents } from "mdx/types";
import { Audio, SayIt } from "@/components/mdx/audio";
import { Callout } from "@/components/mdx/callout";
import { Flashcard, FlashcardDeck } from "@/components/mdx/flashcard";
import { Gallery } from "@/components/mdx/gallery";
import { Match } from "@/components/mdx/match";
import { Quiz } from "@/components/mdx/quiz";
import { Lesson } from "@/components/learn/lesson";

// Components declared here are available in every .mdx file under app/
// without an explicit import. Used by @next/mdx via Next.js convention.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Audio,
    Callout,
    Flashcard,
    FlashcardDeck,
    Gallery,
    Lesson,
    Match,
    Quiz,
    SayIt,
    ...components,
  };
}
