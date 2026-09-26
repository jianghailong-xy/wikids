#!/usr/bin/env node
// P7.2 one-click release gate, run with: npm run verify:release
//
// The single command CI and a release both run. Serial steps, each must
// pass (any failure cleans up in `finally` and exits non-zero):
//
//   0. Node 20 enforcement: the gate re-execs itself under Node 20 through
//      nvm when the invoking interpreter is not Node 20 (CI pins Node 20
//      directly via actions/setup-node, so this only fires locally).
//   1. credential isolation: a preset real DEEPSEEK_API_KEY is REFUSED —
//      the release gate proves the no-key / switch-off fallback path only.
//      Real-provider traffic is the explicit opt-in
//      `npm run verify:deepseek-smoke` (REAL_DEEPSEEK_SMOKE=1 + a key) and
//      is never part of this gate. Product code (lib/, app/) must never
//      read Orbit runner / other-provider credentials: static guard = 0.
//   2. npm ci                      — clean install from the lockfile
//   3. npm audit --omit=dev --audit-level=high — 0 high / 0 critical
//   4. npm run typecheck           — tsc --noEmit over the whole repo
//   5. npm run verify:engine       — quick6-v1 rule spec, fast-check
//                                    properties, >=1000-seed scripted-bot
//                                    simulations, domain import boundary
//                                    (hermetic: no DB, no browser, no key)
//   6. npm run verify:domain-security — the visibility canary matrix and
//                                    deterministic event replay
//   7. npm run verify:ai-contract  — the P3.3 provider contract (mock fetch)
//   8. npm run verify:ai-orchestration — the P4.1 fallback through every
//                                    fault / switch-off / no-key path
//                                    against an isolated Postgres
//   9. npm run verify:game-safety  — P6.3 budgets, global meter, emergency
//                                    switch, sanitized AI metadata, 30-day
//                                    retention (isolated Postgres)
//  10. npm run verify:security-baseline — prod audit, Auth.js smoke,
//                                    migration idempotence (isolated PG)
//  11. npm run verify:persistence  — isolated Postgres, migration from
//                                    zero, snapshot recovery
//  12. npm run verify:api          — isolated DB + the P5.1 black-box API
//                                    suite, DB outage → 502, wire canaries
//                                    AND database-value canaries = 0
//  13. npm run verify:game-ui      — Chromium E2E with a real Auth.js
//                                    cookie and a local fake provider
//  14. npm run build               — production build (placeholder env,
//                                    mirrors the Dockerfile builder)
//  15. .next/static canary scan    — keys / PII / reasoning / private
//                                    prompt / server-state tokens = 0 hits
//  16. log canary scan             — this run's full output = 0 hits
//  17. resource sweep              — no verify containers, volumes or
//                                    browser processes remain
//
// Every DB-touching step spins its OWN throwaway Postgres (random compose
// project, random port/db/user/password, tmpfs storage) and tears it down
// in `finally` on success AND failure. The gate itself never touches the
// development database and never carries a real provider credential:
// DEEPSEEK_*, GAME_SEAT_HMAC_SECRET, AUTH_SECRET and Orbit / other-provider
// credentials are stripped from every child environment.
//
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Step 0: Node 20 enforcement
// ---------------------------------------------------------------------------

const REQUIRED_NODE_MAJOR = 20;

