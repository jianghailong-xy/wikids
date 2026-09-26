// P6.1 game UI end-to-end suite: the lobby, the match board, recovery,
// idempotency, spectating, provider failure, accessibility and the mobile
// viewport — all in a real Chromium against the real server with a real
// Auth.js cookie.
//
// The oracle is what a person can see: the rendered DOM, the public timeline,
// the licensed controls. Server-side checks exist only to confirm what the
// browser is showing (never to replace it).
import { driveGame, openSession, openTab, readTimeline, timelineViolations, waitForHumanTurn, boardState } from "./browser.mjs";

/** Every element whose box sticks out past the mobile viewport, for triage. */
async function widestElements(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter((entry) => entry.rect.right > 392 || entry.rect.width > 392)
      .slice(0, 8)
      .map(
        (entry) =>
          `${entry.node.tagName}.${String(entry.node.className).slice(0, 48)} w=${Math.round(entry.rect.width)} right=${Math.round(entry.rect.right)}`,
      )
      .join(" | "),
  );
}

/** The five fixed AI personas (docs/design/werewolf/visual-spec.md §6). */
const PERSONAS = ["阿橙", "慢慢", "点点", "木木", "团团"];

/** Fixed role tables for the three human identities (human always seat 1). */
export const IDENTITIES = {
  wolf: ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"],
  seer: ["SEER", "WOLF", "WOLF", "VILLAGER", "VILLAGER", "VILLAGER"],
  villager: ["VILLAGER", "WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER"],
};

const ROLE_TEXT = { WOLF: "狼人", SEER: "预言家", VILLAGER: "平民" };
/** The other direction: what the private card says → the identity key. */
const ROLE_TO_IDENTITY = { 狼人: "wolf", 预言家: "seer", 平民: "villager" };

// --------------------------------------------------------------- utilities

async function createGame(api, roles) {
  const response = await api.post("/api/games/sessions", {
    gameDefinitionId: "quick6-v1",
    start: { roles, humanSeat: 0 },
  });
  if (response.status !== 201) {
    throw new Error(`create failed: ${response.status} ${response.text}`);
  }
  return response.body.sessionId;
}

async function abandonIfActive(api, sessionId) {
  await api.post(`/api/games/sessions/${sessionId}/abandon`, {});
}

/** Let the board's own continuation loop settle before reading it. */
async function settle(page, timeoutMs = 30_000) {
  await waitForHumanTurn(page, timeoutMs).catch(() => {});
}

/**
 * Play forward (through the licensed controls only) until the board offers a
 * vote-style target choice, i.e. the human holds a target action.
 */
async function reachTargetTurn(page, budgetMs = 180_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if ((await page.locator('button[data-testid^="seat-"]').count()) > 0) return true;
    const skip = page.locator('[data-testid="speech-skip"]');
    const send = page.locator('[data-testid="speech-send"]');
    if ((await skip.count()) > 0 && (await skip.isEnabled())) {
      await skip.click().catch(() => {});
    } else if ((await send.count()) > 0 && (await send.isEnabled())) {
      await send.click().catch(() => {});
    }
    if ((await page.locator('[data-testid="result-reveal"]').count()) > 0) return false;
    await page.waitForTimeout(200);
  }
  return false;
}

// -------------------------------------------------------------- scenarios

/**
 * The lobby: what the page says, what it links to, and the one start action.
 */
