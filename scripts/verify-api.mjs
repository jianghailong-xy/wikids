#!/usr/bin/env node
// P5.1 game API verification, run with: npm run verify:api
//
// Serial steps, each must pass (any failure cleans up in `finally` and exits
// non-zero):
//   1. deps present? otherwise `npm ci` (clean install from the lockfile)
//   2. refuse a preset development DATABASE_URL explicitly
//   3. start a TRULY isolated throwaway Postgres: a docker-compose project
//      with a random project name, random published port, random database /
//      user / password and tmpfs storage — postgres:16-alpine, the
//      production image
//   4. demonstrate the guard: the development URL is refused, the isolated
//      URL is accepted (scripts/assert-isolated-db.mjs with the p5v_ prefix)
//   5. migrate from an EMPTY database + schema smoke
//   6. provision two real user accounts (alice / bob)
//   7. typecheck — the whole repo compiles
//   8. production build (placeholder env, mirrors the Dockerfile) and serve
//      the standalone server.js with the isolated DATABASE_URL
//   9. black-box suite against the REAL server with REAL Auth.js cookies:
//      unauthenticated 401s; two-user cross-owner 404 uniformity (non-owner
//      and non-existent are byte-identical); cross-site POSTs refused;
//      Content-Type / size / Zod validation; the active-game conflict
//      (active_session_exists); lobby list filters; resume/refresh; a full
//      game driven through actions + advance with the 202 pending/retryAfter
//      continuation, duplicate requests, stale CAS, same-key-different-
//      payload and concurrent advance; abandon and re-create; user-level
//      rate boundaries (429); provider-off fallback completes the game
//      (no 5xx); DB outage → 502 with a generalized body; canary scan = 0
//      on every response body, error body, HTML and RSC payload
//  10. a second server with the provider ENABLED but its config invalid
//      (no key) proves the misconfiguration is absorbed by the fallback —
//      advance works, no 5xx
//  11. finally: `docker compose down -v` on the random project and removal
//      of the temp dir — verified by asserting no containers remain
//
// The suite never touches the development database: DATABASE_URL is only
// ever set for the isolated container, and the guard refuses the dev URL.
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

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
// Long enough for Auth.js (>=32 chars), only used inside this ephemeral smoke.
const AUTH_SECRET = "verify-api-0123456789abcdef0123456789abcdef-extra";
const ALICE = { email: "alice-api@wikids.test", password: "alice-pass-123" };
const BOB = { email: "bob-api@wikids.test", password: "bob-pass-123" };
const FIXED_ROLES = ["WOLF", "VILLAGER", "WOLF", "SEER", "VILLAGER", "VILLAGER"];
const HUMAN_SEAT = 0;
const RATE_CREATE_PER_MINUTE = "10";
const RATE_ACTION_PER_MINUTE = "200";
const GAME_API_MAX_BODY_BYTES = "16384";

// Internal names that must NEVER appear in a response, HTML/RSC payload or
// error body (docs/game-api-protocol.md): server state fields, internal
// sub-phases, pending-AI-seat vocabulary, provider details and internal
// persistence/domain error codes.
const CANARIES = [
  "serverState",
  "NIGHT_SEER",
  "NIGHT_WOLF",
  "pendingAiSeat",
  "pendingSeats",
  "seedBytes",
  "seedHex",
  "seed_hex",
  '"seed"',
  "nightWolfKills",
  "seerSubmitted",
  "nightSeerTarget",
  "PersistenceError",
  "AiProviderError",
  "ProviderTimeout",
  "DeepSeek",
  "deepseek",
  "DEEPSEEK_API_KEY",
  "GAME_SEAT_HMAC_SECRET",
  "STALE_REVISION",
  "STALE_PHASE_TOKEN",
  "BUDGET_EXHAUSTED",
  "USER_BUDGET_EXHAUSTED",
  "STALE_LEASE",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_CHECKSUM",
  "VERSION_MISMATCH",
  "NOT_ACTIVE",
  "claimToken",
  "claim_token",
  "stateJson",
  "state_json",
  '"scope":"SYSTEM"',
  "game_system_private",
  "advisory",
  "IllegalActionError",
];

