// Domain-security verification, run with: npm run verify:domain-security
//
// Serial steps, each must pass:
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. vitest run       — the full suite, including:
//        - P2.1 domain-security canary matrix (seat x role x phase x event
//          prefix; leak counter must be exactly 0; post-game reveal by rule),
//        - P2.1 deterministic event replay (prefix replay, full-replay
//          equality, rejection of corrupted/duplicate/gapped/out-of-order
//          events),
//        - the P1.2 quick6-v1 rule spec, property tests and 1000-seed
//          simulation (regression).
//      Hermetic: no database, no browser, no API key.
//   3. npm run typecheck — tsc --noEmit over the whole repo incl. lib/games
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
    console.error("\nverify:domain-security FAILED at dependency install");
    process.exit(status);
  }
}

let status = run(join(BIN, "vitest"), ["run"]);
if (status !== 0) {
  console.error("\nverify:domain-security FAILED at vitest run");
  process.exit(status);
}

status = run("npm", ["run", "typecheck"]);
if (status !== 0) {
  console.error("\nverify:domain-security FAILED at typecheck");
  process.exit(status);
}

console.log("\nverify:domain-security PASSED (vitest run + typecheck, 0 canary leaks)");
