// Real-browser fixture for the P6.1 game UI suite.
//
// Everything runs against the real standalone server with a real Auth.js
// session cookie: the same sign-in endpoint a person uses, the same pages, the
// same frozen API. Nothing here reaches into the server or the database — the
// browser is the client, exactly as in production.
import { chromium } from "playwright";

// ------------------------------------------------------------------ auth

function cookieValue(setCookies, name) {
  for (const cookie of setCookies) {
    if (cookie.startsWith(`${name}=`)) return cookie.slice(name.length + 1).split(";")[0];
  }
  return null;
}

/** Sign in through the real credentials callback and return the session cookie. */
export async function signIn(baseUrl, user) {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfBody = await csrfRes.json();
  if (csrfRes.status !== 200 || typeof csrfBody.csrfToken !== "string") {
    throw new Error(`csrf endpoint returned ${csrfRes.status}`);
  }
  const csrfCookie = cookieValue(csrfRes.headers.getSetCookie(), "authjs.csrf-token");
  if (!csrfCookie) throw new Error("csrf endpoint did not set authjs.csrf-token");

  const form = new URLSearchParams({
    csrfToken: csrfBody.csrfToken,
    email: user.email,
    password: user.password,
  });
  const res = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `authjs.csrf-token=${csrfCookie}`,
    },
    body: form.toString(),
  });
  const sessionCookie = cookieValue(res.headers.getSetCookie(), "authjs.session-token");
  if (!sessionCookie) {
    throw new Error(`sign-in for ${user.email} failed (status ${res.status}, no session cookie)`);
  }
  return sessionCookie;
}

/**
 * A plain fetch client carrying a session cookie — the same requests the
 * browser makes, usable for cross-checks (and for the fixture games that are
 * created with an explicit role table, which the product UI deliberately does
 * not expose).
 */
export function apiClient(baseUrl, cookie) {
  async function call(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie: `authjs.session-token=${cookie}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed, text };
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
  };
}

// --------------------------------------------------------------- browser

/**
 * A missing static file (the browser asking for /favicon.ico, an aborted
 * prefetch) is not an application error; anything the app itself logged still
 * counts, and a hydration mismatch or a thrown handler is never filtered here.
 */
function isResourceNoise(text) {
  return /Failed to load resource/i.test(text) && !/\/api\//.test(text);
}

export async function launchBrowser() {
  return chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

/**
 * A browsing session: one context carrying the real session cookie, with the
 * network and console traffic recorded for the leak scan.
 */
export async function openSession(browser, baseUrl, cookie, viewport) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "UTC",
  });
  // Scoped by URL so the cookie lands on exactly this origin (host + port).
  await context.addCookies([
    { name: "authjs.session-token", value: cookie, url: baseUrl, httpOnly: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  const traffic = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    traffic.push({ url: response.url(), status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isResourceNoise(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  return {
    context,
    page,
    cookie,
    traffic,
    consoleErrors,
    async close() {
      await context.close();
    },
  };
}

/** Open another tab in the same session (the multi-tab scenarios). */
export async function openTab(session) {
  const page = await session.context.newPage();
  page.on("response", (response) => {
    session.traffic.push({ url: response.url(), status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isResourceNoise(message.text())) return;
    session.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => session.consoleErrors.push(`pageerror: ${error.message}`));
  return page;
}

// ------------------------------------------------------------- page reads

/** The accumulated public timeline of one board, oldest first. */
export async function readTimeline(page) {
  return page.$$eval('[data-testid="timeline-entry"]', (nodes) =>
    nodes.map((node) => ({
      kind: node.getAttribute("data-kind") ?? "",
      round: Number(node.getAttribute("data-round") ?? "0"),
      text: (node.textContent ?? "").trim(),
    })),
  );
}

export async function boardState(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const phase = document.querySelector("section[aria-label='当前阶段'] h2")?.textContent?.trim() ?? null;
    return {
      phase,
      ownRole: text('[data-testid="own-role"]'),
      aiStatus: text('[data-testid="ai-status"]'),
      seatAlive: text('[data-testid="seats-alive"]'),
      result: text('[data-testid="result-reveal"]'),
      outcome: text('[data-testid="result-outcome"]'),
    };
  });
}

/** Click a control, tolerating the re-render that may land mid-click. */
async function tryClick(locator) {
  try {
    await locator.click({ timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Play the human's seat through the real UI until the game ends.
 * The driver only uses what a person can see and press: select a licensed
 * seat, confirm the licensed action, send one speech, skip the rest.
 */
export async function driveGame(page, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  let spoke = false;
  while (Date.now() < deadline) {
    if ((await page.locator('[data-testid="result-reveal"]').count()) > 0) return "finished";

    const confirm = page.locator('[data-testid="confirm-action"]');
    if ((await confirm.count()) > 0) {
      if (await confirm.isEnabled()) {
        await tryClick(confirm);
      } else {
        const seat = page.locator('button[data-testid^="seat-"][data-selected="false"]').first();
        if ((await seat.count()) > 0) await tryClick(seat);
        else await page.waitForTimeout(150);
      }
      continue;
    }

    const send = page.locator('[data-testid="speech-send"]');
    if ((await send.count()) > 0) {
      if (!spoke && options.speak !== false) {
        spoke = true;
        const input = page.locator('[data-testid="speech-input"]');
        await input.fill(options.speechText ?? "我先说：我会认真听大家的线索。");
        await tryClick(send);
        continue;
      }
      await tryClick(page.locator('[data-testid="speech-skip"]'));
      continue;
    }

    await page.waitForTimeout(120);
  }
  throw new Error("game did not finish within the driver budget");
}

/**
 * Wait until the board is ready AND shows a licensed action for the human (or
 * the end). The readiness signal matters: while the session is being re-read
 * the licensed controls stay locked (§6 网络), so a control can exist before
 * it can be used.
 */
export async function waitForHumanTurn(page, timeoutMs = 60_000) {
  await page.waitForSelector(
    '[data-testid="game-shell"][data-restore="ready"] [data-testid="confirm-action"], [data-testid="game-shell"][data-restore="ready"] [data-testid="speech-send"], [data-testid="game-shell"][data-restore="ready"] [data-testid="result-reveal"]',
    { timeout: timeoutMs },
  );
}

/**
 * The "no double advance" invariants, read straight off the rendered public
 * timeline: within one round a phase happens once, a seat votes once and (if it
 * speaks at all) speaks once, and an elimination is announced once. A duplicated
 * submission or a repeated advance would show up here as a repeat — which is
 * exactly the acceptance property "不得重复推进".
 */
export function timelineViolations(entries) {
  const violations = [];
  const counters = new Map();
  const bump = (key) => counters.set(key, (counters.get(key) ?? 0) + 1);

  for (const entry of entries) {
    const round = entry.round;
    if (entry.kind === "phase") bump(`phase|r${round}|${entry.text}`);
    if (entry.kind === "vote") bump(`vote|r${round}|${entry.text.split(" 投给 ")[0]}`);
    if (entry.kind === "speech") bump(`speech|r${round}|${entry.text.split("：")[0]}`);
    if (entry.kind === "elimination") bump(`elimination|r${round}|${entry.text}`);
  }
  for (const [key, count] of counters) {
    if (count > 1) violations.push(`${key} repeated ${count}×`);
  }
  return violations;
}
