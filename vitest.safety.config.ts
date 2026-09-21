import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the P6.3 game-safety suite, run by
 * scripts/verify-game-safety.mjs against the isolated throwaway Postgres.
 *
 * It REQUIRES an isolated DATABASE_URL (tests/safety/setup.ts and
 * lib/db/isolated-db.ts refuse anything else) and talks to one real
 * Postgres with deliberate boundary seeding, so a single fork keeps the
 * shared state deterministic.
 */
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
    environment: "node",
    setupFiles: ["./tests/safety/setup.ts"],
    include: ["tests/safety/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
