#!/usr/bin/env node
// OPT-IN real DeepSeek smoke, run with: REAL_DEEPSEEK_SMOKE=1 npm run verify:deepseek-smoke
//
// This is NOT part of `npm run verify:release` and never runs in CI. It is
// the only place in the repo that talks to the real DeepSeek API, and it
// refuses to start unless BOTH opt-ins are present:
//
//   - REAL_DEEPSEEK_SMOKE=1            (the explicit, out-of-band flag)
//   - DEEPSEEK_API_KEY=<your key>      (your product key — never the Orbit
//                                       task-runner's or any other provider's)
//
// What it does (and what it costs):
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. refuse a preset development DATABASE_URL explicitly
//   3. start a TRULY isolated throwaway Postgres (random compose project,
//      random port/db/user/password, tmpfs storage — postgres:16-alpine)
//   4. migrate from an EMPTY database (scripts/migrate.mjs)
//   5. production build (placeholder env) + standalone server with the REAL
//      key/base URL/model and AI_PROVIDER_ENABLED=1
//   6. one real user, one game, bounded advances until the FIRST batch of
//      provider-backed decisions completes (at most one quick6 batch: up to
//      5 decisions — a few hundred output tokens at the most)
//   7. assert: at least one game_ai_runs row with fallback=false,
//      provider='deepseek', prompt_version='prompt-v1' and ONLY sanitized
//      metadata; the same zero-leak value canaries as the release gate;
//      the API responses carry no internal state
//   8. abandon the game, stop the server, `docker compose down -v`,
//      remove the temp dir — on success AND failure
//
// Everything the provider sees is the same anonymized seat view the product
// always sends (HMAC user id, no names/emails/raw seat ids — P3.3).

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const NODE_BIN = process.execPath;
const BIN = path.join(ROOT, "node_modules", ".bin");

// ---------------------------------------------------------------------------
// The two explicit opt-ins
// ---------------------------------------------------------------------------

if ((process.env.REAL_DEEPSEEK_SMOKE ?? "").trim() !== "1") {
  console.error(
    "verify:deepseek-smoke is OPT-IN only. It makes REAL, BILLED calls to the\n" +
      "DeepSeek API and is never part of the release gate.\n" +
      "Run it explicitly with:\n\n" +
      "  REAL_DEEPSEEK_SMOKE=1 DEEPSEEK_API_KEY=<your product key> npm run verify:deepseek-smoke\n",
  );
  process.exit(1);
}
if ((process.env.DEEPSEEK_API_KEY ?? "").trim() === "") {
  console.error("verify:deepseek-smoke: DEEPSEEK_API_KEY is empty — export your product key first.");
  process.exit(1);
}
if ((process.env.AI_PROVIDER_ENABLED ?? "").trim() !== "" && !/^(1|true)$/i.test((process.env.AI_PROVIDER_ENABLED ?? "").trim())) {
  console.error("verify:deepseek-smoke: AI_PROVIDER_ENABLED is switched off — unset it (or set 1) first.");
  process.exit(1);
}

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/wikids";
const AUTH_SECRET = "verify-deepseek-smoke-0123456789abcdef0123456789abcdef";
const SMOKE_USER = { email: "smoke-deepseek@wikids.test", password: "smoke-pass-123" };
const FIXED_ROLES = ["WOLF", "VILLAGER", "WOLF", "SEER", "VILLAGER", "VILLAGER"];
const HUMAN_SEAT = 0;

// The same zero-leak value canaries the release gate enforces (see
// scripts/verify-api.mjs step 9.15): keys, PII, reasoning, private state.
const DB_PUBLIC_RE = "(sk-[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._\\-]{8,}|DEEPSEEK_API_KEY|GAME_SEAT_HMAC_SECRET|p6s-canary-[a-z0-9\\-]+|reasoning_content|\"serverState\"|\"pendingAiSeat\"|\"pendingSeats\"|\"NIGHT_SEER\"|\"NIGHT_WOLF\"|\"seedBytes\"|\"seedHex\"|\"systemPrivate\"|\"systemPrompt\"|\"promptText\"|AiProviderError|PersistenceError|IllegalActionError|OrchestrationConfigError|[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}|1[3-9][0-9]{9})";

