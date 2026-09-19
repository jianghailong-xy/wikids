import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the P4.1 orchestration suite, run by
 * scripts/verify-ai-orchestration.mjs against the isolated throwaway
 * Postgres.
 *
 * Like the P3 persistence config, this one does NOT block fetch (one test
 * performs a real HTTP call against a localhost mock server to prove no
 * network call happens inside a transaction) and it REQUIRES an isolated
 * DATABASE_URL — see tests/orchestration/setup.ts and
 * lib/db/isolated-db.ts.
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
    setupFiles: ["./tests/orchestration/setup.ts"],
    include: ["tests/orchestration/**/*.test.ts"],
    // The suite talks to one real Postgres and spawns deliberate races and
    // locks; a single fork keeps timings deterministic and the shared
    // transaction-guard counter meaningful.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