export async function scenarioLobby({ session, baseUrl, log, check }) {
  const { page } = session;
  await page.goto(`${baseUrl}/games`, { waitUntil: "domcontentloaded" });

  check(await page.locator('[data-testid="lobby-hero"]').isVisible(), "lobby shows the 狼人杀 feature card");
  check((await page.locator("h1").first().textContent())?.includes("狼人杀") === true, "feature card names 狼人杀");
  const heroText = (await page.locator('[data-testid="lobby-hero"]').textContent()) ?? "";
  check(heroText.includes("AI 对局"), "feature card states it is an AI 对局");
  check(heroText.includes("6 人极速局"), "feature card states 6 人极速局");
  check(heroText.includes("1 位玩家 + 5 位 AI"), "feature card states the 1 + 5 composition");
  check(
    heroText.includes("2 狼人 · 1 预言家 · 3 平民"),
    "feature card states the frozen role configuration",
  );

  const personas = await page.locator('[data-testid^="persona-"]').count();
  check(personas === 5, `lobby introduces exactly 5 AI companions (got ${personas})`);
  for (const name of PERSONAS) {
    check(
      (await page.locator('[data-testid="ai-roster"]').textContent())?.includes(name) === true,
      `AI roster lists ${name}`,
    );
  }
  check(
    (await page.locator('[data-testid="ai-roster"]').textContent())?.includes("各有表达风格，身份每局随机") === true,
    "AI roster says identities are dealt each game",
  );
  check(
    (await page.content()).includes("先听线索") && (await page.content()).includes("友好讨论"),
    "lobby carries the friendly-discussion tip",
  );

  const nav = await page.locator("header nav").textContent();
  check(nav?.includes("Games") === true, "site header exposes the Games entry");
  check(
    (await page.locator('header nav a[href="/games"]').count()) === 1,
    "the Games entry links to /games",
  );

  // 了解规则 reaches the rules the design promises.
  await page.locator('a:has-text("了解规则")').first().click();
  await page.waitForURL(/\/games\/werewolf/, { timeout: 15_000 });
  check(
    await page.locator("#rules").isVisible(),
    "了解规则 lands on the werewolf rules section",
  );
}

/**
 * A full game for one human identity, driven from the board UI to the end.
 * Returns the final board state so a scenario can make further assertions.
 */
export async function playFullGame({
  session,
  baseUrl,
  roles,
  identity,
  api,
  log,
  check,
  speak = true,
  startFromLobby = false,
}) {
  const { page } = session;
  let sessionId;
  if (startFromLobby) {
    await page.goto(`${baseUrl}/games/werewolf`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="start-game"]').first().click();
    await page.waitForURL(/\/games\/werewolf\/[0-9a-f-]{36}/, { timeout: 30_000 });
    sessionId = new URL(page.url()).pathname.split("/").pop();
    log(`  · started from the lobby button: ${sessionId}`);
  } else {
    sessionId = await createGame(api, roles);
    await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  }

  await waitForHumanTurn(page, 60_000);
  const first = await boardState(page);
  // The board is the authority on what was dealt: a game started from the
  // lobby button has a random deal, so the assertion reads the card and the
  // night behaviour is checked against the role the card actually shows.
  const drawn = ROLE_TO_IDENTITY[first.ownRole ?? ""] ?? null;
  const expected = identity ?? drawn;
  const isWolf = expected === "wolf";
  const isSeer = expected === "seer";
  const label = `${identity ?? "lobby"} (${first.ownRole})`;

  check(drawn !== null, `${label}: the private card shows one of the three dealt roles`);
  if (identity !== undefined) {
    check(
      first.ownRole === ROLE_TEXT[identity.toUpperCase()],
      `${label}: the private card shows the dealt role`,
    );
  }
  check(
    (await page.locator('[data-testid="identity-card"]').textContent())?.includes("仅自己可见") === true,
    `${label}: the private card is marked 仅自己可见`,
  );

  const phase1 = await page.locator("section[aria-label='当前阶段'] h2").textContent();
  if (isWolf || isSeer) {
    check(
      phase1?.includes("夜晚行动") === true,
      `${label}: the night action is offered in the night phase`,
    );
    check(
      (await page.locator('[data-testid="confirm-action"]').count()) === 1,
      `${label}: night 1 offers the licensed action (${isWolf ? "确认目标" : "确认查验"})`,
    );
    check(
      (await page.locator('[data-testid="confirm-action"]').isDisabled()) === true,
      `${label}: the confirm button is disabled until a target is chosen`,
    );
    const selectable = await page.locator('button[data-testid^="seat-"]').count();
    check(selectable > 0, `${label}: the board offers selectable seats from the server's own set`);
    // The seat the human holds is never among the licensed targets.
    check(
      (await page.locator('button[data-testid="seat-0"]').count()) === 0,
      `${label}: the own seat is not selectable`,
    );
    check(
      (await page.locator("text=不可选自己").count()) >= 1,
      `${label}: the own seat explains 不可选自己`,
    );
  } else if (phase1?.includes("夜晚行动")) {
    // A villager holds no night action at all — not a disabled one.
    check(
      (await page.locator('[data-testid="confirm-action"]').count()) === 0,
      `${label}: a villager is offered no night action`,
    );
    check(
      (await page.locator('[data-testid="speech-night"]').textContent())?.includes("白天轮到你时可发言") === true,
      `${label}: the night speaking panel explains why it is unavailable`,
    );
  }

  await driveGame(page, { speak });
  const final = await boardState(page);
  check(final.result !== null, `${label}: the game reaches the end screen`);
  check(
    (await page.locator('[data-testid="role-reveal"] li').count()) === 6,
    `${label}: the reveal publishes all six seats`,
  );
  const revealText = (await page.locator('[data-testid="role-reveal"]').textContent()) ?? "";
  check(
    ["狼人", "预言家", "平民"].every((word) => revealText.includes(word)),
    `${label}: the reveal names the dealt roles`,
  );
  check(
    final.outcome !== null && (final.outcome.includes("胜利")),
    `${label}: the end screen states the result (${final.outcome})`,
  );

  const timeline = await readTimeline(page);
  const violations = timelineViolations(timeline);
  check(violations.length === 0, `${label}: the public timeline has no repeated advance (${violations.join("; ") || "clean"})`);
  check(
    timeline.some((entry) => entry.text.includes("对局已创建")) &&
      timeline.some((entry) => entry.text.includes("第 1 夜开始")),
    `${label}: the timeline opens with creation, seating and the first night`,
  );
  return { sessionId, timeline, final, identity: expected };
}

