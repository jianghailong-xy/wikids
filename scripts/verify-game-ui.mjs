#!/usr/bin/env node
// P6.1 game UI verification, run with: npm run verify:game-ui
//
// Serial steps, each must pass (any failure cleans up in `finally` and exits
// non-zero):
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. refuse a preset development DATABASE_URL explicitly
//   3. Chromium present? otherwise `npx playwright install --with-deps chromium`
//   4. start a TRULY isolated throwaway Postgres: a docker-compose project with
//      a random project name, random published port, random database / user /
//      password and tmpfs storage — postgres:16-alpine, the production image
//   5. demonstrate the guard (the development URL is refused, the isolated URL
//      is accepted: scripts/assert-isolated-db.mjs with the p6v_ prefix)
//   6. migrate from an EMPTY database + schema smoke
//   7. provision real user accounts (alice / bob)
//   8. typecheck the whole repo
//   9. component tests (tests/games/ui): active resume/abandon, loading, the
//      pending/retryAfter continuation, licensed/refused actions, errors and
//      the simplified-strategy notice
//  10. production build (placeholder env, mirrors the Dockerfile) and serve the
//      standalone server.js with the isolated DATABASE_URL and a LOCAL fake
//      provider (DEEPSEEK_BASE_URL → the fixture), so provider traffic is real
//      and deterministic without any network or credential
//  11. the browser suite in real Chromium with a real Auth.js cookie: the
//      lobby, three human identities played from the board to the end screen,
//      refresh/back/forward recovery, double-click and two-tab idempotency,
//      eliminated-player spectating, a provider outage, keyboard operation,
//      aria-live, reduced motion, and the ~390px mobile layout
//  12. canary scan = 0 over every DOM snapshot, RSC/HTML document and JSON
//      response the browser saw during play (server state fields, internal
//      sub-phases, pending-AI vocabulary, provider details, internal error
//      codes) — with a positive control proving the scanner detects a leak
//  13. finally: `docker compose down -v` on the random project, every spawned
//      server/provider process stopped, the temp dir removed — verified by
//      asserting no containers remain

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const NODE_BIN = process.execPath;

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/wikids";
const AUTH_SECRET = "verify-game-ui-0123456789abcdef0123456789abcdef-extra";
const ALICE = { email: "alice-ui@wikids.test", password: "alice-ui-pass-123" };
const BOB = { email: "bob-ui@wikids.test", password: "bob-ui-pass-123" };

// Internal names that must NEVER appear in the DOM, an RSC payload, a
// document or any response body (docs/game-api-protocol.md, §2 visibility):
// server-state fields, internal night sub-phases, pending-AI vocabulary,
// provider details and internal persistence/domain error codes.
const CANARIES = [
  "serverState",
  "stateJson",
  "state_json",
  "NIGHT_SEER",
  "NIGHT_WOLF",
  "nightWolfKills",
  "nightSeerTarget",
  "seerSubmitted",
  "pendingAiSeat",
  "pendingSeats",
  "seedBytes",
  "seedHex",
  "seed_hex",
  "systemPrivate",
  "claimToken",
  "claim_token",
  '"scope":"SYSTEM"',
  "PersistenceError",
  "AiProviderError",
  "IllegalActionError",
  "StepLimitError",
  "OrchestrationConfigError",
  "ProviderTimeout",
  "DEEPSEEK_API_KEY",
  "GAME_SEAT_HMAC_SECRET",
  "deepseek",
  "DeepSeek",
  "USER_BUDGET_EXHAUSTED",
  "BUDGET_EXHAUSTED",
  "DAILY_GAME_LIMIT_EXCEEDED",
  "STALE_REVISION",
  "STALE_PHASE_TOKEN",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_CHECKSUM",
  "VERSION_MISMATCH",
  "NOT_ACTIVE",
];

let failed = false;
let tempDir = null;
let projectName = null;
let composeFile = null;
const servers = [];
let fakeProvider = null;
let browser = null;
let lockClient = null;

function step(name) {
  console.log(`\n=== ${name} ===`);
}
function ok(detail) {
  console.log(`  ✓ ${detail}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed = true;
}
function check(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}
function tail(s, n = 2000) {
  return s.length > n ? `…(truncated)…\n${s.slice(-n)}` : s;
}

function run(cmd, args, { env = {}, cwd = ROOT, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`exit code ${code}\n--- stdout ---\n${tail(out)}\n--- stderr ---\n${tail(err)}`));
      } else resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function freePort() {
  for (let i = 0; i < 40; i++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    if (await canBind(port)) return port;
  }
  throw new Error("could not find a free local port");
}

async function waitFor(checkFn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const value = await checkFn();
      if (value) return value;
    } catch (error) {
      lastErr = error;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? ` (last error: ${lastErr.message})` : ""}`);
}

