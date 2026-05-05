import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import { Callout } from "./callout";
import { Quiz } from "./quiz";

export function buildMdxComponents({
  textbookSlug,
  lessonSlug,
}: {
  textbookSlug: string;
  lessonSlug: string;
}): MDXRemoteProps["components"] {
  return {
    Callout,
    // Inject lesson context so quizzes can persist attempts without authors
    // having to repeat slugs in every MDX file.
    Quiz: (props) => (
      <Quiz textbookSlug={textbookSlug} lessonSlug={lessonSlug} {...props} />
    ),
  };
}
