import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/mdx/callout";
import { Quiz } from "@/components/mdx/quiz";
import { Lesson } from "@/components/learn/lesson";

// Components declared here are available in every .mdx file under app/
// without an explicit import. Used by @next/mdx via Next.js convention.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Callout,
    Quiz,
    Lesson,
    ...components,
  };
}
