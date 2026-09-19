#!/usr/bin/env node
// Mirrors lib/db/isolated-db.ts for plain-node scripts: refuses the
// development DATABASE_URL explicitly and accepts only an isolated verifier
// shape (127.0.0.1, non-5432 port, prefix-prefixed db and user).
//
// Usage: node scripts/assert-isolated-db.mjs <DATABASE_URL> [prefix]
// The prefix defaults to p3v_ (P3 persistence verifier); the P4.1
// orchestration verifier passes p4v_.
// Exit 0 when isolated, 1 otherwise (with the refusal on stderr).

const url = process.argv[2] ?? process.env.DATABASE_URL ?? "";
const prefix = process.argv[3] ?? "p3v_";

function fail(message) {
  console.error(`isolated-db guard: ${message}`);
  process.exit(1);
}

if (!url) {
  fail("no DATABASE_URL given");
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("DATABASE_URL is not a valid URL");
}

const dbName = parsed.pathname.replace(/^\//, "");
const user = decodeURIComponent(parsed.username);

const isDev =
  parsed.port === "5432" && dbName === "wikids" && parsed.username === "postgres";
if (isDev) {
  fail(
    `refusing development DATABASE_URL (${url}): the verifier only runs against an isolated throwaway Postgres`,
  );
}

const isolated =
  (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
  parsed.hostname === "127.0.0.1" &&
  parsed.port !== "" &&
  parsed.port !== "5432" &&
  dbName.startsWith(prefix) &&
  user.startsWith(prefix);
if (!isolated) {
  fail(
    `DATABASE_URL is not an isolated ${prefix}-verifier database (host 127.0.0.1, non-5432 port, ${prefix}-prefixed db and user required): got host=${parsed.hostname} port=${parsed.port} db=${dbName}`,
  );
}

console.log(`isolated-db guard: accepted ${parsed.protocol}//${user}@${parsed.hostname}:${parsed.port}/${dbName}`);