/**
 * Refresh and back/forward must resume the authoritative view without
 * replaying anything.
 */
export async function scenarioRecovery({ session, baseUrl, api, fake, log, check }) {
  const { page } = session;
  fake.setPolicy("largest");
  const sessionId = await createGame(api, IDENTITIES.seer);
  await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);

  // Act once so there is history to preserve, then reload mid-game.
  await page.locator('button[data-testid^="seat-"]').first().click();
  await page.locator('[data-testid="confirm-action"]').click();
  await page.waitForTimeout(600);

  await page.goto(`${baseUrl}/games`, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="active-game-card"]');
  check(await card.isVisible(), "the lobby shows the active game");
  check(
    (await page.locator('[data-testid="resume-game"]').getAttribute("href")) ===
      `/games/werewolf/${sessionId}`,
    "the lobby's resume link points at the running game",
  );
  await page.locator('[data-testid="resume-game"]').click();
  await page.waitForURL((url) => url.pathname.includes(sessionId), { timeout: 30_000 });
  check(true, "resuming from the lobby lands on the same game");

  const before = await readTimeline(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);
  const after = await readTimeline(page);
  check(
    after.length >= before.length,
    `refresh keeps the whole public record (${before.length} → ${after.length})`,
  );
  check(
    timelineViolations(after).length === 0,
    "refresh does not replay a public event twice",
  );
  check(
    (await boardState(page)).ownRole === "预言家",
    "refresh restores the private identity from the server projection",
  );

  // Leave the board, then walk the history: back must resume the same match,
  // and a forward/back cycle must not lose or replay the record.
  await page.goto(`${baseUrl}/games`, { waitUntil: "domcontentloaded" });
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  check(page.url().includes(sessionId), "back navigation returns to the same match");
  await waitForHumanTurn(page, 60_000);
  const resumed = await readTimeline(page);
  check(
    timelineViolations(resumed).length === 0 && resumed.length >= after.length,
    "the restored board shows a complete, non-duplicated record",
  );

  await page.goForward({ waitUntil: "domcontentloaded" });
  check(page.url().endsWith("/games"), "forward returns to the lobby");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  check(page.url().includes(sessionId), "the match is restored again from the history entry");
  await waitForHumanTurn(page, 60_000);

  await driveGame(page, { speak: false });
  check(
    (await page.locator('[data-testid="result-reveal"]').count()) === 1,
    "the recovered board still plays the game to the end",
  );
  await abandonIfActive(api, sessionId);
  void log;
}

