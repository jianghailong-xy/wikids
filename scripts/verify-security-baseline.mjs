// Security baseline verification, run with: npm run verify:security-baseline
//
// Serial steps, each must pass:
//   1. npm ci               — clean install from the lockfile
//   2. npm audit (prod)     — 0 high / 0 critical, exit 0 at --audit-level=high
//   3. npm run typecheck    — tsc --noEmit
//   4. npm run build        — production build (placeholder env, mirrors Dockerfile)
//   5. isolated temp Postgres (docker, random port) + existing-migration smoke
//      (fresh apply, idempotent re-apply, expected tables present)
//   6. Auth.js smoke against the standalone production server:
//      valid credentials, invalid credentials, unauthenticated access,
//      misconfiguration must not fail open, malformed Authorization header
//      must not produce an uncaught exception
//
// The smoke never touches the dev database (only the throwaway container on
// 127.0.0.1:<random port>) and makes no external API calls (no DeepSeek).
// All resources (servers, container) are cleaned up on success AND failure.
//
// Uses only Node built-ins so it can orchestrate `npm ci` from a bare tree.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const ROOT = process.cwd();
const NODE_BIN = process.execPath;

const PG_IMAGE = process.env.VERIFY_POSTGRES_IMAGE ?? "postgres:18-alpine";
const PG_USER = "postgres";
const PG_PASSWORD = "postgres";
const PG_DB = "wikids";

// Long enough for Auth.js (>=32 chars), only used inside this ephemeral smoke.
const AUTH_SECRET = "verify-security-baseline-0123456789abcdef0123456789abcdef";
const SMOKE_EMAIL = "smoke@wikids.test";
const SMOKE_PASSWORD = "smoke-pass-123";

const buildEnv = {
  DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
  AUTH_SECRET: "placeholder-build-only",
  NEXT_TELEMETRY_DISABLED: "1",
};

let failed = false;
let postgresContainer = null;
const servers = [];

// ---------------------------------------------------------------- utilities

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

function tail(s, n = 3000) {
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
          new Error(
            `exit code ${code}\n--- stdout ---\n${tail(out)}\n--- stderr ---\n${tail(err)}`,
          ),
        );
      } else resolve();
    });
  });
}

async function freePort() {
  for (let i = 0; i < 25; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    if (await canBind(port)) return port;
  }
  throw new Error("could not find a free local port");
}

function canBind(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(1000);
  }
  throw new Error(
    `timed out waiting for ${what}${lastErr ? ` (last error: ${lastErr.message})` : ""}`,
  );
}

function startServer(env) {
  const child = spawn(
    NODE_BIN,
    [join(ROOT, ".next", "standalone", "server.js")],
    {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "ignore"],
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

function request(url, opts = {}) {
  return fetch(url, { redirect: "manual", ...opts });
}

function cookieValue(setCookies, name) {
  for (const c of setCookies) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(";")[0];
  }
  return null;
}

function isRedirect(status) {
  return status === 302 || status === 303 || status === 307 || status === 308;
}

async function getCsrf(base) {
  const res = await request(`${base}/api/auth/csrf`);
  const body = await res.json();
  if (res.status !== 200 || typeof body.csrfToken !== "string") {
    throw new Error(`csrf endpoint returned ${res.status}: ${JSON.stringify(body)}`);
  }
  const cookie = cookieValue(res.headers.getSetCookie(), "authjs.csrf-token");
  if (!cookie) throw new Error("csrf endpoint did not set authjs.csrf-token cookie");
  return { token: body.csrfToken, cookie };
}

async function postCredentials(base, { csrf, email, password, callbackUrl }) {
  const form = new URLSearchParams({ csrfToken: csrf.token, email, password });
  if (callbackUrl) form.set("callbackUrl", callbackUrl);
  return request(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `authjs.csrf-token=${csrf.cookie}`,
    },
    body: form.toString(),
  });
}

