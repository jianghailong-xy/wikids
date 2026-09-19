// Engine verification, run with: npm run verify:engine
//
// Serial steps, each must pass:
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. vitest run       — foundation smoke + quick6-v1 executable spec +
//                         production engine tests (tests/games/**): full
//                         rule coverage, fast-check property tests, the
//                         >=1000-seed scripted-bot simulation and the
//                         domain import-boundary guard.
//                         Hermetic: no database, no browser, no API key.
//   3. npm run typecheck — tsc --noEmit over the whole repo incl. lib/games
//
// The suite never touches the dev database (DATABASE_URL and DEEPSEEK_API_KEY
// are stripped, global fetch is blocked in tests/setup.ts) and makes no
// external API calls. See docs/quick6-v1-rules.md §10.
//
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BIN = join(ROOT, "node_modules", ".bin");

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const env = { ...process.env };
  // Belt and braces: the test setup also strips these and blocks fetch.
  delete env.DATABASE_URL;
  delete env.DEEPSEEK_API_KEY;
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
}

const hasDeps =
  existsSync(join(ROOT, "node_modules", "vitest", "package.json")) &&
  existsSync(join(ROOT, "node_modules", "typescript", "package.json"));

if (!hasDeps) {
  const status = run("npm", ["ci"]);
  if (status !== 0) {
    console.error("\nverify:engine FAILED at dependency install");
    process.exit(status);
  }
}

let status = run(join(BIN, "vitest"), ["run"]);
if (status !== 0) {
  console.error("\nverify:engine FAILED at vitest run");
  process.exit(status);
}

status = run("npm", ["run", "typecheck"]);
if (status !== 0) {
  console.error("\nverify:engine FAILED at typecheck");
  process.exit(status);
}

console.log("\nverify:engine PASSED (vitest run + typecheck)");