/**
 * Idempotency: a double click and two tabs submitting the same intent must
 * produce one application, never two.
 */
export async function scenarioIdempotency({ session, baseUrl, api, fake, log, check }) {
  const { page } = session;
  // "largest" keeps the human alive and in the game, so they reach their own
  // vote turn instead of being eliminated on the first night.
  fake.setPolicy("largest");

  const submissions = [];
  // Context-level, so it also sees the second tab's submissions; the request
  // body carries the idempotency key, which is what the invariant is about.
  session.context.on("response", (response) => {
    if (!response.url().endsWith("/actions")) return;
    const status = response.status();
    let key = null;
    try {
      key = JSON.parse(response.request().postData() ?? "{}")?.idempotencyKey ?? null;
    } catch {
      key = null;
    }
    response
      .json()
      .then((body) => submissions.push({ status, applied: body?.applied, key }))
      .catch(() => submissions.push({ status, applied: null, key }));
  });

  const sessionId = await createGame(api, IDENTITIES.wolf);
  await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);

  // Two clicks in the same tick, before React can re-render the button.
  await page.locator('button[data-testid^="seat-"]').first().click();
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="confirm-action"]');
    button?.click();
    button?.click();
  });
  await page.waitForTimeout(1_500);
  const applied = submissions.filter((entry) => entry.applied === true).length;
  const keys = new Set(submissions.map((entry) => entry.key));
  check(
    applied === 1 && keys.size === 1,
    `a double click is one intent, applied exactly once (applied=${applied}, keys=${keys.size})`,
  );
  check(submissions.length >= 1, `the click reached the API (${submissions.length} submissions)`);

  await driveGame(page, { speak: false, timeoutMs: 240_000 });
  await abandonIfActive(api, sessionId);

  // Two tabs on one game, both submitting the same intent at the same moment.
  const beforeTwoTabs = submissions.length;
  const sharedId = await createGame(api, IDENTITIES.villager);
  await page.goto(`${baseUrl}/games/werewolf/${sharedId}`, { waitUntil: "domcontentloaded" });
  const second = await openTab(session);
  await second.goto(`${baseUrl}/games/werewolf/${sharedId}`, { waitUntil: "domcontentloaded" });
  check(await reachTargetTurn(page), "tab A reaches the human's vote turn");
  check(await reachTargetTurn(second), "tab B reaches the human's vote turn");

  const clicks = [];
  clicks.push(
    (async () => {
      await page.locator('button[data-testid^="seat-"]').first().click().catch(() => {});
      await page.locator('[data-testid="confirm-action"]').click().catch(() => {});
    })(),
  );
  clicks.push(
    (async () => {
      await second.locator('button[data-testid^="seat-"]').first().click().catch(() => {});
      await second.locator('[data-testid="confirm-action"]').click().catch(() => {});
    })(),
  );
  await Promise.all(clicks);

  await Promise.all([driveGame(page, { speak: false, timeoutMs: 240_000 }), second.waitForTimeout(2_000)]);

  const firstTab = await readTimeline(page);
  const secondTab = await readTimeline(second);
  for (const [name, entries] of [
    ["tab A", firstTab],
    ["tab B", secondTab],
  ]) {
    const violations = timelineViolations(entries);
    check(
      violations.length === 0,
      `${name}: two tabs never duplicate an advance (${violations.join("; ") || "clean"})`,
    );
  }
  check(
    (await second.locator('[data-testid="result-reveal"]').count()) === 1 ||
      (await page.locator('[data-testid="result-reveal"]').count()) === 1,
    "the shared game finishes while two tabs hold it",
  );
  const tabWindow = submissions.slice(beforeTwoTabs);
  const appliedByKey = new Map();
  for (const entry of tabWindow) {
    if (entry.applied !== true) continue;
    appliedByKey.set(entry.key, (appliedByKey.get(entry.key) ?? 0) + 1);
  }
  check(
    [...appliedByKey.values()].every((count) => count === 1),
    `no intent was applied twice while two tabs held the game (${JSON.stringify([...appliedByKey])})`,
  );
  check(
    tabWindow.every((entry) => entry.applied === true || entry.applied === false || entry.status === 409),
    `every tab submission was applied, replayed or refused as stale (${JSON.stringify(tabWindow.map((e) => [e.status, e.applied]))})`,
  );
  await second.close();
  await abandonIfActive(api, sharedId);
  fake.setPolicy("smallest");
  const listed = await api.get("/api/games/sessions?gameDefinitionId=quick6-v1");
  log(`  · lobby list after the idempotency scenario: ${listed.body?.sessions?.length ?? 0} session(s)`);
}