async function authSmoke(base) {
  // --- unauthenticated access ---
  const signInRes = await request(`${base}/sign-in`);
  if (signInRes.status === 200) ok("GET /sign-in (public page) -> 200");
  else fail(`GET /sign-in expected 200, got ${signInRes.status}`);

  const homeRes = await request(`${base}/`);
  const homeLoc = homeRes.headers.get("location") ?? "";
  if (isRedirect(homeRes.status) && homeLoc.includes("/sign-in")) {
    ok(`GET / (logged out) -> ${homeRes.status} redirect to /sign-in`);
  } else {
    fail(
      `GET / (logged out) expected redirect to /sign-in, got ${homeRes.status} location=${homeLoc}`,
    );
  }

  // --- valid credentials ---
  const csrf = await getCsrf(base);
  const good = await postCredentials(base, {
    csrf,
    email: SMOKE_EMAIL,
    password: SMOKE_PASSWORD,
    callbackUrl: `${base}/textbooks`,
  });
  const sessionCookie = cookieValue(good.headers.getSetCookie(), "authjs.session-token");
  if (isRedirect(good.status) && sessionCookie) {
    ok(`valid login -> ${good.status} with authjs.session-token cookie`);
  } else {
    fail(
      `valid login expected 3xx + session cookie, got ${good.status} cookie=${!!sessionCookie}`,
    );
    return;
  }

  const authedHome = await request(`${base}/`, {
    headers: { cookie: `authjs.session-token=${sessionCookie}` },
  });
  if (authedHome.status === 200) ok("GET / with session -> 200");
  else fail(`GET / with session expected 200, got ${authedHome.status}`);

  const sessionRes = await request(`${base}/api/auth/session`, {
    headers: { cookie: `authjs.session-token=${sessionCookie}` },
  });
  const sessionJson = await sessionRes.json().catch(() => null);
  if (sessionRes.status === 200 && sessionJson?.user?.email === SMOKE_EMAIL) {
    ok("GET /api/auth/session -> 200 with the signed-in user");
  } else {
    fail(
      `GET /api/auth/session expected 200 + ${SMOKE_EMAIL}, got ${sessionRes.status} ${JSON.stringify(sessionJson)}`,
    );
  }

  const progressRes = await request(`${base}/api/progress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `authjs.session-token=${sessionCookie}`,
    },
    body: JSON.stringify({
      textbookSlug: "essential-grammar-in-use",
      lessonSlug: "01-am-is-are",
      status: "completed",
    }),
  });
  if (progressRes.status === 200) ok("POST /api/progress with session -> 200");
  else fail(`POST /api/progress with session expected 200, got ${progressRes.status}`);

  // --- invalid credentials ---
  const csrf2 = await getCsrf(base);
  const bad = await postCredentials(base, {
    csrf: csrf2,
    email: SMOKE_EMAIL,
    password: "wrong-password-123",
  });
  const badLoc = bad.headers.get("location") ?? "";
  const badSession = cookieValue(bad.headers.getSetCookie(), "authjs.session-token");
  if (isRedirect(bad.status) && badLoc.includes("/sign-in") && !badSession) {
    ok(`invalid login -> ${bad.status} to /sign-in, no session cookie`);
  } else {
    fail(
      `invalid login expected 3xx to /sign-in with no session cookie, got ${bad.status} location=${badLoc} cookie=${!!badSession}`,
    );
  }

  // --- unauthenticated API access ---
  const anonApi = await request(`${base}/api/progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (anonApi.status === 401) ok("POST /api/progress without session -> 401");
  else fail(`POST /api/progress without session expected 401, got ${anonApi.status}`);

  // --- malformed Authorization header must not crash (fixed in @auth/core 0.41.3) ---
  for (const header of ["Bearer not-a-jwt", "Bearer abc.def.ghi", "Basic !!!"]) {
    const res = await request(`${base}/api/progress`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: header,
      },
      body: JSON.stringify({}),
    });
    if (res.status === 401) {
      ok(`POST /api/progress with "Authorization: ${header}" -> 401 (no crash)`);
    } else {
      fail(
        `malformed Authorization "${header}" expected 401, got ${res.status} (uncaught exception?)`,
      );
    }
  }
}

