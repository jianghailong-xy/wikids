import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the P3 persistence suite, run by
 * scripts/verify-persistence.mjs against the isolated throwaway Postgres.
 *
 * Unlike the default config this one does NOT block fetch (the AI-lease
 * tests perform real network calls against a localhost test server), and it
 * REQUIRES an isolated DATABASE_URL instead of stripping it — see
 * tests/persistence/setup.ts and lib/db/isolated-db.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/persistence/setup.ts"],
    include: ["tests/persistence/**/*.test.ts"],
    // The suite talks to one real Postgres and spawns deliberate races and
    // locks; a single fork keeps timings deterministic and the shared
    // transaction-guard counter meaningful.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
