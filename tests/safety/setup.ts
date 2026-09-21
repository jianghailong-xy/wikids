/**
 * Setup for the P6.3 game-safety suite.
 *
 * The suite only runs against the isolated throwaway Postgres started by
 * scripts/verify-game-safety.mjs. The development DATABASE_URL (or
 * anything that is not the isolated p6s_ shape) is refused explicitly, so
 * these tests can never read or write the development database.
 */
import { assertIsolatedSafetyDatabaseUrl } from "@/lib/db/isolated-db";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required: run `npm run verify:game-safety` to get the isolated throwaway Postgres",
  );
}
assertIsolatedSafetyDatabaseUrl(url);