/**
 * The eliminated player keeps watching, with public information only.
 */
export async function scenarioSpectating({ session, baseUrl, api, fake, log, check }) {
  const { page } = session;
  fake.setMode("ok");
  fake.setPolicy("smallest"); // the human is the smallest seat, so they die early
  const sessionId = await createGame(api, IDENTITIES.seer);
  await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);

  // Night 1: the human seer checks someone, then the wolves kill seat 1.
  await page.locator('button[data-testid^="seat-"]').first().click();
  await page.locator('[data-testid="confirm-action"]').click();
  await page.waitForSelector('[data-testid="spectate-note"]', { timeout: 120_000 });

  check(
    (await page.locator('[data-testid="seat-state-0"]').textContent()) === "离场",
    "the eliminated seat stays in place and says 离场",
  );
  const identityText = (await page.locator('[data-testid="identity-card"]').textContent()) ?? "";
  check(identityText.includes("你已离场，可继续观战"), "the private card tells the player they are spectating");
  check(
    identityText.includes("仅自己可见"),
    "the spectate card keeps the private marking",
  );
  const actionText = (await page.locator('[data-testid="action-panel"]').textContent()) ?? "";
  check(actionText.includes("你已离场"), "the action area offers no controls after elimination");
  check(
    (await page.locator('[data-testid="confirm-action"]').count()) === 0,
    "an eliminated player is never offered an action",
  );
  check(
    (await page.locator('[data-testid="confirm-action"]').count()) === 0 &&
      (await page.locator('[data-testid="speech-send"]').count()) === 0,
    "an eliminated player is never offered a speech",
  );

  const before = (await readTimeline(page)).length;
  await driveGame(page, { speak: false, timeoutMs: 200_000 });
  const after = await readTimeline(page);
  check(after.length > before, `the public record keeps growing while spectating (${before} → ${after.length})`);
  check(
    (await page.locator('[data-testid="result-reveal"]').count()) === 1,
    "the spectated game reaches its end screen",
  );
  const reveal = (await page.locator('[data-testid="role-reveal"]').textContent()) ?? "";
  check(reveal.includes("预言家"), "the reveal shows the spectator their own dealt role among all six");
  check(timelineViolations(after).length === 0, "the spectated timeline never repeats an event");
  await abandonIfActive(api, sessionId);
  fake.setPolicy("smallest");
  void log;
}

/**
 * A provider outage must degrade, not break: every decision falls back
 * deterministically and the game still ends.
 */
export async function scenarioProviderFailure({ session, baseUrl, api, fake, log, check }) {
  const { page } = session;
  const before = fake.state.requests;
  fake.setMode("fail");

  const sessionId = await createGame(api, IDENTITIES.villager);
  await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);

  let sawDegraded = false;
  const watch = setInterval(() => {
    void page
      .locator('[data-testid="ai-status"][data-degraded="true"]')
      .count()
      .then((count) => {
        if (count > 0) sawDegraded = true;
      })
      .catch(() => {});
  }, 250);

  await driveGame(page, { speak: false, timeoutMs: 240_000 });
  clearInterval(watch);

  check(
    (await page.locator('[data-testid="result-reveal"]').count()) === 1,
    "a provider outage still reaches the end screen",
  );
  check(fake.state.requests > before, "the configured provider was actually exercised before it failed");
  check(
    sawDegraded,
    "the UI reported the simplified strategy instead of a provider error",
  );
  const panel = (await page.locator('[data-testid="action-panel"]').textContent()) ?? "";
  check(
    !/error|Error|500|deepseek|DeepSeek/i.test(panel) || panel.includes("已提交"),
    "no technical failure text appears in the action area",
  );
  const body = await page.content();
  check(!body.includes("deepseek") && !body.includes("DeepSeek"), "the DOM never names the provider");
  fake.setMode("ok");
  await abandonIfActive(api, sessionId);
  void log;
}