let failed = false;
let tempDir = null;
let projectName = null;
let composeFile = null;
const servers = [];

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
        reject(
          new Error(`exit code ${code}\n--- stdout ---\n${tail(out)}\n--- stderr ---\n${tail(err)}`),
        );
      } else resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort() {
  for (let i = 0; i < 25; i++) {
    const port = 20000 + Math.floor(Math.random() * 25000);
    if (await canBind(port)) return port;
  }
  throw new Error("could not find a free local port");
}

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function waitFor(checkFn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await checkFn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? ` (last error: ${lastErr.message})` : ""}`);
}

function startServer(env, logName) {
  const logPath = path.join(tempDir, logName);
  const fd = openSync(logPath, "a");
  const child = spawn(
    NODE_BIN,
    [path.join(ROOT, ".next", "standalone", "server.js")],
    {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", fd, fd],
      detached: false,
    },
  );
  servers.push(child);
  child.on("error", () => {});
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    sleep(5000).then(() => child.kill("SIGKILL")),
  ]);
}

// ---------------------------------------------------------------- HTTP smoke

function cookieValue(setCookies, name) {
  for (const c of setCookies) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(";")[0];
  }
  return null;
}

function scan(label, text) {
  if (typeof text !== "string" || text.length === 0) return;
  for (const canary of CANARIES) {
    if (text.includes(canary)) fail(`canary "${canary}" leaked in ${label}`);
  }
}

async function rawFetch(url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", ...opts });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON (HTML, RSC, empty)
  }
  return { res, text, body };
}

async function apiGet(base, cookie, pathname, label) {
  const headers = {};
  if (cookie) headers.cookie = `authjs.session-token=${cookie}`;
  const { res, text, body } = await rawFetch(`${base}${pathname}`, { headers });
  scan(label, text);
  return { status: res.status, body, text, headers: res.headers };
}

async function apiPost(base, cookie, pathname, json, label, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  if (cookie) headers.cookie = `authjs.session-token=${cookie}`;
  const { res, text, body } = await rawFetch(`${base}${pathname}`, {
    method: "POST",
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  scan(label, text);
  return { status: res.status, body, text, headers: res.headers };
}

async function apiPostText(base, cookie, pathname, text, contentType, label) {
  const headers = { "content-type": contentType };
  if (cookie) headers.cookie = `authjs.session-token=${cookie}`;
  const { res, text: out, body } = await rawFetch(`${base}${pathname}`, {
    method: "POST",
    headers,
    body: text,
  });
  scan(label, out);
  return { status: res.status, body, text: out, headers: res.headers };
}

async function getCsrf(base) {
  const res = await fetch(`${base}/api/auth/csrf`);
  const body = await res.json();
  if (res.status !== 200 || typeof body.csrfToken !== "string") {
    throw new Error(`csrf endpoint returned ${res.status}: ${JSON.stringify(body)}`);
  }
  const cookie = cookieValue(res.headers.getSetCookie(), "authjs.csrf-token");
  if (!cookie) throw new Error("csrf endpoint did not set authjs.csrf-token cookie");
  return { token: body.csrfToken, cookie };
}

async function signIn(base, user) {
  const csrf = await getCsrf(base);
  const form = new URLSearchParams({ csrfToken: csrf.token, email: user.email, password: user.password });
  // The credentials callback answers a successful sign-in with a 302 that
  // carries the session cookie. The default fetch behavior FOLLOWS that
  // redirect, landing on the home page (200) — and getSetCookie() on the
  // final response no longer sees the 302's Set-Cookie. Manual redirects
  // capture the cookie exactly as a real Auth.js client would.
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `authjs.csrf-token=${csrf.cookie}`,
    },
    body: form.toString(),
  });
  const sessionCookie = cookieValue(res.headers.getSetCookie(), "authjs.session-token");
  if (!sessionCookie) {
    throw new Error(`sign-in for ${user.email} failed (status ${res.status}, no session cookie)`);
  }
  return sessionCookie;
}

/** A legal choice id → the command JSON (mirrors the server's vocabulary). */
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
  if (m) return { type: "SUBMIT_SPEECH", seat: Number(m[1]), text: "hello" };
  return null;
}

// ---------------------------------------------------------------- test flows

async function blackBoxSuite(base, aliceCookie, bobCookie, env) {
  const A = (suffix) => `/api/games/sessions${suffix}`;

  step("9.1 unauthenticated → 401 on every endpoint");
  const unauthTargets = [
    ["POST", "", { gameDefinitionId: "quick6-v1" }],
    ["GET", "", null],
    ["GET", `/${randomUUID()}`, null],
    ["POST", `/${randomUUID()}/actions`, { idempotencyKey: "u", expectedRevision: 0, phaseToken: "night:1", command: { type: "SUBMIT_SPEECH", seat: 0, text: null } }],
    ["POST", `/${randomUUID()}/advance`, {}],
    ["POST", `/${randomUUID()}/abandon`, undefined],
  ];
  for (const [method, suffix, body] of unauthTargets) {
    let result;
    if (method === "GET") result = await apiGet(base, null, A(suffix), `unauth ${method} ${suffix}`);
    else result = await apiPost(base, null, A(suffix), body, `unauth ${method} ${suffix}`);
    check(
      result.status === 401 && result.body?.error === "unauthorized",
      `unauth ${method} ${A(suffix)} -> 401 {error:"unauthorized"}`,
    );
  }

  step("9.2 alice creates (fixed roles) — the full envelope");
  const created = await apiPost(base, aliceCookie, A(""), {
    gameDefinitionId: "quick6-v1",
    start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT },
  }, "alice create");
  check(created.status === 201, `alice create -> 201 (got ${created.status})`);
  const game1 = created.body;
  check(game1?.status === "active" && game1?.sessionId, "envelope: status active + sessionId");
  check(game1?.gameDefinitionId === "quick6-v1", "envelope: gameDefinitionId quick6-v1");
  check(game1?.revision === 0 && game1?.phaseToken === "night:1", "envelope: revision 0 + phaseToken night:1");
  check(game1?.pending === false && game1?.retryAfterMs === 0, "envelope: not pending");
  check(game1?.projectView?.ownRole === "WOLF" && game1?.projectView?.seat === 0, "projectView: own role WOLF at seat 0");
  check(
    Array.isArray(game1?.legalActions) && game1.legalActions.some((a) => a.id.startsWith("wolf-kill@0:")),
    "legalActions: own-seat wolf-kill choices present",
  );
  check(
    game1?.increments?.length === 1 && game1.increments[0]?.type === "PHASE",
    "increments: the initial PHASE event",
  );
  if (!game1?.sessionId) throw new Error("no game session — aborting");

  step("9.3 per-user active-game boundary");
  const conflict = await apiPost(base, aliceCookie, A(""), {
    gameDefinitionId: "quick6-v1",
  }, "alice second create");
  check(
    conflict.status === 409 &&
      conflict.body?.error === "active_session_exists" &&
      Object.keys(conflict.body).length === 1,
    `second create -> 409 {error:"active_session_exists"} (stable, got ${conflict.status})`,
  );

  step("9.4 lobby list filters");
  const listActive = await apiGet(base, aliceCookie, `${A("")}?gameDefinitionId=quick6-v1&status=active`, "list active");
  check(
    listActive.status === 200 &&
      listActive.body?.sessions?.length === 1 &&
      listActive.body.sessions[0].sessionId === game1.sessionId &&
      listActive.body.sessions[0].status === "active",
    "list ?gameDefinitionId=quick6-v1&status=active -> exactly the one session",
  );
  const listFinished = await apiGet(base, aliceCookie, `${A("")}?status=finished`, "list finished");
  check(listFinished.body?.sessions?.length === 0, "list ?status=finished -> empty");
  const listOther = await apiGet(base, aliceCookie, `${A("")}?gameDefinitionId=doom-v9`, "list other definition");
  check(listOther.body?.sessions?.length === 0, "list ?gameDefinitionId=doom-v9 -> empty");
  const listBad = await apiGet(base, aliceCookie, `${A("")}?status=bogus`, "list bad status");
  check(listBad.status === 400 && listBad.body?.error === "invalid_body", "list ?status=bogus -> 400 invalid_body");

  step("9.5 bob + cross-owner 404 uniformity (non-owner ≡ non-existent)");
  const bobCreate = await apiPost(base, bobCookie, A(""), {
    start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT },
  }, "bob create");
  check(bobCreate.status === 201, `bob create -> 201 (got ${bobCreate.status})`);
  const bobGame = bobCreate.body;
  const missing = randomUUID();
  const bobCreateConflict = await apiPost(base, bobCookie, A(""), {}, "bob second create");
  check(bobCreateConflict.status === 409 && bobCreateConflict.body?.error === "active_session_exists", "bob second create -> 409 active_session_exists");

  const asBob = await apiGet(base, bobCookie, A(`/${game1.sessionId}`), "bob GET alice session");
  const asNobody = await apiGet(base, aliceCookie, A(`/${missing}`), "alice GET nonexistent");
  check(
    asBob.status === 404 && asNobody.status === 404 && asBob.text === asNobody.text,
    "GET: non-owner and non-existent are byte-identical 404s",
  );
  const bobAct = await apiPost(base, bobCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "bob-x",
    expectedRevision: 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "bob acts on alice session");
  const ghostAct = await apiPost(base, aliceCookie, A(`/${missing}/actions`), {
    idempotencyKey: "bob-x",
    expectedRevision: 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "alice acts on nonexistent");
  check(
    bobAct.status === 404 && ghostAct.status === 404 && bobAct.text === ghostAct.text,
    "actions: non-owner and non-existent are byte-identical 404s",
  );
  const bobAdv = await apiPost(base, bobCookie, A(`/${game1.sessionId}/advance`), {}, "bob advances alice session");
  const bobAbandon = await apiPost(base, bobCookie, A(`/${game1.sessionId}/abandon`), undefined, "bob abandons alice session");
  check(bobAdv.status === 404 && bobAbandon.status === 404, "advance/abandon as non-owner -> 404");
  const nonUuid = await apiGet(base, aliceCookie, A("/not-a-uuid"), "non-uuid id");
  check(nonUuid.status === 404 && nonUuid.body?.error === "not_found", "non-uuid session id -> 404 not_found");

  step("9.6 cross-site writes refused; same-origin passes");
  const evilOrigin = { origin: "https://evil.example" };
  const xsCreate = await apiPost(base, aliceCookie, A(""), { gameDefinitionId: "quick6-v1" }, "cross-site create", evilOrigin);
  const xsActions = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "xs",
    expectedRevision: 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "cross-site actions", evilOrigin);
  const xsAdvance = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/advance`), {}, "cross-site advance", evilOrigin);
  const xsAbandon = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/abandon`), undefined, "cross-site abandon", evilOrigin);
  check(
    xsCreate.status === 403 && xsCreate.body?.error === "cross_origin_forbidden",
    `cross-site create -> 403 (got ${xsCreate.status})`,
  );
  check(xsActions.status === 403 && xsAdvance.status === 403 && xsAbandon.status === 403, "cross-site actions/advance/abandon -> 403");
  const xsSite = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "xs2",
    expectedRevision: 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "sec-fetch-site cross-site actions", { "sec-fetch-site": "cross-site" });
  check(xsSite.status === 403, `Sec-Fetch-Site: cross-site -> 403 (got ${xsSite.status})`);
  const sameOrigin = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "so",
    expectedRevision: 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "same-origin actions", { origin: base });
  check(sameOrigin.status !== 403, `same-origin Origin -> not 403 (got ${sameOrigin.status})`);
  // The acting seat is pinned server-side: an owner can never act for the
  // AI wolf at seat 2, even with a legal-for-seat-2 command.
  const seatSpoof = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "spoof",
    expectedRevision: sameOrigin.status === 200 ? (sameOrigin.body?.revision ?? 0) : 0,
    phaseToken: "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 2, target: 1 },
  }, "seat-spoof action");
  check(
    seatSpoof.status === 403 && seatSpoof.body?.error === "forbidden",
    `acting for another seat -> 403 forbidden (got ${seatSpoof.status}: ${seatSpoof.text.slice(0, 120)})`,
  );

  step("9.7 Content-Type / size / Zod validation");
  const wrongType = await apiPostText(base, aliceCookie, A(""), JSON.stringify({}), "text/plain", "create text/plain");
  check(wrongType.status === 415 && wrongType.body?.error === "unsupported_media_type", "text/plain create -> 415 unsupported_media_type");
  const tooBig = await apiPostText(
    base,
    aliceCookie,
    A(""),
    JSON.stringify({ gameDefinitionId: "x".repeat(20 * 1024) }),
    "application/json",
    "oversized create",
  );
  check(tooBig.status === 413 && tooBig.body?.error === "payload_too_large", "oversized body -> 413 payload_too_large");
  const malformed = await apiPostText(base, aliceCookie, A(""), "{not json", "application/json", "malformed create");
  check(malformed.status === 400 && malformed.body?.error === "invalid_body", "malformed JSON -> 400 invalid_body");
  const badShape = await apiPost(base, aliceCookie, A(""), { start: { roles: ["WOLF"] } }, "bad roles length");
  check(badShape.status === 400 && badShape.body?.error === "invalid_body", "bad body shape -> 400 invalid_body");
  const badDefinition = await apiPost(base, aliceCookie, A(""), { gameDefinitionId: "doom-v9" }, "unknown definition");
  check(badDefinition.status === 400 && badDefinition.body?.error === "invalid_game_definition", "unknown gameDefinitionId -> 400 invalid_game_definition");
  const badActionBody = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
    idempotencyKey: "no-phase",
    expectedRevision: 0,
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "action missing phaseToken");
  check(badActionBody.status === 400 && badActionBody.body?.error === "invalid_body", "action missing phaseToken -> 400 invalid_body");
  const badStart = await apiPost(base, bobCookie, A(""), {
    start: { roles: ["WOLF", "WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER"] },
  }, "invalid role multiset");
  check(badStart.status === 400 && badStart.body?.error === "invalid_start", "non-§1 role multiset -> 400 invalid_start");

  step("9.8 resume / refresh");
  const resume = await apiGet(base, aliceCookie, A(`/${game1.sessionId}`), "alice resume");
  check(
    resume.status === 200 && resume.body?.status === "active" && resume.body?.sessionId === game1.sessionId,
    "resume -> 200 active envelope",
  );
  check(resume.body?.increments?.length >= 1, "resume (no since) -> full visible history");
  const refresh = await apiGet(base, aliceCookie, A(`/${game1.sessionId}?since=${resume.body.revision}`), "alice refresh");
  check(
    refresh.status === 200 && refresh.body?.increments?.length === 0,
    "resume ?since=revision -> no older increments (refresh)",
  );

  step("9.9 full game: actions + bounded advance (202 continuation, idempotency, CAS, concurrency)");
  let revision = resume.body.revision;
  let sawPending = false;
  let firstAction = null;
  let firstActionRequest = null;
  let finished = null;
  for (let i = 0; i < 400 && finished === null; i++) {
    const adv = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/advance`), {
      sinceRevision: Math.max(revision, 0),
    }, `advance #${i}`);
    check([200, 202].includes(adv.status), `advance #${i} -> 200/202 (got ${adv.status}: ${adv.text.slice(0, 120)})`);
    if (![200, 202].includes(adv.status)) break;
    if (adv.status === 202) {
      sawPending = true;
      check(adv.body?.pending === true && adv.body?.retryAfterMs > 0, `advance #${i}: 202 carries pending + retryAfterMs`);
      check(Number(adv.headers?.get("retry-after")) >= 1, `advance #${i}: Retry-After header present`);
      await sleep(Math.min(adv.body?.retryAfterMs ?? 0, 1000));
    } else {
      check(adv.body?.pending === false, `advance #${i}: 200 not pending`);
    }
    revision = adv.body?.revision ?? revision;
    if (adv.body?.status === "finished") {
      finished = adv.body;
      break;
    }
    check(adv.body?.status === "active", `advance #${i}: envelope status active`);
    if (Array.isArray(adv.body?.legalActions) && adv.body.legalActions.length > 0) {
      const choice = adv.body.legalActions[0];
      const command = choiceToCommand(choice.id);
      check(command !== null, `advance #${i}: legal action ${choice.id} maps to a command`);
      if (command === null) break;
      const request = {
        idempotencyKey: `verify-${adv.body.revision}-${choice.id}`,
        expectedRevision: adv.body.revision,
        phaseToken: adv.body.phaseToken,
        command,
      };
      const act = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), request, `action ${choice.id}`);
      check(
        act.status === 200 && act.body?.applied === true,
        `action ${choice.id} -> 200 applied (got ${act.status}: ${act.text.slice(0, 120)})`,
      );
      if (act.status !== 200) break;
      check(act.body?.revision > adv.body.revision, `action ${choice.id}: revision bumped`);
      revision = act.body?.revision ?? revision;

      if (firstAction === null && act.status === 200) {
        firstAction = act.body;
        firstActionRequest = request;
        // --- duplicate request: exact resend replays the stored response ---
        const replay = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), request, "duplicate action replay");
        check(
          replay.status === 200 && replay.body?.applied === false && replay.body?.revision === act.body.revision,
          "duplicate request -> 200 applied:false, same revision",
        );
        // --- same key, different payload (fresh CAS tokens: only the payload differs) ---
        const differentCommand =
          command.type === "SUBMIT_SPEECH"
            ? { ...command, text: command.text === null ? "other words" : `${command.text}!` }
            : { ...command, target: (command.target + 1) % 6 };
        const different = {
          ...request,
          command: differentCommand,
          expectedRevision: act.body.revision,
          phaseToken: act.body.phaseToken,
        };
        const conflict2 = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), different, "same key different payload");
        check(conflict2.status === 409 && conflict2.body?.error === "idempotency_conflict", "same key + different payload -> 409 idempotency_conflict");
        // --- stale revision / stale phase token (旧版本) ---
        const staleRev = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
          ...request,
          idempotencyKey: `stale-${i}`,
          expectedRevision: request.expectedRevision - 1,
        }, "stale revision action");
        check(
          staleRev.status === 409 && staleRev.body?.error === "stale" && staleRev.body?.code === "revision_conflict",
          "stale expectedRevision -> 409 stale revision_conflict",
        );
        const stalePhase = await apiPost(base, aliceCookie, A(`/${game1.sessionId}/actions`), {
          ...request,
          idempotencyKey: `stale-p-${i}`,
          expectedRevision: act.body.revision,
          phaseToken: "bogus:9",
        }, "stale phase action");
        check(
          stalePhase.status === 409 && stalePhase.body?.error === "stale" && stalePhase.body?.code === "phase_conflict",
          "stale phaseToken -> 409 stale phase_conflict",
        );
        // --- concurrent advance: exactly one 429 advance_in_progress ---
        const [c1, c2] = await Promise.all([
          apiPost(base, aliceCookie, A(`/${game1.sessionId}/advance`), { sinceRevision: Math.max(revision, 0) }, "concurrent advance 1"),
          apiPost(base, aliceCookie, A(`/${game1.sessionId}/advance`), { sinceRevision: Math.max(revision, 0) }, "concurrent advance 2"),
        ]);
        const statuses = [c1.status, c2.status].sort();
        const lim = statuses.filter((s) => s === 429).length;
        const other = statuses.find((s) => s !== 429);
        check(
          lim === 1 && (other === 200 || other === 202),
          `concurrent advance -> exactly one 429, other ${other} (got ${statuses.join(",")})`,
        );
        if (c1.status === 429) check(c1.body?.error === "advance_in_progress", "concurrent 429 body: advance_in_progress");
        if (c2.status === 429) check(c2.body?.error === "advance_in_progress", "concurrent 429 body: advance_in_progress");
        const winner = c1.status === 429 ? c2 : c1;
        if (winner.body?.revision !== undefined && winner.body.revision > revision) {
          revision = winner.body.revision;
        }
      }
    }
  }
  check(sawPending, "the bounded advance produced at least one 202 pending/retryAfter continuation");
  check(finished !== null, "the whole game reached finished through the API (fallback completed every AI turn)");
  if (finished === null) return;
  check(
    finished.projectView?.rolesRevealed?.length === 6 && finished.projectView?.outcome !== null,
    "finished envelope: full role reveal + outcome",
  );
  check(finished.legalActions?.length === 0, "finished envelope: no legal actions");
  check(firstAction !== null && firstActionRequest !== null, "at least one human action was applied");

  step("9.10 post-finish state");
  const afterResume = await apiGet(base, aliceCookie, A(`/${game1.sessionId}`), "resume finished");
  check(afterResume.status === 200 && afterResume.body?.status === "finished", "resume finished -> status finished");
  const afterList = await apiGet(base, aliceCookie, `${A("")}?status=active`, "list active after finish");
  check(afterList.body?.sessions?.length === 0, "list ?status=active -> empty after finish");
  const finishedList = await apiGet(base, aliceCookie, `${A("")}?status=finished`, "list finished after finish");
  check(finishedList.body?.sessions?.length === 1, "list ?status=finished -> the finished game");

  step("9.11 abandon → re-create → abandon idempotent");
  const g2 = await apiPost(base, aliceCookie, A(""), { start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT } }, "alice create #2");
  check(g2.status === 201, `create after finish -> 201 (got ${g2.status})`);
  if (g2.status !== 201) return;
  const abandon2 = await apiPost(base, aliceCookie, A(`/${g2.body.sessionId}/abandon`), undefined, "abandon game #2");
  check(abandon2.status === 200 && abandon2.body?.status === "abandoned", "abandon -> 200 {status: abandoned}");
  const resumeAbandoned = await apiGet(base, aliceCookie, A(`/${g2.body.sessionId}`), "resume abandoned");
  check(resumeAbandoned.status === 200 && resumeAbandoned.body?.status === "abandoned", "resume abandoned -> status abandoned (read-only)");
  const actAbandoned = await apiPost(base, aliceCookie, A(`/${g2.body.sessionId}/actions`), {
    idempotencyKey: "post-abandon",
    expectedRevision: resumeAbandoned.body?.revision ?? 0,
    phaseToken: resumeAbandoned.body?.phaseToken ?? "night:1",
    command: { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
  }, "act on abandoned");
  const advAbandoned = await apiPost(base, aliceCookie, A(`/${g2.body.sessionId}/advance`), {}, "advance abandoned");
  check(actAbandoned.status === 409 && actAbandoned.body?.error === "session_not_active", "act on abandoned -> 409 session_not_active");
  check(advAbandoned.status === 409 && advAbandoned.body?.error === "session_not_active", "advance abandoned -> 409 session_not_active");
  const abandonAgain = await apiPost(base, aliceCookie, A(`/${g2.body.sessionId}/abandon`), undefined, "abandon again");
  check(abandonAgain.status === 200, "abandon again -> 200 (idempotent)");
  const g3 = await apiPost(base, aliceCookie, A(""), { start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT } }, "alice create #3");
  check(g3.status === 201, "create after abandon -> 201 (slot freed)");
  if (g3.status === 201) {
    const abandon3 = await apiPost(base, aliceCookie, A(`/${g3.body.sessionId}/abandon`), undefined, "abandon game #3");
    check(abandon3.status === 200, "abandon game #3 -> 200");
  }

  step("9.12 user-level create rate boundary (429 rate_limited)");
  const bobAbandonOwn = await apiPost(base, bobCookie, A(`/${bobGame.sessionId}/abandon`), undefined, "bob abandons");
  check(bobAbandonOwn.status === 200, "bob abandons his game -> 200");
  let sawCreate429 = false;
  let bobActiveGame = null;
  for (let i = 0; i < 15 && !sawCreate429; i++) {
    const attempt = await apiPost(base, bobCookie, A(""), {}, `bob create hammer #${i}`);
    if (attempt.status === 429) {
      sawCreate429 = true;
      check(
        attempt.body?.error === "rate_limited" && attempt.body?.retryAfterMs > 0,
        "create hammer -> 429 rate_limited with retryAfterMs",
      );
      check(Number(attempt.headers?.get("retry-after")) >= 1, "create 429 carries Retry-After");
    } else {
      check([201, 409].includes(attempt.status), `create hammer #${i} -> 201/409 (got ${attempt.status})`);
      if (attempt.status === 201) bobActiveGame = attempt.body;
    }
  }
  check(sawCreate429, "the per-user create rate boundary fired (429)");
  if (bobActiveGame) {
    const cleanupBob = await apiPost(base, bobCookie, A(`/${bobActiveGame.sessionId}/abandon`), undefined, "bob cleans up hammer game");
    check(cleanupBob.status === 200, "bob hammer game abandoned -> 200");
  }

  step("9.13 user-level action rate boundary (429 rate_limited)");
  let sawAction429 = false;
  for (let i = 0; i < 220 && !sawAction429; i++) {
    const attempt = await apiPost(base, bobCookie, A(`/${randomUUID()}/actions`), {
      idempotencyKey: `hammer-${i}`,
      expectedRevision: 0,
      phaseToken: "night:1",
      command: { type: "SUBMIT_SPEECH", seat: 0, text: null },
    }, `bob action hammer #${i}`);
    if (attempt.status === 429) {
      sawAction429 = true;
      check(
        attempt.body?.error === "rate_limited" && attempt.body?.retryAfterMs > 0,
        "action hammer -> 429 rate_limited with retryAfterMs",
      );
      check(Number(attempt.headers?.get("retry-after")) >= 1, "action 429 carries Retry-After");
    } else {
      check(attempt.status === 404, `action hammer #${i} -> 404 (got ${attempt.status}: ${attempt.text.slice(0, 120)})`);
    }
  }
  check(sawAction429, "the per-user action rate boundary fired (429)");

  step("9.14 HTML / RSC / session payloads carry no canaries");
  const home = await apiGet(base, aliceCookie, "/", "home HTML");
  check(home.status === 200, `GET / (authed) -> 200 (got ${home.status})`);
  const rsc = await rawFetch(`${base}/`, {
    headers: { cookie: `authjs.session-token=${aliceCookie}`, RSC: "1" },
  });
  scan("home RSC payload", rsc.text);
  const signInPage = await apiGet(base, null, "/sign-in", "sign-in HTML");
  check(signInPage.status === 200, `GET /sign-in -> 200 (got ${signInPage.status})`);
  const authSession = await apiGet(base, aliceCookie, "/api/auth/session", "auth session");
  check(authSession.body?.user?.email === ALICE.email, "GET /api/auth/session -> alice");
  ok(`canary scan ran over every response above (${CANARIES.length} tokens)`);
}

function randomUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------- main flow

async function main() {
  step("toolchain");
  console.log(`  node ${process.version}`);

  step("1 deps");
  const hasDeps =
    existsSync(path.join(ROOT, "node_modules", "vitest", "package.json")) &&
    existsSync(path.join(ROOT, "node_modules", "typescript", "package.json")) &&
    existsSync(path.join(ROOT, "node_modules", "drizzle-orm", "package.json"));
  if (!hasDeps) {
    await run("npm", ["ci"], { timeoutMs: 900_000 });
  }
  ok("dependencies present");

  step("2 development DATABASE_URL refusal");
  const preset = process.env.DATABASE_URL;
  if (preset) {
    const looksDev = /^postgres(ql)?:\/\/postgres:postgres@[^/]+:5432\/wikids$/.test(preset);
    if (looksDev) throw new Error(`refusing development DATABASE_URL (${preset}) in the environment`);
    console.log("  note: a preset DATABASE_URL was found but is not the development database; children get the isolated URL instead");
  }
  ok("no development DATABASE_URL in the environment");

  step("3 isolated throwaway Postgres (p5v_)");
  const suffix = randomBytes(4).toString("hex");
  projectName = `wikids-p5v-${suffix}`;
  const dbName = `p5v_${suffix}`;
  const dbUser = `p5v_${suffix}`;
  const dbPassword = randomBytes(12).toString("hex");
  const port = await freePort();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "wikids-p5v-"));
  composeFile = path.join(tempDir, "compose.yml");
  const databaseUrl = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}`;

  writeFileSync(
    composeFile,
    `# Generated per-run by scripts/verify-api.mjs — throwaway Postgres.
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
  let status = await run("docker", [
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
    if (!ready) throw new Error("Postgres did not become ready");
  }
  ok("isolated Postgres up");

  step("4 isolated-db guard demo (p5v_)");
  let guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), DEV_DATABASE_URL, "p5v_"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (guard.status === 0) throw new Error("the development DATABASE_URL was NOT refused");
  ok("  dev URL refused as expected");
  guard = spawnSync("node", [path.join(ROOT, "scripts", "assert-isolated-db.mjs"), databaseUrl, "p5v_"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (guard.status !== 0) throw new Error("the isolated URL was refused:\n" + guard.stderr);
  ok("  isolated URL accepted");

  step("5 migrate from zero + schema smoke");
  await run("node", [path.join(ROOT, "scripts", "migrate.mjs")], { env: { DATABASE_URL: databaseUrl } });
  await run("node", [path.join(ROOT, "scripts", "db-smoke.mjs")], { env: { DATABASE_URL: databaseUrl } });
  ok("migrated from an EMPTY database");

  step("6 provision users");
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

  step("7 typecheck");
  await run("npm", ["run", "typecheck"], { timeoutMs: 300_000 });
  ok("tsc --noEmit passed");

  step("8 production build + standalone assets");
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
  cpSync(path.join(ROOT, ".next", "static"), path.join(standaloneDir, ".next", "static"), {
    recursive: true,
  });
  cpSync(path.join(ROOT, "public"), path.join(standaloneDir, "public"), { recursive: true });
  ok("next build passed (standalone ready)");

  const serverEnv = (webPort) => ({
    DATABASE_URL: databaseUrl,
    AUTH_SECRET,
    AUTH_URL: `http://localhost:${webPort}`,
    AUTH_TRUST_HOST: "true",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(webPort),
    HOSTNAME: "127.0.0.1",
    GAME_RATE_CREATE_PER_MINUTE: RATE_CREATE_PER_MINUTE,
    GAME_RATE_ACTION_PER_MINUTE: RATE_ACTION_PER_MINUTE,
    GAME_API_MAX_BODY_BYTES,
    // Deterministic provider behavior regardless of the ambient environment:
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "",
    DEEPSEEK_MODEL: "",
    DEEPSEEK_TIMEOUT_MS: "",
    DEEPSEEK_MAX_OUTPUT_TOKENS: "",
    GAME_SEAT_HMAC_SECRET: "",
  });

  step("9 server A (provider switched OFF) — the black-box suite");
  const webPort = await freePort();
  const serverA = startServer(
    { ...serverEnv(webPort), GAME_AI_ENABLED: "0" },
    "server-a.log",
  );
  const baseA = `http://127.0.0.1:${webPort}`;
  await waitFor(
    async () => {
      const r = await fetch(`${baseA}/sign-in`);
      return r.status === 200;
    },
    90_000,
    `server A on ${baseA}`,
  );
  ok(`server A up on ${baseA} (GAME_AI_ENABLED=0)`);

  const aliceCookie = await signIn(baseA, ALICE);
  const bobCookie = await signIn(baseA, BOB);
  ok("real Auth.js session cookies issued for alice and bob");

  await blackBoxSuite(baseA, aliceCookie, bobCookie);

  step("9.15 database canary scan (keys/PII/reasoning/private state never persisted)");
  // Values, not column names: a key, a bearer credential, planted P6.3
  // canaries, reasoning content, internal state key names, internal error
  // class names, email/phone PII and the smoke's own AUTH_SECRET must never
  // appear inside any game-table value. game_snapshots is the ONE server-
  // only cache that legitimately holds the full state (night buffers and
  // seed bytes) — those keys are excluded there, everything else is not.
  const DB_PUBLIC_RE = "(sk-[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._\\-]{8,}|DEEPSEEK_API_KEY|GAME_SEAT_HMAC_SECRET|p6s-canary-[a-z0-9\\-]+|reasoning_content|\"serverState\"|\"pendingAiSeat\"|\"pendingSeats\"|\"NIGHT_SEER\"|\"NIGHT_WOLF\"|\"seedBytes\"|\"seedHex\"|\"systemPrivate\"|\"systemPrompt\"|\"promptText\"|AiProviderError|PersistenceError|IllegalActionError|OrchestrationConfigError|[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}|1[3-9][0-9]{9}|verify-api-0123456789abcdef0123456789abcdef-extra)";
  const DB_SNAPSHOT_RE = "(sk-[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._\\-]{8,}|DEEPSEEK_API_KEY|GAME_SEAT_HMAC_SECRET|p6s-canary-[a-z0-9\\-]+|reasoning_content|\"serverState\"|\"pendingAiSeat\"|\"pendingSeats\"|\"NIGHT_SEER\"|\"NIGHT_WOLF\"|\"seedHex\"|\"systemPrivate\"|\"systemPrompt\"|\"promptText\"|AiProviderError|PersistenceError|IllegalActionError|OrchestrationConfigError|[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}|1[3-9][0-9]{9}|verify-api-0123456789abcdef0123456789abcdef-extra)";
  const EMAIL_RE = "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}";

  function psql(query) {
    const result = spawnSync(
      "docker",
      ["compose", "-p", projectName, "-f", composeFile, "exec", "-T", "pg", "psql", "-U", dbUser, "-d", dbName, "-t", "-A", "-c", query],
      { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
    );
    if (result.status !== 0) {
      throw new Error(`psql failed: ${result.stderr ?? result.stdout}`);
    }
    return (result.stdout ?? "").trim();
  }

  // Positive control FIRST: the scanner must find what it is looking for —
  // the fixture users' emails sit in the auth table by design, so the email
  // pattern has to hit them. A scanner that sees nothing is untrusted.
  const control = psql(`select count(*)::int from users where email ~ '${EMAIL_RE}'`);
  check(control === "2", `positive control: scanner finds the 2 fixture emails in users (${control})`);

  const scans = [
    [
      "game_ai_runs sanitized metadata",
      DB_PUBLIC_RE,
      `select 'ai_runs:' || id from game_ai_runs where concat(coalesce(provider,''),coalesce(requested_model,''),coalesce(response_model,''),coalesce(response_id,''),coalesce(system_fingerprint,''),coalesce(prompt_version,''),coalesce(error_code,'')) ~ '${DB_PUBLIC_RE}'`,
    ],
    [
      "game_events payloads (public event stream)",
      DB_PUBLIC_RE,
      `select 'event:' || session_id || ':' || seq from game_events where payload::text ~ '${DB_PUBLIC_RE}'`,
    ],
    [
      "game_action_receipts responses (public)",
      DB_PUBLIC_RE,
      `select 'receipt:' || id from game_action_receipts where response_json::text ~ '${DB_PUBLIC_RE}'`,
    ],
    [
      "game_snapshots (server-only cache: night buffers/seed excluded as legitimate)",
      DB_SNAPSHOT_RE,
      `select 'snapshot:' || session_id from game_snapshots where state_json ~ '${DB_SNAPSHOT_RE}'`,
    ],
  ];
  for (const [label, , query] of scans) {
    const hits = psql(query);
    check(hits === "", `${label}: zero canary values${hits ? ` — HITS: ${tail(hits)}` : ""}`);
  }
  ok("database values carry no keys, PII, reasoning, private prompts or internal state");

  await stopServer(serverA);

  step("10 server B (provider enabled, config invalid → fallback absorbed)");
  const portB = await freePort();
  const serverB = startServer(
    { ...serverEnv(portB), GAME_AI_ENABLED: "1" },
    "server-b.log",
  );
  const baseB = `http://127.0.0.1:${portB}`;
  await waitFor(
    async () => {
      const r = await fetch(`${baseB}/sign-in`);
      return r.status === 200;
    },
    90_000,
    `server B on ${baseB}`,
  );
  ok(`server B up on ${baseB} (GAME_AI_ENABLED=1, no key)`);
  const bCreate = await apiPost(baseB, aliceCookie, "/api/games/sessions", {
    start: { roles: FIXED_ROLES, humanSeat: HUMAN_SEAT },
  }, "server B create");
  check(bCreate.status === 201, `server B create -> 201 (got ${bCreate.status})`);
  if (bCreate.status === 201) {
    let bAdvanceOk = true;
    for (let i = 0; i < 4; i++) {
      const adv = await apiPost(baseB, aliceCookie, `/api/games/sessions/${bCreate.body.sessionId}/advance`, {
        sinceRevision: Math.max((bCreate.body?.revision ?? 0), 0),
      }, `server B advance #${i}`);
      if (![200, 202].includes(adv.status)) {
        bAdvanceOk = false;
        fail(`server B advance #${i} -> expected 200/202, got ${adv.status}: ${adv.text.slice(0, 160)}`);
        break;
      }
    }
    check(bAdvanceOk, "misconfigured provider: advances stay 200/202 (fallback absorbs, no 5xx)");
    const bAbandon = await apiPost(baseB, aliceCookie, `/api/games/sessions/${bCreate.body.sessionId}/abandon`, undefined, "server B abandon");
    check(bAbandon.status === 200, "server B abandon -> 200");
  }
  await stopServer(serverB);

  step("11 database outage → 502 with a generalized body");
  const outagePort = await freePort();
  const serverC = startServer(serverEnv(outagePort), "server-c.log");
  const baseC = `http://127.0.0.1:${outagePort}`;
  await waitFor(
    async () => {
      const r = await fetch(`${baseC}/sign-in`);
      return r.status === 200;
    },
    90_000,
    `server C on ${baseC}`,
  );
  await run("docker", ["compose", "-p", projectName, "-f", composeFile, "stop", "pg"], { timeoutMs: 60_000 });
  ok("isolated Postgres stopped");
  let saw502 = false;
  for (let attempt = 0; attempt < 5 && !saw502; attempt++) {
    try {
      const { res, text, body } = await rawFetch(`${baseC}/api/games/sessions`, {
        headers: { cookie: `authjs.session-token=${aliceCookie}` },
        signal: AbortSignal.timeout(20_000),
      });
      scan("db-outage response", text);
      if (res.status === 502) {
        check(body?.error === "service_unavailable", "DB outage -> 502 {error: service_unavailable}");
        saw502 = true;
      } else if (attempt === 4) {
        fail(`expected 502 after db stop, got ${res.status}: ${text.slice(0, 200)}`);
      } else {
        await sleep(2000);
      }
    } catch {
      await sleep(2000);
    }
  }
  check(saw502, "the 502 infrastructure path fired exactly once (generalized body, no canary)");
  await stopServer(serverC);
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
    }
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    console.error(`\nVERIFICATION FAILED: ${e.message}`);
    failed = true;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed ? "\n✗ verify:api FAILED" : "\n✓ verify:api PASSED");
    process.exit(failed ? 1 : 0);
  });