if (Number.parseInt(process.versions.node.split(".")[0], 10) !== REQUIRED_NODE_MAJOR) {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const nvmSh = path.join(nvmDir, "nvm.sh");
  if (!existsSync(nvmSh)) {
    console.error(
      `verify:release requires Node ${REQUIRED_NODE_MAJOR} (running ${process.version}) and nvm was not found at ${nvmSh}`,
    );
    process.exit(1);
  }
  console.log(
    `verify:release: running under Node ${process.version}; re-execing under Node ${REQUIRED_NODE_MAJOR} via nvm…`,
  );
  const script = [
    `export NVM_DIR=${JSON.stringify(nvmDir)}`,
    `. ${JSON.stringify(nvmSh)}`,
    `nvm install ${REQUIRED_NODE_MAJOR} --no-progress >/dev/null 2>&1 || true`,
    `nvm exec ${REQUIRED_NODE_MAJOR} node ${JSON.stringify(SELF)} "$@"`,
  ].join("\n");
  const reexec = spawnSync("bash", ["-lc", script, "verify-release", ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(reexec.status ?? 1);
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

let failed = false;
let tempDir = null;
let logPath = null;

function step(name) {
  console.log(`\n${"=".repeat(72)}\n=== verify:release / ${name} ===\n${"=".repeat(72)}`);
}

function ok(detail) {
  console.log(`  ✓ ${detail}`);
}

function fail(message) {
  console.error(`\n✗ verify:release FAILED at: ${message}`);
  failed = true;
}

// Every provider / runner / auth credential is stripped from children: the
// gate must pass with NO DeepSeek key, and Orbit task-runner credentials
// must never be visible to (let alone reused by) the product runtime.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(DEEPSEEK_|ORBIT_|ANTHROPIC_|OPENAI_|MISTRAL_|GEMINI_)/.test(key) ||
      /^NEXT_PUBLIC_(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|MISTRAL)/.test(key)
    ) {
      delete env[key];
    }
  }
  delete env.GAME_SEAT_HMAC_SECRET;
  delete env.AUTH_SECRET;
  delete env.REAL_DEEPSEEK_SMOKE;
  return env;
}

/**
 * Run a command, streaming its output to this process AND into the gate
 * log (for the step-16 log canary scan). Resolves with the exit code.
 */
function run(cmd, args, { env = {}, timeoutMs = 15 * 60_000 } = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...cleanEnv(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      console.error(`\n✗ step timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd} ${args.join(" ")}`);
      failed = true;
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (logPath) writeLog(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      if (logPath) writeLog(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`\n✗ failed to spawn ${cmd}: ${error.message}`);
      failed = true;
      resolve(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

let logFd = null;
function writeLog(chunk) {
  if (logFd === null) return;
  try {
    // Synchronous append: pipe chunks are small and ordered; the scan reads
    // what was written.
    writeSync(logFd, chunk);
  } catch {
    // best effort
  }
}

async function gateStep(name, cmd, args, opts) {
  step(name);
  const code = await run(cmd, args, opts);
  if (code !== 0) fail(`${name} (${cmd} ${args.join(" ")}) exited ${code}`);
  else ok(`${name} passed`);
  return code;
}

// ---------------------------------------------------------------------------
// Canary scanning (steps 15/16)
// ---------------------------------------------------------------------------

// Leak-shaped patterns only: JSON-key-shaped or credential-shaped, so test
// NAMES and prose that merely mention these words ("serverState, name, …")
// never false-positive. Each regex must match how a REAL leak looks:
// a serialized key, a credential, a planted fixture token or PII.
const LEAK_PATTERNS = [
  { label: "deepseek key", re: /\bsk-[A-Za-z0-9]{8,}\b/ },
  { label: "bearer credential", re: /\bBearer [A-Za-z0-9._\-]{8,}/ },
  { label: "server env name", re: /DEEPSEEK_API_KEY|GAME_SEAT_HMAC_SECRET/ },
  { label: "server state key", re: /"serverState"\s*:/ },
  { label: "seed key", re: /"seedBytes"\s*:|"seedHex"\s*:|"seed_hex"\s*:/ },
  { label: "pending-AI key", re: /"pendingAiSeat"\s*:|"pendingSeats"\s*:/ },
  { label: "night sub-phase key", re: /"NIGHT_SEER"\s*:|"NIGHT_WOLF"\s*:/ },
  {
    label: "night buffer key",
    re: /"nightWolfKills"\s*:|"seerSubmitted"\s*:|"nightSeerTarget"\s*:/,
  },
  { label: "system private", re: /"systemPrivate"|"game_system_private"/ },
  { label: "reasoning content", re: /reasoning_content|"reasoningTokens"\s*:/ },
  { label: "private prompt key", re: /"systemPrompt"\s*:|"promptText"\s*:/ },
  { label: "planted canary token", re: /p6s-canary-[a-z0-9\-]+/ },
  {
    label: "serialized internal error",
    // JSON-key-shaped on purpose: test names legitimately SAY
    // "PersistenceError exposes …" — a real leak looks like a serialized
    // error field, e.g. {"error":"STALE_REVISION"}.
    re: /"(?:error|code|type)"\s*:\s*"(?:PersistenceError|AiProviderError|IllegalActionError|OrchestrationConfigError|ProviderTimeout)"/,
  },
];

const FIXTURE_EMAIL_HOST = "wikids.test"; // fixture identities may be printed

function scanText(label, text, extraPatterns = []) {
  let hits = 0;
  for (const { label: patternLabel, re } of [...LEAK_PATTERNS, ...extraPatterns]) {
    const matches = text.match(re);
    if (matches) {
      hits += 1;
      console.error(
        `  ✗ ${label}: leaked ${patternLabel} (${matches.length}×, sample: ${JSON.stringify(matches[0])})`,
      );
    }
  }
  return hits;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

/** Email PII, excluding the fixture domain (only used to sign in). */
function scanEmails(label, text) {
  let hits = 0;
  for (const line of String(text).split("\n")) {
    // npm's own deprecation notices carry maintainer contact emails by
    // design (e.g. "contacting i@izs.me") — toolchain chatter, never an
    // application leak.
    if (line.startsWith("npm warn")) continue;
    for (const match of line.matchAll(EMAIL_PATTERN)) {
      if (match[0].toLowerCase().endsWith(`@${FIXTURE_EMAIL_HOST}`)) continue;
      hits += 1;
      console.error(`  ✗ ${label}: leaked non-fixture email PII: ${match[0]}`);
    }
  }
  return hits;
}

function scanStatic() {
  step("15 .next/static canary scan");
  const staticDir = path.join(ROOT, ".next", "static");
  if (!existsSync(staticDir)) {
    fail(".next/static is missing after the production build");
    return;
  }
  const TEXT_EXTS = new Set([".js", ".css", ".html", ".txt", ".json", ".webmanifest", ".xml", ".map"]);
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TEXT_EXTS.has(path.extname(entry.name))) files.push(full);
    }
  })(staticDir);
  let hits = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable — skipped
    }
    const rel = path.relative(ROOT, file);
    const localHits = scanText(`.next/static ${rel}`, text);
    if (localHits === 0) continue;
    hits += localHits;
  }
  let emailHits = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    emailHits += scanEmails(`.next/static ${path.relative(ROOT, file)}`, text);
  }
  hits += emailHits;
  if (hits > 0) fail(`.next/static canary scan: ${hits} leak(s)`);
  else ok(`scanned ${files.length} text assets in .next/static — 0 hits`);
}