async function misconfigSmoke(base) {
  // The whole site is behind the middleware gate; without AUTH_SECRET no
  // session may be issued or read. Asserting fail-closed (never 200 content,
  // never a session cookie), not the exact error status.
  const homeRes = await request(`${base}/`);
  if (homeRes.status !== 200) {
    ok(`no-secret GET / -> ${homeRes.status} (protected content not served)`);
  } else {
    fail(`no-secret GET / returned 200 — auth failed OPEN`);
  }

  const sessionRes = await request(`${base}/api/auth/session`);
  if (sessionRes.status !== 200) {
    ok(`no-secret GET /api/auth/session -> ${sessionRes.status} (no session readable)`);
  } else {
    fail(`no-secret GET /api/auth/session returned 200 — auth failed OPEN`);
  }

  let loginFailedClosed = false;
  try {
    const csrf = await getCsrf(base);
    const res = await postCredentials(base, {
      csrf,
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
    });
    const sessionCookie = cookieValue(res.headers.getSetCookie(), "authjs.session-token");
    if (res.status >= 500 && !sessionCookie) loginFailedClosed = true;
    if (loginFailedClosed) {
      ok(`no-secret login -> ${res.status} and no session cookie issued`);
    } else {
      fail(
        `no-secret login expected 5xx without session cookie, got ${res.status} cookie=${!!sessionCookie}`,
      );
    }
  } catch {
    // A 500 from /api/auth/csrf means the config error surfaces there too —
    // still fail-closed, since no credentials were ever accepted.
    ok("no-secret auth endpoints error out (csrf/callback unavailable) — fail-closed");
  }
}

// ---------------------------------------------------------------- main flow

