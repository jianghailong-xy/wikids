import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{ts,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        // docs/design/werewolf/visual-spec.md §4: the night-world palette the
        // werewolf lobby and match extend the existing brand with. Flat names
        // (not Tailwind's `amber`/`slate` scales) so nothing existing shifts.
        werewolf: {
          bg: "#171D3B", // deep indigo page + lobby feature card
          surface: "#242D52", // raised night card (phase, private identity)
          moon: "#BDD9FF", // selection outline, moon, information accent
          amber: "#F4BF69", // the ONE current primary action
          amberHover: "#F8CC86",
          teal: "#69C8B5", // small-area AI / connection accent
          text: "#EAF1FF", // night primary text
          muted: "#A7B8D8", // night secondary text (never sole carrier of state)
          ink: "#182344", // dark text on paper and on the amber button
          paper: "#F7F9FF", // event and light content cards
          paperMuted: "#56678A", // timestamps, secondary text on paper
          border: "#DFE7F3",
          borderDark: "#687CA4",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