const WIRE_CANARIES = [
  "serverState",
  "NIGHT_SEER",
  "NIGHT_WOLF",
  "pendingAiSeat",
  "pendingSeats",
  "seedBytes",
  "seedHex",
  "seed_hex",
  "nightWolfKills",
  "seerSubmitted",
  "nightSeerTarget",
  "PersistenceError",
  "AiProviderError",
  "DeepSeek",
  "deepseek",
  "DEEPSEEK_API_KEY",
  "GAME_SEAT_HMAC_SECRET",
  "claimToken",
  '"scope":"SYSTEM"',
  "game_system_private",
];

let failed = false;
let tempDir = null;
let projectName = null;
let composeFile = null;
let databaseUrl = null;
let dbName = null;
let dbUser = null;
const servers = [];

function step(name) {
  console.log(`\n=== ${name} ===`);
}

function ok(detail) {
  console.log(`  ✓ ${detail}`);
}

function fail(message) {
  console.error(`\n✗ verify:deepseek-smoke FAILED: ${message}`);
  failed = true;
}

function check(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

function tail(s, n = 2000) {
  const text = String(s);
  return text.length <= n ? text : `…${text.slice(-n)}`;
}

function run(cmd, args, { env = {}, cwd = ROOT, timeoutMs = 900_000 } = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env }, timeout: timeoutMs });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function freePort() {
  for (let port = 3200 + Math.floor(Math.random() * 20000); port < 64000; port++) {
    if (await canBind(port)) return port;
  }
  throw new Error("no free port");
}

async function waitFor(checkFn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await checkFn()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${what}${lastError ? ` (${lastError.message})` : ""}`);
}

function startServer(env, logName) {
  const child = spawn(NODE_BIN, [path.join(ROOT, ".next", "standalone", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(child);
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function cookieValue(setCookies, name) {
  for (const c of setCookies) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(";")[0];
  }
  return null;
}

function scanWire(label, text) {
  if (typeof text !== "string" || text.length === 0) return;
  for (const canary of WIRE_CANARIES) {
    if (text.includes(canary)) fail(`canary "${canary}" leaked in ${label}`);
  }
}

async function apiGet(base, cookie, pathname, label) {
  const { res, text, body } = await rawFetch(`${base}${pathname}`, {
    headers: cookie ? { cookie: `authjs.session-token=${cookie}` } : {},
  });
  scanWire(label, text);
  return { status: res.status, body, text };
}

async function apiPost(base, cookie, pathname, json, label) {
  const { res, text, body } = await rawFetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `authjs.session-token=${cookie}` } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  scanWire(label, text);
  return { status: res.status, body, text };
}

async function rawFetch(url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", ...opts });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { res, text, body };
}

async function signIn(base, user) {
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  const csrfBody = await csrfRes.json();
  const csrfCookie = cookieValue(csrfRes.headers.getSetCookie(), "authjs.csrf-token");
  const form = new URLSearchParams({ csrfToken: csrfBody.csrfToken, email: user.email, password: user.password });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `authjs.csrf-token=${csrfCookie}`,
    },
    body: form.toString(),
  });
  const sessionCookie = cookieValue(res.headers.getSetCookie(), "authjs.session-token");
  if (!sessionCookie) throw new Error(`sign-in for ${user.email} failed (status ${res.status})`);
  return sessionCookie;
}

/** A legal choice id → the command JSON (mirrors scripts/verify-api.mjs). */
function choiceToCommand(id) {
  let m = /^(wolf-kill|seer-check|day-vote)@(\d+):(\d+)$/.exec(id);
  if (m) {
    const type = {
      "wolf-kill": "SUBMIT_WOLF_KILL",
      "seer-check": "SUBMIT_SEER_CHECK",
      "day-vote": "SUBMIT_DAY_VOTE",
    }[m[1]];
    return { type, seat: Number(m[2]), target: Number(m[3]) };
  }
  m = /^skip@(\d+)$/.exec(id);
  if (m) return { type: "SUBMIT_SPEECH", seat: Number(m[1]), text: null };
  m = /^speech@(\d+)$/.exec(id);
  if (m) return { type: "SUBMIT_SPEECH", seat: Number(m[1]), text: "你好" };
  return null;
}

function psql(query) {
  const result = spawnSync(
    "docker",
    ["compose", "-p", projectName, "-f", composeFile, "exec", "-T", "pg", "psql", "-U", dbUser, "-d", dbName, "-t", "-A", "-c", query],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr ?? result.stdout}`);
  return (result.stdout ?? "").trim();
}

