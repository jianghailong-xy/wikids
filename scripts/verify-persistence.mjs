// P3 persistence verification, run with: npm run verify:persistence
//
// Serial steps, each must pass (any failure cleans up in `finally` and exits
// non-zero):
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. refuse a preset development DATABASE_URL explicitly
//   3. start a TRULY isolated throwaway Postgres: a docker-compose project
//      with a random project name, random published port, random database /
//      user / password and tmpfs storage (no shared volume, nothing on the
//      development compose project) — postgres:16-alpine, the production
//      image
//   4. demonstrate the guard: the development URL is refused, the isolated
//      URL is accepted (scripts/assert-isolated-db.mjs, mirroring
//      lib/db/isolated-db.ts which the test suite enforces too)
//   5. migrate from an EMPTY database with scripts/migrate.mjs (all of
//      ./drizzle, 0000..0003, applied in order)
//   6. scripts/db-smoke.mjs — schema shape + migration bookkeeping
//   7. vitest run --config vitest.persistence.config.ts — the real-Postgres
//      suite: owner scoping, atomic append + CAS, concurrent unique commits,
//      receipt idempotency, snapshot corruption/missing/seq/checksum
//      recovery, database-time AI leases + budget, no network inside
//      transactions, deterministic fallback
//   8. npm run typecheck — the whole repo compiles
//   9. finally: `docker compose down -v` on the random project and removal
//      of the temp dir — verified by asserting no containers remain
//
// The suite never touches the development database: DATABASE_URL is only
// ever set for the isolated container, and both the test setup and this
// script refuse the development URL.
//
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const BIN = path.join(ROOT, "node_modules", ".bin");

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/wikids";

let tempDir = null;
let projectName = null;
let composeFile = null;

function run(cmd, args, env = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
}

function fail(message) {
  console.error(`\nverify:persistence FAILED: ${message}`);
  cleanup();
  process.exit(1);
}

/** Synchronous: used by fail() and by the success path alike. */
function cleanup() {
  if (projectName && composeFile) {
    console.log("\n$ docker compose down -v (cleanup)");
    const result = spawnSync(
      "docker",
      ["compose", "-p", projectName, "-f", composeFile, "down", "-v", "--remove-orphans", "--timeout", "5"],
      { cwd: ROOT, stdio: "inherit" },
    );
    if (result.status !== 0) {
      console.error("cleanup: docker compose down failed");
      process.exitCode = 1;
    }
    const ps = spawnSync("docker", ["compose", "-p", projectName, "-f", composeFile, "ps", "-q"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const remaining = (ps.stdout ?? "").trim();
    if (remaining !== "") {
      console.error(`cleanup: containers still running: ${remaining}`);
      process.exitCode = 1;
    }
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// --- step 1: dependencies ---------------------------------------------------
const hasDeps =
  existsSync(path.join(ROOT, "node_modules", "vitest", "package.json")) &&
  existsSync(path.join(ROOT, "node_modules", "typescript", "package.json")) &&
  existsSync(path.join(ROOT, "node_modules", "drizzle-orm", "package.json"));
if (!hasDeps) {
  const status = run("npm", ["ci"]);
  if (status !== 0) fail("dependency install");
}

// --- step 2: refuse a preset development DATABASE_URL -----------------------
const preset = process.env.DATABASE_URL;
if (preset) {
  const looksDev =
    /^postgres(ql)?:\/\/postgres:postgres@[^/]+:5432\/wikids$/.test(preset);
  if (looksDev) {
    fail(`refusing development DATABASE_URL (${preset}) in the environment`);
  }
  console.log(
    "\nnote: a preset DATABASE_URL was found but is not the development database; children get the isolated URL instead",
  );
}

// --- step 3: isolated throwaway Postgres ------------------------------------
const suffix = randomBytes(4).toString("hex");
projectName = `wikids-p3v-${suffix}`;
const dbName = `p3v_${suffix}`;
const dbUser = `p3v_${suffix}`;
const dbPassword = randomBytes(12).toString("hex");
const port = await findFreePort();
tempDir = mkdtempSync(path.join(os.tmpdir(), "wikids-p3v-"));
composeFile = path.join(tempDir, "compose.yml");
const databaseUrl = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}`;

writeFileSync(
  composeFile,
  `# Generated per-run by scripts/verify-persistence.mjs — throwaway Postgres.
# Random project/port/db/user/password and tmpfs storage: it can neither read
# nor write the development database.
services:
  pg:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${dbUser}
      POSTGRES_PASSWORD: ${dbPassword}
      POSTGRES_DB: ${dbName}
    tmpfs:
      - /var/lib/postgresql/data
    ports:
      - "127.0.0.1:${port}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbUser} -d ${dbName}"]
      interval: 2s
      timeout: 3s
      retries: 30
`,
);

console.log(`\nIsolated Postgres: project=${projectName} port=${port} db=${dbName}`);

let status = run("docker", [
  "compose",
  "-p",
  projectName,
  "-f",
  composeFile,
  "up",
  "-d",
  "--wait",
  "--wait-timeout",
  "120",
]);
if (status !== 0) {
  // Older compose without --wait: poll pg_isready.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    const probe = spawnSync(
      "docker",
      ["compose", "-p", projectName, "-f", composeFile, "exec", "-T", "pg", "pg_isready", "-U", dbUser, "-d", dbName],
      { cwd: ROOT, stdio: "ignore" },
    );
    ready = probe.status === 0;
    if (!ready) await sleep(2000);
  }
  if (!ready) fail("Postgres did not become ready");
}

// --- step 4: guard demo -----------------------------------------------------
console.log("\n# step 4: isolated-db guard (dev URL must be refused)");
let guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), DEV_DATABASE_URL], {
  cwd: ROOT,
  encoding: "utf8",
});
if (guard.status === 0) fail("the development DATABASE_URL was NOT refused");
console.log("  dev URL refused as expected (exit " + guard.status + ")");
guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), databaseUrl], {
  cwd: ROOT,
  encoding: "utf8",
});
if (guard.status !== 0) fail("the isolated URL was refused:\n" + guard.stderr);
console.log("  isolated URL accepted");

// --- step 5: migrate from zero ----------------------------------------------
console.log("\n# step 5: migrate the EMPTY database from zero");
status = run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });
if (status !== 0) fail("migration from zero");

// --- step 6: schema smoke ----------------------------------------------------
console.log("\n# step 6: db smoke (schema shape + migration bookkeeping)");
status = run("node", ["scripts/db-smoke.mjs"], { DATABASE_URL: databaseUrl });
if (status !== 0) fail("db smoke");

// --- step 7: the real-Postgres persistence suite ----------------------------
console.log("\n# step 7: persistence test suite (isolated real Postgres)");
status = run(path.join(BIN, "vitest"), ["run", "--config", "vitest.persistence.config.ts"], {
  DATABASE_URL: databaseUrl,
});
if (status !== 0) fail("persistence test suite");

// --- step 8: typecheck --------------------------------------------------------
console.log("\n# step 8: typecheck");
status = run("npm", ["run", "typecheck"]);
if (status !== 0) fail("typecheck");

// --- step 9: cleanup ---------------------------------------------------------
cleanup();

console.log("\nverify:persistence PASSED (isolated Postgres, migrated from zero, cleaned up)");
process.exit(0);

// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = 20000 + Math.floor(Math.random() * 25000);
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", () => resolve(false));
      probe.listen(candidate, "127.0.0.1", () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return candidate;
  }
  throw new Error("could not find a free port");
}