function scanLog() {
  step("16 log canary scan");
  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    fail(`gate log is unreadable: ${logPath}`);
    return;
  }
  let hits = scanText("gate log", text);
  hits += scanEmails("gate log", text);
  if (hits > 0) fail(`gate log canary scan: ${hits} leak(s) in ${logPath}`);
  else ok(`gate log (${Math.round(text.length / 1024)} KiB) — 0 hits`);
}

// ---------------------------------------------------------------------------
// Step 17: resource sweep
// ---------------------------------------------------------------------------

function sweep() {
  step("17 resource sweep");
  const prefixes = ["wikids-p3v", "wikids-p4v", "wikids-p5v", "wikids-p6v", "wikids-p6s", "wikids-d7v", "wikids-verify-pg"];
  let leftovers = 0;
  for (const prefix of prefixes) {
    for (const kind of ["containers", "volumes"]) {
      const args =
        kind === "containers"
          ? ["ps", "-aq", "--filter", `name=${prefix}`]
          : ["volume", "ls", "-q", "--filter", `name=${prefix}`];
      const result = spawnSync("docker", args, { cwd: ROOT, encoding: "utf8" });
      const remaining = (result.stdout ?? "").trim();
      if (remaining !== "") {
        leftovers += 1;
        console.error(`  ✗ ${kind} matching ${prefix} remain: ${remaining}`);
      }
    }
  }
  const procs = spawnSync("pgrep", ["-f", "ms-playwright.*chrom|fake-provider\\.mjs|node server\\.js"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const stray = (procs.stdout ?? "").trim();
  if (stray !== "") {
    leftovers += 1;
    console.error(`  ✗ stray verify processes remain: ${stray}`);
  }
  if (leftovers > 0) fail(`resource sweep: ${leftovers} leftover(s)`);
  else ok("no verify containers, volumes or browser/server processes remain");
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  const start = Date.now();
  step("toolchain");
  ok(`node ${process.version} (major ${REQUIRED_NODE_MAJOR} enforced), npm ${await npmVersion()}`);

  // ----- 1. credential isolation -----
  step("1 credential isolation");
  if ((process.env.DEEPSEEK_API_KEY ?? "").trim() !== "") {
    fail(
      "a real DEEPSEEK_API_KEY is set in the environment. The release gate " +
        "proves the no-key / switch-off fallback path only — real-provider " +
        "traffic is the explicit opt-in `npm run verify:deepseek-smoke` " +
        "(REAL_DEEPSEEK_SMOKE=1). Unset DEEPSEEK_API_KEY and re-run.",
    );
  } else {
    ok("no real DeepSeek key in the environment (fallback path is what this gate proves)");
  }
  const credReads = spawnSync(
    "grep",
    ["-rnE", "process\\.env\\.(ORBIT_|ANTHROPIC_|OPENAI_|MISTRAL_|GEMINI_)", "lib", "app"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (credReads.status === 0 || (credReads.stdout ?? "") !== "") {
    fail(`product code reads Orbit runner / other-provider credentials:\n${credReads.stdout}`);
  } else {
    ok("product code (lib/, app/) never reads Orbit or other-provider credentials");
  }

  // ----- 2..14: the gate steps -----
  tempDir = mkdtempSync(path.join(os.tmpdir(), "wikids-release-"));
  logPath = path.join(tempDir, "release.log");
  logFd = openSync(logPath, "a");

  const runStep = async (name, cmd, args, opts) => {
    if (failed) return; // fail fast: later steps assume earlier ones held
    await gateStep(name, cmd, args, opts);
  };

  await runStep("2 npm ci (clean install)", "npm", ["ci"], { timeoutMs: 20 * 60_000 });
  await runStep("3 npm audit (prod)", "npm", ["audit", "--omit=dev", "--audit-level=high"], { timeoutMs: 10 * 60_000 });
  await runStep("4 typecheck", "npm", ["run", "typecheck"], { timeoutMs: 10 * 60_000 });
  await runStep("5 rules / property / 1000-seed", "npm", ["run", "verify:engine"], { timeoutMs: 20 * 60_000 });
  await runStep("6 visibility / replay", "npm", ["run", "verify:domain-security"], { timeoutMs: 20 * 60_000 });
  await runStep("7 AI contract", "npm", ["run", "verify:ai-contract"], { timeoutMs: 15 * 60_000 });
  await runStep("8 AI orchestration / fallback", "npm", ["run", "verify:ai-orchestration"], { timeoutMs: 25 * 60_000 });
  await runStep("9 budgets / safety", "npm", ["run", "verify:game-safety"], { timeoutMs: 25 * 60_000 });
  await runStep("10 security baseline", "npm", ["run", "verify:security-baseline"], { timeoutMs: 30 * 60_000 });
  await runStep("11 isolated DB", "npm", ["run", "verify:persistence"], { timeoutMs: 20 * 60_000 });
  await runStep("12 isolated DB + API", "npm", ["run", "verify:api"], { timeoutMs: 30 * 60_000 });
  await runStep("13 Chromium UI E2E", "npm", ["run", "verify:game-ui"], { timeoutMs: 30 * 60_000 });
  await runStep("14 production build", "npm", ["run", "build"], {
    timeoutMs: 30 * 60_000,
    env: {
      DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
      AUTH_SECRET: "placeholder-build-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  // ----- 15..17: the gate's own canary scans + sweep -----
  scanStatic();
  scanLog();
  sweep();

  const minutes = ((Date.now() - start) / 60_000).toFixed(1);
  console.log(`\nverify:release finished in ${minutes} min`);
  return failed ? 1 : 0;
}

async function npmVersion() {
  try {
    const { execFileSync } = await import("node:child_process");
    return execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const exitCode = await main().catch((error) => {
  console.error(`\n✗ verify:release crashed: ${error?.stack ?? error}`);
  return 1;
});

if (logFd !== null) {
  try {
    logFd.close();
  } catch {
    // best effort
  }
}

if (exitCode !== 0 || failed) {
  console.error("\n✗ verify:release FAILED");
  if (tempDir && logPath) {
    console.error(`  diagnostics kept at: ${logPath}`);
    console.error(`  temp dir kept for triage: ${tempDir}`);
  }
  process.exit(1);
} else {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log("  ✓ gate temp dir (log + fixtures) removed");
  }
  console.log("\n✓ verify:release PASSED");
  process.exit(0);
}
