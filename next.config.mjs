import createMDX from "@next/mdx";

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
  // importing it inside each lesson file.
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