// ---------------------------------------------------------------- main flow

async function main() {
  step("toolchain");
  const hasDeps = existsSync(path.join(ROOT, "node_modules", "vitest", "package.json"));
  if (!hasDeps) {
    step("1 deps");
    const code = run("npm", ["ci"], { timeoutMs: 20 * 60_000 });
    if (code !== 0) throw new Error("npm ci failed");
  } else {
    ok("deps present");
  }

  step("2 development DATABASE_URL refusal");
  if (process.env.DATABASE_URL === DEV_DATABASE_URL) {
    throw new Error("refusing to run against the development database");
  }
  ok("no development DATABASE_URL preset");

  step("3 isolated throwaway Postgres (d7v_)");
  const suffix = randomBytes(4).toString("hex");
  projectName = `wikids-d7v-${suffix}`;
  dbName = `d7v_${suffix}`;
  dbUser = `d7v_${suffix}`;
  const dbPassword = randomBytes(12).toString("hex");
  const port = await freePort();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "wikids-d7v-"));
  composeFile = path.join(tempDir, "compose.yml");
  databaseUrl = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}`;
  writeFileSync(
    composeFile,
    `# Generated per-run by scripts/verify-deepseek-smoke.mjs — throwaway Postgres.
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
  let status = run("docker", ["compose", "-p", projectName, "-f", composeFile, "up", "-d", "--wait", "--wait-timeout", "120"], { timeoutMs: 150_000 });
  if (status !== 0) throw new Error("isolated Postgres failed to start");
  ok(`isolated Postgres up (project=${projectName} port=${port})`);

  step("4 migrate from zero");
  status = run(NODE_BIN, [path.join(ROOT, "scripts", "migrate.mjs")], {
    env: { DATABASE_URL: databaseUrl },
    timeoutMs: 120_000,
  });
  if (status !== 0) throw new Error("migration failed");
  ok("migrations applied to the empty database");

  step("5 provision user");
  status = run(NODE_BIN, [path.join(ROOT, "scripts", "create-user.mjs"), "--email", SMOKE_USER.email, "--password", SMOKE_USER.password], {
    env: { DATABASE_URL: databaseUrl },
    timeoutMs: 60_000,
  });
  if (status !== 0) throw new Error("user provisioning failed");
  ok(`provisioned ${SMOKE_USER.email}`);

  step("6 production build + standalone server (REAL provider config)");
  status = run("npm", ["run", "build"], {
    env: {
      DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
      AUTH_SECRET: "placeholder-build-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    timeoutMs: 900_000,
  });
  if (status !== 0) throw new Error("production build failed");
  const standaloneDir = path.join(ROOT, ".next", "standalone");
  const { cpSync } = await import("node:fs");
  rmSync(path.join(standaloneDir, ".next", "static"), { recursive: true, force: true });
  rmSync(path.join(standaloneDir, "public"), { recursive: true, force: true });
  cpSync(path.join(ROOT, ".next", "static"), path.join(standaloneDir, ".next", "static"), { recursive: true });
  cpSync(path.join(ROOT, "public"), path.join(standaloneDir, "public"), { recursive: true });
  ok("next build passed (standalone ready)");

  const webPort = await freePort();
  const base = `http://127.0.0.1:${webPort}`;
  startServer(
    {
      DATABASE_URL: databaseUrl,
      AUTH_SECRET,
      AUTH_URL: base,
      AUTH_TRUST_HOST: "true",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(webPort),
      HOSTNAME: "127.0.0.1",
      GAME_RATE_CREATE_PER_MINUTE: "60",
      GAME_RATE_ACTION_PER_MINUTE: "600",
      GAME_API_MAX_BODY_BYTES: "16384",
      // THE REAL PROVIDER — the only place in the repo that uses it.
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      DEEPSEEK_TIMEOUT_MS: process.env.DEEPSEEK_TIMEOUT_MS || "10000",
      DEEPSEEK_MAX_OUTPUT_TOKENS: process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || "256",
      GAME_SEAT_HMAC_SECRET: process.env.GAME_SEAT_HMAC_SECRET || AUTH_SECRET,
      AI_PROVIDER_ENABLED: "1",
      GAME_AI_GLOBAL_DAILY_CAP: "100",
    },
    "server-smoke.log",
  );
  await waitFor(async () => (await fetch(`${base}/sign-in`)).status === 200, 90_000, `the smoke server on ${base}`);
  ok(`server up on ${base} (real key, AI_PROVIDER_ENABLED=1)`);

  step("7 one game, bounded advances → first real provider-backed decisions");
  const cookie = await signIn(base, SMOKE_USER);
  ok("real Auth.js session cookie issued");

  const created = await apiPost(base, cookie, "/api/games/sessions", {
    gameDefinitionId: "quick6-v1",
    start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT },
  }, "create");
  check(created.status === 201, `create -> 201 (got ${created.status}: ${created.text.slice(0, 160)})`);
  if (created.status !== 201) return;
  const sessionId = created.body.sessionId;
  let revision = created.body.revision ?? 0;

  let providerDecisions = 0;
  let sawTerminalAiRun = false;
  for (let i = 0; i < 6 && !sawTerminalAiRun; i++) {
    const adv = await apiPost(base, cookie, `/api/games/sessions/${sessionId}/advance`, {
      sinceRevision: Math.max(revision, 0),
    }, `advance #${i}`);
    check([200, 202].includes(adv.status), `advance #${i} -> 200/202 (got ${adv.status}: ${adv.text.slice(0, 160)})`);
    if (![200, 202].includes(adv.status)) break;
    revision = adv.body?.revision ?? revision;

    // Poll for this batch's AI runs to reach a terminal status. A REAL call
    // finishes as fallback=false; a network failure would leave fallback=true
    // (and this smoke would then fail — that is the point of the smoke).
    for (let poll = 0; poll < 20; poll++) {
      const terminal = psql(`select count(*)::int from game_ai_runs where session_id = '${sessionId}' and status in ('succeeded','failed','timeout')`);
      const real = psql(`select count(*)::int from game_ai_runs where session_id = '${sessionId}' and fallback = false`);
      if (terminal !== "0") {
        sawTerminalAiRun = true;
        providerDecisions = Number(real);
        break;
      }
      await sleep(1000);
    }

    // The human seat may owe an action; answer with the first legal choice
    // (mirrors the release gate's driver) so the next advance can continue.
    if (Array.isArray(adv.body?.legalActions) && adv.body.legalActions.length > 0 && !sawTerminalAiRun) {
      const choice = adv.body.legalActions[0];
      const command = choiceToCommand(choice.id);
      if (command === null) throw new Error(`legal action ${choice.id} does not map to a command`);
      const act = await apiPost(base, cookie, `/api/games/sessions/${sessionId}/actions`, {
        idempotencyKey: `smoke-${adv.body.revision}-${choice.id}`,
        expectedRevision: adv.body.revision,
        phaseToken: adv.body.phaseToken,
        command,
      }, `action ${choice.id}`);
      check(act.status === 200, `action ${choice.id} -> 200 (got ${act.status})`);
      if (act.status === 200) revision = act.body?.revision ?? revision;
    }
    await sleep(1000);
  }
  check(sawTerminalAiRun, "at least one provider-backed decision completed");
  check(providerDecisions >= 1, `at least one REAL provider decision (fallback=false): ${providerDecisions}`);

  step("8 sanitized metadata + zero-leak database canaries");
  const row = psql(
    `select provider || '|' || requested_model || '|' || response_model || '|' || prompt_version || '|' || coalesce(error_code,'') || '|' || fallback from game_ai_runs where session_id = '${sessionId}' and fallback = false limit 1`,
  );
  const [provider, requestedModel, responseModel, promptVersion, errorCode, isFallback] = row.split("|");
  check(provider === "deepseek", `provider column is 'deepseek' (got ${JSON.stringify(provider)})`);
  check(requestedModel === (process.env.DEEPSEEK_MODEL || "deepseek-chat"), `requested_model is the configured model (got ${JSON.stringify(requestedModel)})`);
  check(responseModel !== "" && responseModel !== null, `response_model recorded (got ${JSON.stringify(responseModel)})`);
  check(promptVersion === "prompt-v1", `prompt_version is the frozen policy stamp (got ${JSON.stringify(promptVersion)})`);
  check(errorCode === "", `no error code on a real decision (got ${JSON.stringify(errorCode)})`);
  check(isFallback === "f", `fallback=false (got ${JSON.stringify(isFallback)})`);
  const aiRunHits = psql(
    `select 'ai_runs:' || id from game_ai_runs where concat(coalesce(provider,''),coalesce(requested_model,''),coalesce(response_model,''),coalesce(response_id,''),coalesce(system_fingerprint,''),coalesce(prompt_version,''),coalesce(error_code,'')) ~ '${DB_PUBLIC_RE}'`,
  );
  check(aiRunHits === "", `game_ai_runs metadata: zero canary values${aiRunHits ? ` — HITS: ${tail(aiRunHits)}` : ""}`);
  const eventHits = psql(`select 'event:' || session_id || ':' || seq from game_events where payload::text ~ '${DB_PUBLIC_RE}'`);
  check(eventHits === "", `game_events payloads: zero canary values${eventHits ? ` — HITS: ${tail(eventHits)}` : ""}`);
  ok("real provider traffic left ONLY sanitized metadata behind");

  step("9 abandon + cleanup is in finally");
  const abandon = await apiPost(base, cookie, `/api/games/sessions/${sessionId}/abandon`, undefined, "abandon");
  check(abandon.status === 200, `abandon -> 200 (got ${abandon.status})`);
}

