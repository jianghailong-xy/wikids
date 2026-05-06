import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Treat .mdx alongside .ts/.tsx as page-eligible files.
  pageExtensions: ["ts", "tsx", "mdx"],
  // Emit a self-contained bundle at .next/standalone so we can ship a small
  // Docker image that runs `node server.js` without devDependencies.
  output: "standalone",
};

const withMDX = createMDX({
  // Compile .mdx at build time using the same React as the rest of the app.
  // Authors can use any component declared in mdx-components.tsx without
  // importing it inside each lesson file. remark-gfm enables GitHub-flavored
  // markdown features that authors expect — tables, strikethrough, autolinks,
  // and task lists.
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