/**
 * Keyboard operation, focus, labels, aria-live and reduced motion.
 */
export async function scenarioAccessibility({ session, baseUrl, api, browser, fake, log, check }) {
  const { page } = session;
  fake.setPolicy("largest");
  const sessionId = await createGame(api, IDENTITIES.wolf);
  await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  await waitForHumanTurn(page, 60_000);

  // Every button carries an accessible name.
  const buttons = await page.locator("button").all();
  let unnamed = 0;
  for (const button of buttons) {
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    if (name.trim() === "") unnamed += 1;
  }
  check(unnamed === 0, `every button has a readable label (${buttons.length} buttons, ${unnamed} unnamed)`);

  // The seats are reachable and operable from the keyboard alone.
  const seat = page.locator('button[data-testid^="seat-"]').first();
  await seat.focus();
  check(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid")?.startsWith("seat-") === true),
    "a licensed seat can take keyboard focus",
  );
  await page.keyboard.press("Enter");
  check(
    (await seat.getAttribute("data-selected")) === "true",
    "Enter on a focused seat selects it",
  );
  let onConfirm = false;
  for (let press = 0; press < 8 && !onConfirm; press += 1) {
    await page.keyboard.press("Tab");
    onConfirm = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "confirm-action",
    );
  }
  check(onConfirm, "Tab walks the board to the confirm action from the keyboard");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  check(
    (await page.locator('[data-testid="submitted-note"]').count()) === 1 ||
      (await page.locator('[data-testid="waiting-note"]').count()) === 1 ||
      (await readTimeline(page)).some((entry) => entry.kind === "elimination"),
    "Enter on the confirm action submits the licensed choice",
  );

  // The polite live region reports phase movement.
  const live = page.locator('[data-testid="live-region"]');
  check((await live.getAttribute("aria-live")) === "polite", "the status region is a polite live region");
  await waitForHumanTurn(page, 60_000);
  check(
    ((await live.textContent()) ?? "").length > 0,
    "the live region carries a sentence for screen readers",
  );

  // Reduced motion: the animation neutralisation is in effect.
  const reduced = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await reduced.addCookies([
    { name: "authjs.session-token", value: session.cookie, url: baseUrl, httpOnly: true, sameSite: "Lax" },
  ]);
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
  const duration = await reducedPage.evaluate(() => {
    const node = document.querySelector('[data-testid="action-panel"] button');
    if (node === null) return null;
    const seconds = getComputedStyle(node).transitionDuration.replace(/[a-z]+$/, "");
    return Number(seconds);
  });
  check(
    duration !== null && duration <= 0.001,
    `reduced motion neutralises the transitions (duration ${duration}s)`,
  );
  await reduced.close();
  await page.goto(`${baseUrl}/games`, { waitUntil: "domcontentloaded" });
  await abandonIfActive(api, sessionId);
  void log;
}

/**
 * The ~390px mobile viewport: single column, 3×2 seats, thumb-zone action,
 * two recent events with 查看全部, and 44px+ touch targets.
 */
