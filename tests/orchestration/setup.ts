/**
 * Setup for the P4.1 orchestration suite.
 *
 * The suite only runs against the isolated throwaway Postgres started by
 * scripts/verify-ai-orchestration.mjs. The development DATABASE_URL (or
 * anything that is not the isolated p4v_ shape) is refused explicitly, so
 * these tests can never read or write the development database. Unlike
 * tests/setup.ts, fetch is NOT blocked: one test makes a real HTTP call to
 * a localhost mock server, guarded by assertNoOpenTransaction.
 */
import { assertIsolatedOrchestrationDatabaseUrl } from "@/lib/db/isolated-db";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required: run `npm run verify:ai-orchestration` to get the isolated throwaway Postgres",
  );
}
assertIsolatedOrchestrationDatabaseUrl(url);
