import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // The `server-only` marker throws under vite's default export
      // condition; Next.js resolves react-server at build time instead.
      "server-only": fileURLToPath(new URL("./tests/aliases/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Node by default; DOM tests opt in via `// @vitest-environment jsdom`.
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // The persistence suite needs a real Postgres and its own config
    // (vitest.persistence.config.ts, run by `npm run verify:persistence`).
    // Same for the P4.1 orchestration suite (vitest.orchestration.config.ts,
    // run by `npm run verify:ai-orchestration`).
    exclude: ["tests/persistence/**", "tests/orchestration/**"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