// ---------------------------------------------------------------- cleanup

async function cleanup() {
  for (const child of servers) await stopServer(child);
  if (projectName && composeFile) {
    console.log("\n$ docker compose down -v (cleanup)");
    const result = spawnSync(
      "docker",
      ["compose", "-p", projectName, "-f", composeFile, "down", "-v", "--remove-orphans", "--timeout", "5"],
      { cwd: ROOT, stdio: "inherit" },
    );
    if (result.status !== 0) {
      console.error("cleanup: docker compose down failed");
      failed = true;
    }
    const ps = spawnSync("docker", ["compose", "-p", projectName, "-f", composeFile, "ps", "-q"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const remaining = (ps.stdout ?? "").trim();
    if (remaining !== "") {
      console.error(`cleanup: containers still running: ${remaining}`);
      failed = true;
    } else {
      console.log("  ✓ no containers remain for this project");
    }
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log("  ✓ temp dir removed");
  }
}

main()
  .catch((error) => {
    console.error(`\nVERIFICATION FAILED: ${error?.stack ?? error}`);
    failed = true;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed ? "\n✗ verify:deepseek-smoke FAILED" : "\n✓ verify:deepseek-smoke PASSED (real provider round-trip)");
    process.exit(failed ? 1 : 0);
  });
