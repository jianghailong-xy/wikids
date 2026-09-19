/**
 * Setup for the P3 persistence suite.
 *
 * The suite only runs against the isolated throwaway Postgres started by
 * scripts/verify-persistence.mjs. The development DATABASE_URL (or anything
 * that is not the isolated shape) is refused explicitly, so these tests can
 * never read or write the development database. Unlike tests/setup.ts,
 * fetch is NOT blocked here: the AI-lease tests make real HTTP calls to a
 * localhost test server, guarded by assertNoOpenTransaction.
 */
import { assertIsolatedDatabaseUrl } from "@/lib/db/isolated-db";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required: run `npm run verify:persistence` to get the isolated throwaway Postgres",
  );
}
assertIsolatedDatabaseUrl(url);