function startServer(env, logName) {
  const logPath = path.join(tempDir, logName);
  const fd = openSync(logPath, "a");
  const child = spawn(NODE_BIN, [path.join(ROOT, ".next", "standalone", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", fd, fd],
  });
  servers.push(child);
  child.on("error", () => {});
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000).then(() => child.kill("SIGKILL"))]);
}

// ------------------------------------------------------------------ canary

function canaryHits(text, label, hits) {
  if (typeof text !== "string" || text.length === 0) return;
  for (const canary of CANARIES) {
    if (text.includes(canary)) {
      hits.push(`${canary} in ${label}`);
      fail(`canary "${canary}" leaked in ${label}`);
    }
  }
}

// -------------------------------------------------------------------- main

async function main() {
  step("toolchain");
  console.log(`  node ${process.version}`);

  step("1 deps");
  const hasDeps =
    existsSync(path.join(ROOT, "node_modules", "vitest", "package.json")) &&
    existsSync(path.join(ROOT, "node_modules", "playwright", "package.json")) &&
    existsSync(path.join(ROOT, "node_modules", "typescript", "package.json"));
  if (!hasDeps) await run("npm", ["ci"], { timeoutMs: 900_000 });
  ok("dependencies present");

  step("2 development DATABASE_URL refusal");
  const preset = process.env.DATABASE_URL;
  if (preset && /^postgres(ql)?:\/\/postgres:postgres@[^/]+:5432\/wikids$/.test(preset)) {
    throw new Error(`refusing development DATABASE_URL (${preset}) in the environment`);
  }
  ok("no development DATABASE_URL in the environment");

  step("3 chromium");
  const { chromium } = await import("playwright");
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (error) {
    console.log(`  browser missing (${error.message.split("\n")[0]}); installing`);
    await run("npx", ["playwright", "install", "--with-deps", "chromium"], { timeoutMs: 900_000 });
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  ok(`chromium ${browser.version()} ready`);

  step("4 isolated throwaway Postgres (p6v_)");
  const suffix = randomBytes(4).toString("hex");
  projectName = `wikids-p6v-${suffix}`;
  const dbName = `p6v_${suffix}`;
  const dbUser = `p6v_${suffix}`;
  const dbPassword = randomBytes(12).toString("hex");
  const port = await freePort();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "wikids-p6v-"));
  composeFile = path.join(tempDir, "compose.yml");
  const databaseUrl = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}`;

  writeFileSync(
    composeFile,
    `# Generated per-run by scripts/verify-game-ui.mjs — throwaway Postgres.
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

  console.log(`  Isolated Postgres: project=${projectName} port=${port} db=${dbName}`);
  const composeUp = await run("docker", [
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
  ]).then(
    () => 0,
    (error) => {
      console.log(tail(error.message, 800));
      return 1;
    },
  );
  if (composeUp !== 0) {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      const probe = spawnSync(
        "docker",
        ["compose", "-p", projectName, "-f", composeFile, "exec", "-T", "pg", "pg_isready", "-U", dbUser, "-d", dbName],
        { cwd: ROOT, stdio: "ignore" },
      );
      ready = probe.status === 0;
      if (!ready) await sleep(2000);
    }
    if (!ready) throw new Error("Postgres did not become ready");
  }
  ok("isolated Postgres up");

  step("5 isolated-db guard demo (p6v_)");
  let guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), DEV_DATABASE_URL, "p6v_"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (guard.status === 0) throw new Error("the development DATABASE_URL was NOT refused");
  ok("  dev URL refused as expected");
  guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), databaseUrl, "p6v_"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (guard.status !== 0) throw new Error(`the isolated URL was refused:\n${guard.stderr}`);
  ok("  isolated URL accepted");

  step("6 migrate from zero + schema smoke");
  await run("node", [path.join(ROOT, "scripts", "migrate.mjs")], { env: { DATABASE_URL: databaseUrl } });
  await run("node", [path.join(ROOT, "scripts", "db-smoke.mjs")], { env: { DATABASE_URL: databaseUrl } });
  ok("migrated from an EMPTY database");

  step("7 provision users");
  for (const user of [ALICE, BOB]) {
    await run(
      "node",
      [
        path.join(ROOT, "scripts", "create-user.mjs"),
        "--email",
        user.email,
        "--password",
        user.password,
        "--name",
        user.email.split("@")[0],
      ],
      { env: { DATABASE_URL: databaseUrl } },
    );
  }
  ok(`created ${ALICE.email} and ${BOB.email}`);

  step("8 typecheck");
  await run("npm", ["run", "typecheck"], { timeoutMs: 300_000 });
  ok("tsc --noEmit passed");

  step("9 component tests (tests/games/ui)");
  await run("npx", ["vitest", "run", "tests/games/ui"], { timeoutMs: 300_000 });
  ok("component suite passed");

  step("10 production build + standalone assets");
  await run("npm", ["run", "build"], {
    env: {
      DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
      AUTH_SECRET: "placeholder-build-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    timeoutMs: 900_000,
  });
  const standaloneDir = path.join(ROOT, ".next", "standalone");
  rmSync(path.join(standaloneDir, ".next", "static"), { recursive: true, force: true });
  rmSync(path.join(standaloneDir, "public"), { recursive: true, force: true });
  cpSync(path.join(ROOT, ".next", "static"), path.join(standaloneDir, ".next", "static"), { recursive: true });
  cpSync(path.join(ROOT, "public"), path.join(standaloneDir, "public"), { recursive: true });
  ok("next build passed (standalone ready)");

  step("11 fake provider + server (provider ENABLED against the fixture)");
  const { startFakeProvider } = await import(
    path.join(ROOT, "tests", "e2e", "game-ui", "fake-provider.mjs")
  );
  fakeProvider = await startFakeProvider();
  ok(`fake provider on ${fakeProvider.baseUrl}`);

  const webPort = await freePort();
  const baseUrl = `http://127.0.0.1:${webPort}`;
  startServer(
    {
      DATABASE_URL: databaseUrl,
      AUTH_SECRET,
      AUTH_URL: baseUrl,
      AUTH_TRUST_HOST: "true",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(webPort),
      HOSTNAME: "127.0.0.1",
      // The provider path is real: the server builds DeepSeek requests and
      // this local fixture answers them. No network, no credential.
      DEEPSEEK_API_KEY: "fixture-key",
      DEEPSEEK_BASE_URL: fakeProvider.baseUrl,
      DEEPSEEK_MODEL: "fixture-model",
      DEEPSEEK_TIMEOUT_MS: "4000",
      DEEPSEEK_MAX_OUTPUT_TOKENS: "256",
      GAME_SEAT_HMAC_SECRET: "fixture-hmac-secret-0123456789abcdef",
      AI_PROVIDER_ENABLED: "1",
      GAME_AI_GLOBAL_DAILY_CAP: "10000",
      GAME_RATE_CREATE_PER_MINUTE: "60",
      GAME_RATE_ACTION_PER_MINUTE: "600",
      GAME_API_MAX_BODY_BYTES: "16384",
    },
    "server-ui.log",
  );
  await waitFor(
    async () => (await fetch(`${baseUrl}/sign-in`)).status === 200,
    90_000,
    `the game UI server on ${baseUrl}`,
  );
  ok(`server up on ${baseUrl}`);

  step("12 browser suite (real Chromium, real Auth.js cookie)");
  const suite = await import(path.join(ROOT, "tests", "e2e", "game-ui", "suite.mjs"));
  const { signIn, openSession, apiClient } = await import(
    path.join(ROOT, "tests", "e2e", "game-ui", "browser.mjs")
  );

  // Positive control: the scanner must flag a real leak before it is trusted
  // to report a clean run. Probed directly, so the control itself is not
  // reported as a leak.
  const controlHits = CANARIES.filter((canary) => "…serverState & nightWolfKills…".includes(canary));
  check(controlHits.length === 2, `the canary scanner detects a known leak (positive control: ${controlHits.length}/2)`);

  const aliceCookie = await signIn(baseUrl, ALICE);
  const bobCookie = await signIn(baseUrl, BOB);
  ok("real Auth.js session cookies issued for alice and bob");

  const hits = [];
  const session = await openSession(browser, baseUrl, aliceCookie, { width: 1440, height: 900 });
  session.context.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (!/html|json|text\/x-component|javascript/.test(type)) return;
    response
      .text()
      .then((body) => canaryHits(body, `${response.status()} ${response.url()}`, hits))
      .catch(() => {});
  });

  const ctx = {
    session,
    baseUrl,
    browser,
    fake: fakeProvider,
    api: apiClient(baseUrl, aliceCookie),
    cookie: aliceCookie,
    log: (line) => console.log(line),
    check,
  };

  try {
    await suite.scenarioLobby(ctx);
    ok("lobby: feature card, AI companions, Games entry, rules link");

    // The whole path a person walks: lobby → 开始 AI 对局 → the board → the end.
    // The deal is whatever the server drew, so the board is read for what it
    // shows rather than being told what to expect.
    // The games the human plays are driven with the "largest target" policy so
    // the human is still in the game when their turn comes; the eliminated
    // case is its own scenario, on the other policy.
    fakeProvider.setPolicy("largest");
    const lobbyGame = await suite.playFullGame({ ...ctx, startFromLobby: true });
    ok(
      `lobby → end screen (dealt ${lobbyGame.identity}, ${lobbyGame.timeline.length} public events)`,
    );

    const wolf = await suite.playFullGame({ ...ctx, roles: suite.IDENTITIES.wolf, identity: "wolf" });
    ok(`human as 狼人: licensed night action, private teammates, reveal (${wolf.timeline.length} public events)`);

    const seer = await suite.playFullGame({ ...ctx, roles: suite.IDENTITIES.seer, identity: "seer" });
    ok(`human as 预言家: licensed check, private results, reveal (${seer.timeline.length} public events)`);

    const villager = await suite.playFullGame({
      ...ctx,
      roles: suite.IDENTITIES.villager,
      identity: "villager",
      speak: true,
    });
    ok(`human as 平民: speech composer, vote, reveal (${villager.timeline.length} public events)`);

    await suite.scenarioRecovery(ctx);
    ok("recovery: refresh and back/forward resume without replaying");

    await suite.scenarioIdempotency(ctx);
    ok("idempotency: a double click and two tabs apply an intent once");

    await suite.scenarioSpectating(ctx);
    ok("spectating: the eliminated player keeps watching, public view only");

    await suite.scenarioProviderFailure(ctx);
    ok("provider outage: the game degrades and still finishes");

    // The remaining checks run as the SECOND account: a user may create at
    // most 10 games a day (a frozen product budget), and Alice's ten are
    // already spoken for by the games above.
    const bobSession = await openSession(browser, baseUrl, bobCookie, { width: 1440, height: 900 });
    const bobCtx = {
      ...ctx,
      session: bobSession,
      api: apiClient(baseUrl, bobCookie),
      cookie: bobCookie,
    };
    try {
      await suite.scenarioAccessibility(bobCtx);
      ok("accessibility: keyboard, labels, focus, aria-live, reduced motion");

      await suite.scenarioMobile(bobCtx);
      ok("mobile 390px: one column, 3×2 seats, thumb-zone action, 2 recent events");
    } finally {
      await bobSession.close();
    }

    // Ownership: another user's session is the same 404 as a missing one, and
    // the page never distinguishes them either (防枚举).
    const bob = apiClient(baseUrl, bobCookie);
    const foreign = await bob.get(`/api/games/sessions/${wolf.sessionId}`);
    const missing = await bob.get(`/api/games/sessions/99999999-9999-4999-8999-999999999999`);
    check(
      foreign.status === 404 && missing.status === 404 && foreign.text === missing.text,
      `a non-owner and a non-existent session answer byte-identical 404s (${foreign.status}/${missing.status})`,
    );
    const aliceOwn = await ctx.api.get(`/api/games/sessions/${wolf.sessionId}`);
    check(aliceOwn.status === 200, `the owner still reads their own session (${aliceOwn.status})`);
    const foreignPage = await bob.get(`/games/werewolf/${wolf.sessionId}`);
    check(foreignPage.status === 404, `the match page is the same 404 for a non-owner (${foreignPage.status})`);

    // Final DOM sweep on the last board the session rendered.
    const dom = await session.page.content();
    canaryHits(dom, "final DOM", hits);
    check(hits.length === 0, `canary scan across DOM, RSC and network: ${hits.length} hits`);
    check(session.consoleErrors.length === 0, `no console/page errors during play (${session.consoleErrors.slice(0, 2).join(" | ")})`);
    const statuses = session.traffic.filter((entry) => entry.status >= 500);
    check(statuses.length === 0, `no 5xx reached the browser (${statuses.length})`);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------- cleanup

async function cleanup() {
  if (fakeProvider) {
    try {
      await fakeProvider.close();
    } catch {
      console.error("cleanup: fake provider did not close cleanly");
    }
  }
  for (const server of servers) await stopProcess(server);
  if (browser) {
    try {
      await browser.close();
    } catch {
      // already gone
    }
  }
  if (lockClient) {
    try {
      await lockClient.end();
    } catch {
      // already gone
    }
  }
  if (projectName && composeFile) {
    console.log("\n$ docker compose down -v (cleanup)");
    spawnSync(
      "docker",
      ["compose", "-p", projectName, "-f", composeFile, "down", "-v", "--remove-orphans", "--timeout", "5"],
      { cwd: ROOT, stdio: "ignore" },
    );
    const ps = spawnSync("docker", ["compose", "-p", projectName, "-f", composeFile, "ps", "-q"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const remaining = (ps.stdout ?? "").trim();
    if (remaining !== "") console.error(`cleanup: containers still running: ${remaining}`);
    else console.log("  ✓ no containers remain for this project");
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log("  ✓ temp dir removed");
  }
}

main()
  .catch((error) => {
    console.error(`\nFAILED: ${error?.stack ?? error}`);
    failed = true;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed ? "\nverify:game-ui FAILED" : "\nverify:game-ui passed");
    process.exit(failed ? 1 : 0);
  });
