/**
 * Isolated test-database guard (P3 verification).
 *
 * The persistence verifier only ever runs against a throwaway Postgres
 * started per run with a random project name, port, database and user.
 * These helpers make the development database unreachable BY CONSTRUCTION:
 * a DATABASE_URL pointing at it is refused explicitly, and anything that is
 * not the isolated throwaway shape is refused too.
 *
 * scripts/assert-isolated-db.mjs mirrors this logic for plain-node scripts.
 */

/** The development database from .env.example / docker-compose. */
export const DEV_DATABASE_URLS: readonly string[] = [
  "postgres://postgres:postgres@localhost:5432/wikids",
  "postgres://postgres:postgres@db:5432/wikids",
];

/**
 * True when `url` is (or looks like) the development database: the wikids
 * database on port 5432, whatever the host spelling.
 */
export function isDevelopmentDatabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  return (
    parsed.port === "5432" && dbName === "wikids" && parsed.username === "postgres"
  );
}

/**
 * Throw unless `url` is an isolated P3-verifier throwaway database:
 * 127.0.0.1, a non-5432 port, and `p3v_`-prefixed database and user names.
 * The development URL gets a dedicated refusal message.
 */
export function assertIsolatedDatabaseUrl(url: string): void {
  assertIsolatedVerifierUrl(url, "p3v_");
}

/**
 * The generalized guard: an isolated verifier throwaway database must live
 * on 127.0.0.1, on a non-5432 port, with database and user names carrying
 * the given prefix. The P4.1 orchestration verifier uses `p4v_`.
 */
export function assertIsolatedVerifierUrl(url: string, prefix: string): void {
  if (isDevelopmentDatabaseUrl(url)) {
    throw new Error(
      `refusing development DATABASE_URL (${url}): the verifier only runs against an isolated throwaway Postgres`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// scheme");
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  const user = decodeURIComponent(parsed.username);
  const isolated =
    parsed.hostname === "127.0.0.1" &&
    parsed.port !== "" &&
    parsed.port !== "5432" &&
    dbName.startsWith(prefix) &&
    user.startsWith(prefix);
  if (!isolated) {
    throw new Error(
      `DATABASE_URL is not an isolated ${prefix}-verifier database (host 127.0.0.1, non-5432 port, ${prefix}-prefixed db and user required): got host=${parsed.hostname} port=${parsed.port} db=${dbName}`,
    );
  }
}

/** The P4.1 orchestration verifier's throwaway-database guard (`p4v_`). */
export function assertIsolatedOrchestrationDatabaseUrl(url: string): void {
  assertIsolatedVerifierUrl(url, "p4v_");
}

/** The P6.3 game-safety verifier's throwaway-database guard (`p6s_`). */
export function assertIsolatedSafetyDatabaseUrl(url: string): void {
  assertIsolatedVerifierUrl(url, "p6s_");
}