async function main() {
  step("toolchain");
  const nodeV = process.version;
  console.log(`  node ${nodeV}`);

  step("1/6 npm ci (clean install)");
  await run("npm", ["ci"], { timeoutMs: 900_000 });
  ok("npm ci succeeded");

  step("2/6 production dependency audit");
  await run("npm", ["audit", "--omit=dev", "--audit-level=high"], {
    timeoutMs: 300_000,
  });
  ok("npm audit --omit=dev --audit-level=high exited 0");
  // Parse the JSON report to pin the exact high/critical counts to zero,
  // independently of the threshold exit code.
  const auditJson = await auditJsonFromNpm();
  {
    const v = auditJson.metadata?.vulnerabilities ?? {};
    if ((v.high ?? 0) === 0 && (v.critical ?? 0) === 0) {
      ok(`high=0 critical=0 (moderate=${v.moderate ?? 0} low=${v.low ?? 0})`);
    } else {
      fail(`audit counts: high=${v.high} critical=${v.critical}`);
    }
  }

  step("3/6 typecheck");
  await run("npm", ["run", "typecheck"], { timeoutMs: 300_000 });
  ok("tsc --noEmit passed");

  step("4/6 production build");
  await run("npm", ["run", "build"], { env: buildEnv, timeoutMs: 900_000 });
  ok("next build passed");

  step("5/6 isolated temp Postgres + migration smoke");
  const pgPort = await freePort();
  postgresContainer = `wikids-verify-pg-${process.pid}-${Date.now()}`;
  await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    postgresContainer,
    "-e",
    `POSTGRES_USER=${PG_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-p",
    `127.0.0.1:${pgPort}:5432`,
    PG_IMAGE,
  ]);
  await waitFor(
    () =>
      run(
        "docker",
        ["exec", postgresContainer, "pg_isready", "-U", PG_USER, "-d", PG_DB, "-q"],
        { timeoutMs: 15_000 },
      ).then(
        () => true,
        () => false,
      ),
    90_000,
    `postgres (${postgresContainer})`,
  );
  ok(`temp postgres up on 127.0.0.1:${pgPort} (container ${postgresContainer})`);

  const pgEnv = {
    DATABASE_URL: `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${pgPort}/${PG_DB}`,
  };
  await run(NODE_BIN, [join(ROOT, "scripts", "migrate.mjs")], { env: pgEnv });
  await run(NODE_BIN, [join(ROOT, "scripts", "migrate.mjs")], { env: pgEnv });
  ok("migrations applied from scratch and re-applied idempotently");
  await run(NODE_BIN, [join(ROOT, "scripts", "db-smoke.mjs")], { env: pgEnv });
  ok("expected tables present");
  await run(
    NODE_BIN,
    [
      join(ROOT, "scripts", "create-user.mjs"),
      "--email",
      SMOKE_EMAIL,
      "--password",
      SMOKE_PASSWORD,
      "--name",
      "Smoke",
    ],
    { env: pgEnv },
  );
  ok(`created smoke user ${SMOKE_EMAIL}`);

  step("6/6 Auth.js smoke (standalone production server)");
  // The standalone bundle is what the Docker image actually runs; give it the
  // static assets the Dockerfile copies in.
  const standaloneDir = join(ROOT, ".next", "standalone");
  rmSync(join(standaloneDir, ".next", "static"), { recursive: true, force: true });
  rmSync(join(standaloneDir, "public"), { recursive: true, force: true });
  cpSync(join(ROOT, ".next", "static"), join(standaloneDir, ".next", "static"), {
    recursive: true,
  });
  cpSync(join(ROOT, "public"), join(standaloneDir, "public"), { recursive: true });

  const webPort = await freePort();
  const serverA = startServer(
    {
      ...pgEnv,
      AUTH_SECRET,
      AUTH_URL: `http://localhost:${webPort}`,
      AUTH_TRUST_HOST: "true",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(webPort),
      HOSTNAME: "127.0.0.1",
    },
  );
  const base = `http://127.0.0.1:${webPort}`;
  await waitFor(
    async () => {
      const r = await request(`${base}/sign-in`);
      return r.status === 200;
    },
    90_000,
    `server on ${base}`,
  );
  ok(`server up on ${base}`);
  await authSmoke(base);

  // Misconfigured instance (missing AUTH_SECRET) must not fail open.
  const misPort = await freePort();
  const serverB = startServer(
    {
      ...pgEnv,
      AUTH_URL: `http://localhost:${misPort}`,
      AUTH_TRUST_HOST: "true",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(misPort),
      HOSTNAME: "127.0.0.1",
    },
  );
  const misBase = `http://127.0.0.1:${misPort}`;
  await waitFor(
    async () => {
      try {
        const r = await request(`${misBase}/sign-in`);
        return r.status === 200;
      } catch {
        return false;
      }
    },
    90_000,
    `misconfigured server on ${misBase}`,
  );
  ok(`misconfigured server up on ${misBase}`);
  await misconfigSmoke(misBase);

  step("summary: resolved versions");
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const pkgs = lock.packages ?? {};
  const find = (name) => {
    if (pkgs[`node_modules/${name}`]) return pkgs[`node_modules/${name}`].version;
    for (const [p, meta] of Object.entries(pkgs)) {
      if (p.endsWith(`/node_modules/${name}`)) return meta.version;
    }
    return "?";
  };
  for (const name of [
    "next",
    "next-auth",
    "@auth/core",
    "@auth/drizzle-adapter",
    "drizzle-orm",
    "drizzle-kit",
    "react",
    "react-dom",
    "postcss",
    "nanoid",
    "sharp",
  ]) {
    console.log(`  ${name}@${find(name)}`);
  }

  // Informational: what remains across the FULL tree (dev deps included).
  const fullAudit = spawnSync("npm", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const v = JSON.parse(fullAudit.stdout).metadata?.vulnerabilities ?? {};
    console.log(
      `  remaining full-tree audit: high=${v.high ?? 0} critical=${v.critical ?? 0} moderate=${v.moderate ?? 0} low=${v.low ?? 0} (dev-only, see docs/security-baseline.md)`,
    );
  } catch {
    // informational only
  }
}

// Re-run the audit as JSON so the parsed high/critical counts come from the
// same lockfile state as the threshold run above.
function auditJsonFromNpm() {
  const res = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(res.stdout);
  } catch {
    return {};
  }
}

main()
  .catch((e) => {
    console.error(`\nVERIFICATION FAILED: ${e.message}`);
    failed = true;
  })
  .finally(async () => {
    for (const child of servers) await stopServer(child);
    if (postgresContainer) {
      try {
        await run("docker", ["rm", "-f", postgresContainer], { timeoutMs: 30_000 });
        console.log(`cleanup: removed container ${postgresContainer}`);
      } catch {
        console.error(`cleanup: failed to remove container ${postgresContainer}`);
      }
    }
    console.log(failed ? "\n✗ verify:security-baseline FAILED" : "\n✓ verify:security-baseline PASSED");
    process.exit(failed ? 1 : 0);
  });
