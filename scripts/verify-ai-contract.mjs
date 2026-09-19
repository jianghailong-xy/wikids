// AI-contract verification, run with: npm run verify:ai-contract
//
// Serial steps, each must pass:
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. static guards (node built-ins only):
//        - lib/ai exists; index/deepseek/hmac modules carry the
//          `server-only` marker (client bundles can never pull them in);
//        - no NEXT_PUBLIC_* read anywhere under lib/ai;
//        - no client-directive module imports @/lib/ai (client-bundle hygiene);
//        - lib/games stays pure: it never imports lib/ai (domain boundary);
//   3. vitest run tests/ai — the P3.3 contract suite: request shape
//      (endpoint, Bearer auth, DEEPSEEK_MODEL, reasoning.effort=none,
//      capped max_output_tokens, no tools + tool_choice=none, per-phase
//      json_schema, anonymous HMAC user), whitelist-only serialization,
//      timeout/network/400/401/402/422-no-retry, 429/5xx limited retries,
//      Retry-After, empty/invalid/incomplete/content_filter bodies,
//      AbortSignal paths, log-record dimensions and log hygiene.
//      Mock fetch only: no real API, no NEXT_PUBLIC keys. The test setup
//      strips every DEEPSEEK_* / GAME_SEAT_HMAC_SECRET / NEXT_PUBLIC_* env
//      var and blocks global fetch.
//   4. npm run typecheck — tsc --noEmit over the whole repo incl. lib/ai
//
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BIN = join(ROOT, "node_modules", ".bin");
const LIB_AI = join(ROOT, "lib", "ai");

function fail(message) {
  console.error(`\nverify:ai-contract FAILED at static guards: ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const env = { ...process.env };
  // Belt and braces: the test setup also strips these and blocks fetch.
  delete env.DATABASE_URL;
  delete env.AUTH_SECRET;
  delete env.GAME_SEAT_HMAC_SECRET;
  for (const key of Object.keys(env)) {
    if (key.startsWith("DEEPSEEK_") || key.startsWith("NEXT_PUBLIC_")) {
      delete env[key];
    }
  }
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function readSource(path) {
  return readFileSync(path, "utf8");
}

console.log("\nverify:ai-contract — static guards");

// lib/ai must exist with the contract modules.
for (const file of ["index.ts", "errors.ts", "contract.ts", "hmac.ts", "providers/deepseek.ts", "README.md"]) {
  if (!existsSync(join(LIB_AI, file))) fail(`missing lib/ai/${file}`);
}

// Server-only markers: the whole boundary is server-only.
for (const file of ["index.ts", "hmac.ts", "providers/deepseek.ts"]) {
  const source = readSource(join(LIB_AI, file));
  if (!/import\s+"server-only"\s*;/.test(source)) {
    fail(`lib/ai/${file} must import "server-only"`);
  }
}

// No NEXT_PUBLIC anywhere in lib/ai code (docs may mention it), and no
// lib/ai import from client code.
for (const file of walk(LIB_AI)) {
  if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
  const source = readSource(file);
  if (source.includes("NEXT_PUBLIC")) fail(`${relative(ROOT, file)} references NEXT_PUBLIC`);
}

// Client modules live in app/ and components/ only: a client-directive
// module there must never import lib/ai.
const CLIENT_DIRS = [join(ROOT, "app"), join(ROOT, "components")];
for (const dir of CLIENT_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    const source = readSource(file);
    if (!source.includes("use client")) continue;
    if (source.includes("lib/ai")) {
      fail(`client module ${relative(ROOT, file)} imports lib/ai`);
    }
  }
}

// Domain purity: lib/games must never import the concrete AI boundary.
for (const file of walk(join(ROOT, "lib", "games"))) {
  const source = readSource(file);
  if (source.includes("@/lib/ai") || source.includes("../ai")) {
    fail(`lib/games/${relative(join(ROOT, "lib", "games"), file)} imports lib/ai`);
  }
}

console.log("static guards passed");

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

const hasDeps =
  existsSync(join(ROOT, "node_modules", "vitest", "package.json")) &&
  existsSync(join(ROOT, "node_modules", "typescript", "package.json")) &&
  existsSync(join(ROOT, "node_modules", "server-only", "package.json"));

if (!hasDeps) {
  const status = run("npm", ["ci"]);
  if (status !== 0) {
    console.error("\nverify:ai-contract FAILED at dependency install");
    process.exit(status);
  }
}

// ---------------------------------------------------------------------------
// Contract suite + typecheck
// ---------------------------------------------------------------------------

let status = run(join(BIN, "vitest"), ["run", "tests/ai"]);
if (status !== 0) {
  console.error("\nverify:ai-contract FAILED at vitest run");
  process.exit(status);
}

status = run("npm", ["run", "typecheck"]);
if (status !== 0) {
  console.error("\nverify:ai-contract FAILED at typecheck");
  process.exit(status);
}

console.log("\nverify:ai-contract PASSED (static guards + vitest tests/ai + typecheck)");