export async function scenarioMobile({ baseUrl, api, cookie, browser, fake, log, check }) {
  fake.setPolicy("largest");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.addCookies([
    { name: "authjs.session-token", value: cookie, url: baseUrl, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await mobile.newPage();
  try {
    await page.goto(`${baseUrl}/games`, { waitUntil: "domcontentloaded" });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(documentWidth <= 390 + 1, `the lobby does not scroll sideways at 390px (${documentWidth}px)`);
    if (documentWidth > 391) log(`  · overflowing elements: ${await widestElements(page)}`);

    const sessionId = await createGame(api, IDENTITIES.wolf);
    await page.goto(`${baseUrl}/games/werewolf/${sessionId}`, { waitUntil: "domcontentloaded" });
    await waitForHumanTurn(page, 60_000);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    check(overflow <= 390 + 1, `the board does not scroll sideways at 390px (${overflow}px)`);
    if (overflow > 391) log(`  · overflowing elements: ${await widestElements(page)}`);

    // Six seats, three per row, none hidden.
    const seatBoxes = await page.locator('[data-testid="seat-grid"] > li').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { top: Math.round(rect.top), left: Math.round(rect.left), width: rect.width, height: rect.height };
      }),
    );
    check(seatBoxes.length === 6, `the mobile board keeps all six seats (got ${seatBoxes.length})`);
    const rows = [...new Set(seatBoxes.map((box) => box.top))];
    check(rows.length === 2, `the six seats form two rows at 390px (got ${rows.length})`);
    const perRow = seatBoxes.filter((box) => box.top === rows[0]).length;
    check(perRow === 3, `three seats per row at 390px (got ${perRow})`);
    check(
      seatBoxes.every((box) => box.height >= 44),
      `every seat is at least 44px tall (min ${Math.min(...seatBoxes.map((b) => b.height))})`,
    );

    // The primary action sits in the thumb zone and clears the board.
    await page.locator('button[data-testid^="seat-"]').first().click();
    const confirmBox = await page.locator('[data-testid="confirm-action"]').boundingBox();
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    check(confirmBox !== null && confirmBox.height >= 48, `the primary action is at least 48px tall (${confirmBox?.height})`);
    check(
      confirmBox !== null && confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= viewport.height + 1,
      `the primary action is inside the viewport (y=${confirmBox?.y} h=${confirmBox?.height} vp=${viewport.height})`,
    );
    const seatBottom = Math.max(...seatBoxes.map((box) => box.top + box.height));
    check(
      confirmBox !== null && confirmBox.y >= seatBottom,
      "the pinned action panel does not cover the seat board",
    );

    // The speaking panel states why it is unavailable at night.
    const speechText = (await page.locator('[data-testid="speech-panel"]').textContent()) ?? "";
    check(
      speechText.includes("白天轮到你时可发言") || speechText.includes("轮到你发言"),
      "the night speaking panel explains why it is unavailable",
    );

    // The timeline shows the two most recent events with 查看全部.
    const visibleEntries = await page.locator('[data-testid="timeline-entry"]:visible').count();
    const allEntries = await page.locator('[data-testid="timeline-entry"]').count();
    check(visibleEntries <= 2, `the mobile timeline shows at most two rows (${visibleEntries})`);
    check(
      (await page.locator('button:has-text("查看全部")').count()) === 1,
      "the mobile timeline offers 查看全部",
    );
    // The pinned panel overlays the foot of the column, so bring the control
    // into the middle of the viewport before pressing it — a person scrolls.
    const expand = page.locator('button:has-text("查看全部")');
    await expand.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expand.click();
    const expanded = await page.locator('[data-testid="timeline-entry"]:visible').count();
    check(expanded === allEntries, `查看全部 reveals the whole record (${expanded}/${allEntries})`);

    // The identity strip stays identifiable while collapsed.
    const identity = (await page.locator('[data-testid="identity-card"]').textContent()) ?? "";
    check(identity.includes("我的身份") && identity.includes("仅自己可见"), "the compact identity strip stays identifiable");
    check(identity.includes("狼人"), "the compact strip shows the own role");

    await abandonIfActive(api, sessionId);
  } finally {
    await mobile.close();
  }
  void log;
}

/**
 * The canary scan: no internal name, provider detail or server-side state may
 * appear in the DOM, the RSC payload or any response — at any point.
 */
export function canaryHits(text, canaries) {
  if (typeof text !== "string" || text.length === 0) return [];
  return canaries.filter((canary) => text.includes(canary));
}
