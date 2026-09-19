/**
 * P2.1 domain security: the five visibility scopes, the single projectView
 * forward projector, and the canary leak matrix.
 *
 * For every game every hidden fact gets a unique canary: each seat's role,
 * each wolf-team membership, each seer check (round/target/isWolf) and the
 * deal seed. Every seat x role x phase x event-prefix state is then scanned:
 * for every viewer scope (PUBLIC / PLAYER / TEAM_WOLVES per seat /
 * POST_GAME) the projected OBJECT and its serialized JSON are asserted free
 * of every unauthorized canary — the leak counter must be exactly 0. After
 * the game ends, roles are revealed to everyone by rule (§7) while seer
 * checks and the seed stay private forever.
 *
 * The same scan runs over REPLAYED states at every event prefix
 * (replayQuick6), because reconnection and replay must reuse the projector.
 * A positive control proves the detectors are not vacuous: they fire on the
 * SYSTEM scope and on a deliberately leaking fabricated view.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_SEATS,
  createQuick6Engine,
  projectView,
  replayQuick6,
  seedBytesFromInt,
  seedBytesToHex,
  viewFor,
} from "@/lib/games/werewolf";
import type {
  ProjectedView,
  Quick6State,
  Role,
  SeatId,
  SeerCheckRecord,
  SystemView,
  Viewer,
} from "@/lib/games/werewolf";
import { playWithBoundaries, type DrivenGame } from "./drive";

// ---------------------------------------------------------------------------
// Fixtures: complete seat x role coverage across seven role arrangements
// (seat 0: W/A1 S/A2 V/A3 — seat 1: W/A1 V/A2 S/A4 — seat 2: S/A1 V/A2
//  W/A4 — seat 3: V/A1 W/A2 S/A5 — seat 4: V/A1 W/A2 S/A6 — seat 5:
//  V/A1 W/A3 S/A7), plus seeded deals (roles derived from the seed,
//  production path).
// ---------------------------------------------------------------------------

const ARRANGEMENTS: readonly (readonly Role[])[] = [
  ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"],
  ["SEER", "VILLAGER", "VILLAGER", "WOLF", "WOLF", "VILLAGER"],
  ["VILLAGER", "WOLF", "VILLAGER", "SEER", "VILLAGER", "WOLF"],
  ["VILLAGER", "SEER", "WOLF", "VILLAGER", "VILLAGER", "WOLF"],
  ["VILLAGER", "VILLAGER", "VILLAGER", "SEER", "WOLF", "WOLF"],
  ["VILLAGER", "VILLAGER", "WOLF", "WOLF", "SEER", "VILLAGER"],
  ["VILLAGER", "VILLAGER", "WOLF", "WOLF", "VILLAGER", "SEER"],
];

const SEEDED_GAME_SEEDS = [1001, 1002];

function driveAllGames(): DrivenGame[] {
  const games: DrivenGame[] = [];
  for (const roles of ARRANGEMENTS) {
    const seed = seedBytesFromInt(101);
    const engine = createQuick6Engine(seed, { start: { roles } });
    games.push(playWithBoundaries(engine, { roles }));
  }
  for (const int of SEEDED_GAME_SEEDS) {
    const seed = seedBytesFromInt(int);
    const engine = createQuick6Engine(seed);
    games.push(playWithBoundaries(engine, undefined));
  }
  return games;
}

// ---------------------------------------------------------------------------
// Canaries
// ---------------------------------------------------------------------------

interface Canary {
  readonly id: string;
  readonly kind: "role" | "wolfTeam" | "seerCheck" | "seed" | "internal";
  readonly seat: SeatId | null;
  readonly role: Role | null;
  readonly check: SeerCheckRecord | null;
  readonly token: string | null;
  /** True iff the viewer is entitled to this secret in the scanned state. */
  authorized(state: Quick6State, viewer: Viewer): boolean;
  /** True iff the projected view or its serialized JSON reveals the secret. */
  leakedIn(state: Quick6State, view: ProjectedView, json: string): boolean;
}

function isSeatViewer(viewer: Viewer): viewer is Extract<Viewer, { scope: "PLAYER" | "TEAM_WOLVES" }> {
  return viewer.scope === "PLAYER" || viewer.scope === "TEAM_WOLVES";
}

function asSeatView(view: ProjectedView): Extract<ProjectedView, { scope: "PLAYER" | "TEAM_WOLVES" }> | null {
  return view.scope === "PLAYER" || view.scope === "TEAM_WOLVES"
    ? (view as Extract<ProjectedView, { scope: "PLAYER" | "TEAM_WOLVES" }>)
    : null;
}

/** Object-tree walk: does the value contain the seed bytes in any form? */
function containsSeedBytes(value: unknown, seedBytes: Uint8Array): boolean {
  if (value instanceof Uint8Array) {
    return value.length === seedBytes.length && value.every((b, i) => b === seedBytes[i]);
  }
  if (Array.isArray(value)) return value.some((v) => containsSeedBytes(v, seedBytes));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => containsSeedBytes(v, seedBytes));
  }
  return false;
}

/** Internal sub-phase / engine-bookkeeping tokens that must never leave the server. */
const FORBIDDEN_TOKENS = [
  "NIGHT_SEER",
  "NIGHT_WOLF",
  "pending",
  "tiebreak",
  "nightWolfKills",
  "nightSeerTarget",
  "seerSubmitted",
  "seedBytes",
  "revision",
  "steps",
] as const;

function buildCanaries(state: Quick6State, seedBytes: Uint8Array): Canary[] {
  const seedHex = seedBytesToHex(seedBytes);
  const canaries: Canary[] = [];
  for (const t of ALL_SEATS) {
    const role = state.roles[t];
    canaries.push({
      id: `role:${t}`,
      kind: "role",
      seat: t,
      role,
      check: null,
      token: null,
      authorized: (scanned, viewer) =>
        (isSeatViewer(viewer) && viewer.seat === t) || scanned.phase === "END",
      leakedIn: (scanned, view) => {
        // Full-table reveal on ANY non-SYSTEM view (PUBLIC/POST_GAME/seat).
        if (view.scope !== "SYSTEM" && view.rolesRevealed !== null && view.rolesRevealed[t] === role) {
          return true;
        }
        // Cross-seat ownRole leak: only detectable when the roles differ.
        const seatView = asSeatView(view);
        if (
          seatView !== null &&
          seatView.seat !== t &&
          seatView.ownRole === role &&
          scanned.roles[seatView.seat] !== role
        ) {
          return true;
        }
        return false;
      },
    });
    if (role === "WOLF") {
      canaries.push({
        id: `wolfTeam:${t}`,
        kind: "wolfTeam",
        seat: t,
        role,
        check: null,
        token: null,
        authorized: (scanned, viewer) =>
          isSeatViewer(viewer) && scanned.roles[viewer.seat] === "WOLF" && scanned.alive[viewer.seat],
        leakedIn: (_scanned, view) => {
          // Any view carrying a wolfTeammates array that names seat t leaks it.
          const any = view as ProjectedView & { wolfTeammates?: SeatId[] };
          return Array.isArray(any.wolfTeammates) && any.wolfTeammates.includes(t);
        },
      });
    }
  }
  for (const check of state.seerChecks) {
    const fragment = JSON.stringify(check);
    canaries.push({
      id: `seerCheck:r${check.round}:t${check.target}`,
      kind: "seerCheck",
      seat: check.target,
      role: null,
      check,
      token: null,
      authorized: (scanned, viewer) =>
        isSeatViewer(viewer) && scanned.roles[viewer.seat] === "SEER" && scanned.alive[viewer.seat],
      leakedIn: (_scanned, view, json) => {
        const seatView = asSeatView(view);
        return (
          (seatView !== null &&
            seatView.seerChecks.some(
              (c) => c.round === check.round && c.target === check.target && c.isWolf === check.isWolf,
            )) ||
          json.includes(fragment)
        );
      },
    });
  }
  canaries.push({
    id: "seed",
    kind: "seed",
    seat: null,
    role: null,
    check: null,
    token: null,
    authorized: () => false,
    leakedIn: (_scanned, view, json) =>
      json.includes(seedHex) ||
      json.includes(seedHex.slice(0, 16)) ||
      json.includes('"seedBytes"') ||
      containsSeedBytes(view, seedBytes),
  });
  for (const token of FORBIDDEN_TOKENS) {
    canaries.push({
      id: `internal:${token}`,
      kind: "internal",
      seat: null,
      role: null,
      check: null,
      token,
      authorized: () => false,
      leakedIn: (_scanned, _view, json) => json.includes(token),
    });
  }
  return canaries;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function allViewers(): Viewer[] {
  const viewers: Viewer[] = [{ scope: "PUBLIC" }, { scope: "POST_GAME" }];
  for (const s of ALL_SEATS) {
    viewers.push({ scope: "PLAYER", seat: s });
    viewers.push({ scope: "TEAM_WOLVES", seat: s });
  }
  return viewers;
}

function describeViewer(viewer: Viewer): string {
  return isSeatViewer(viewer) ? `${viewer.scope}(${viewer.seat})` : viewer.scope;
}

interface Leak {
  readonly game: string;
  readonly prefix: number;
  readonly phase: string;
  readonly viewer: string;
  readonly secret: string;
}

/** Scan one state with every viewer scope; returns all leaks found. */
function scanMatrix(
  label: string,
  state: Quick6State,
  canaries: Canary[],
): { leaks: Leak[]; viewsChecked: number } {
  const leaks: Leak[] = [];
  let viewsChecked = 0;
  for (const viewer of allViewers()) {
    viewsChecked += 1;
    const view = projectView(state, viewer);
    const json = JSON.stringify(view);
    for (const canary of canaries) {
      if (canary.authorized(state, viewer)) continue;
      if (canary.leakedIn(state, view, json)) {
        leaks.push({
          game: label,
          prefix: state.events.length,
          phase: state.phase,
          viewer: describeViewer(viewer),
          secret: canary.id,
        });
      }
    }
  }
  return { leaks, viewsChecked };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("P2.1 可见性投影与 canary 泄露矩阵", () => {
  const games = driveAllGames();
  const allLeaks: Leak[] = [];
  let viewsChecked = 0;

  it("座位×角色×阶段×事件前缀矩阵：canary 泄露计数为 0", () => {
    for (const game of games) {
      for (const live of game.boundaries) {
        const canaries = buildCanaries(live, live.seedBytes);
        const prefix = live.events.length;
        const label = `game@${prefix}`;
        const liveScan = scanMatrix(label, live, canaries);
        allLeaks.push(...liveScan.leaks);
        viewsChecked += liveScan.viewsChecked;
        // Replayed prefix: same projector, same canary set — must be clean too.
        const replayed = replayQuick6(live.seedBytes, game.events.slice(0, prefix), game.options);
        expect(replayed.events.length).toBe(prefix);
        const replayScan = scanMatrix(`${label}|replay`, replayed, canaries);
        allLeaks.push(...replayScan.leaks);
        viewsChecked += replayScan.viewsChecked;
      }
      // Every event prefix, including mid-batch prefixes that no live state
      // ever exposes: the replayed state must be canary-free there too.
      const fullCanaries = buildCanaries(
        game.boundaries[game.boundaries.length - 1],
        game.boundaries[0].seedBytes,
      );
      for (let k = 1; k < game.events.length; k++) {
        const replayed = replayQuick6(
          game.boundaries[0].seedBytes,
          game.events.slice(0, k),
          game.options,
        );
        const replayScan = scanMatrix(`all-prefix@${k}|replay`, replayed, fullCanaries);
        allLeaks.push(...replayScan.leaks);
        viewsChecked += replayScan.viewsChecked;
      }
    }
    if (allLeaks.length > 0) {
      console.error(`CANARY LEAKS FOUND (${allLeaks.length}):`);
      for (const leak of allLeaks.slice(0, 50)) {
        console.error(`  ${leak.game} phase=${leak.phase} viewer=${leak.viewer} secret=${leak.secret}`);
      }
    }
    console.log(
      `canary matrix: ${games.length} games scanned, ${viewsChecked} views checked, ${allLeaks.length} leaks (must be 0)`,
    );
    expect(allLeaks).toEqual([]);
  });

  it("矩阵覆盖：每个座位以每种身份出现过，且四种对外阶段全部覆盖", () => {
    const seen = new Set<string>();
    const phases = new Set<string>();
    for (const game of games) {
      for (const state of game.boundaries) {
        for (const s of ALL_SEATS) seen.add(`${s}:${state.roles[s]}`);
        phases.add(state.phase);
      }
    }
    for (const s of ALL_SEATS) {
      for (const role of ["WOLF", "SEER", "VILLAGER"]) {
        expect(seen.has(`${s}:${role}`), `seat ${s} never covered as ${role}`).toBe(true);
      }
    }
    expect([...phases].sort()).toEqual(["DAY_DISCUSSION", "DAY_VOTE", "END", "NIGHT"]);
  });

  it("狼人只知道狼队、预言家只知道自己的查验、普通玩家只知道公开事实", () => {
    for (const game of games) {
      for (const state of game.boundaries) {
        const aliveWolves = ALL_SEATS.filter(
          (s) => state.alive[s] && state.roles[s] === "WOLF",
        );
        for (const s of ALL_SEATS) {
          const view = viewFor(state, s);
          expect(view.ownRole).toBe(state.roles[s]);
          if (state.roles[s] === "WOLF" && state.alive[s]) {
            expect([...view.wolfTeammates].sort()).toEqual(
              aliveWolves.filter((w) => w !== s),
            );
          } else {
            expect(view.wolfTeammates).toEqual([]);
          }
          if (state.roles[s] === "SEER" && state.alive[s]) {
            expect(view.seerChecks).toEqual([...state.seerChecks]);
          } else {
            expect(view.seerChecks).toEqual([]);
          }
          expect(view.phase).toBe(state.phase);
        }
      }
    }
  });

  it("游戏中角色永不揭示；游戏结束后按规则全揭示，查验与种子永不公开", () => {
    for (const game of games) {
      for (const state of game.boundaries) {
        if (state.phase !== "END") {
          for (const viewer of allViewers()) {
            const view = projectView(state, viewer);
            if (view.scope !== "SYSTEM") expect(view.rolesRevealed).toBeNull();
          }
          continue;
        }
        // END: full role reveal for every observer (§7), nothing else. The
        // seer check history stays private forever — even at END — except in
        // the living seer's own view (§7: 仅存活预言家可见).
        for (const viewer of allViewers()) {
          const view = projectView(state, viewer);
          if (view.scope === "SYSTEM") continue;
          expect(view.rolesRevealed).toEqual([...state.roles]);
          expect(view.outcome).not.toBeNull();
          const json = JSON.stringify(view);
          expect(json).not.toContain(seedBytesToHex(state.seedBytes).slice(0, 16));
          // TEAM_WOLVES requested by a non-wolf degrades to the PLAYER view,
          // so the living seer still sees exactly their own checks there.
          const isLivingSeer =
            (viewer.scope === "PLAYER" || viewer.scope === "TEAM_WOLVES") &&
            state.roles[viewer.seat] === "SEER" &&
            state.alive[viewer.seat];
          for (const check of state.seerChecks) {
            if (isLivingSeer) continue;
            expect(json).not.toContain(JSON.stringify(check));
          }
        }
      }
    }
  });

  it("SYSTEM 仅服务端：唯一携带完整 state 的范围（canary 检测器非空转的正向控制）", () => {
    const state = games[0].boundaries[games[0].boundaries.length - 1];
    const systemView = projectView(state, { scope: "SYSTEM" }) as SystemView;
    expect(systemView.scope).toBe("SYSTEM");
    expect(systemView.state).toBe(state);
    const json = JSON.stringify(systemView);
    expect(json).toContain('"seedBytes"');
    expect(json).toContain('"roles"');
    expect(json).toContain('"seerChecks"');
    expect(json).toContain('"nightWolfKills"');
    // The very same detector primitives used by the matrix must fire here:
    const seedCanary = buildCanaries(state, state.seedBytes).find((c) => c.kind === "seed");
    expect(seedCanary?.leakedIn(state, systemView, json)).toBe(true);
    expect(json.includes(seedBytesToHex(state.seedBytes))).toBe(false); // Uint8Array, detected by walk
    expect(containsSeedBytes(systemView, state.seedBytes)).toBe(true);
  });

  it("正向控制：蓄意泄露全部秘密的伪造视图被 canary 检测器全部捕获", () => {
    const game = games[0];
    const live = game.boundaries.find((s) => s.phase === "DAY_VOTE") ?? game.boundaries[0];
    expect(live.phase).not.toBe("END");
    const seedHex = seedBytesToHex(live.seedBytes);
    const malicious = {
      scope: "PLAYER",
      seat: 99,
      phase: live.phase,
      round: live.round,
      seats: [...ALL_SEATS],
      aliveSeats: [...ALL_SEATS],
      humanSeat: 0,
      eliminations: [],
      speeches: [],
      votes: [],
      outcome: null,
      rolesRevealed: [...live.roles], // leak: full role table before END
      ownRole: "WOLF" as Role, // leak: a role this seat does not hold
      wolfTeammates: [0, 1], // leak: team membership
      seerChecks: [...live.seerChecks], // leak: check history
      ownNightSubmission: null,
      leakSeed: seedHex, // leak: seed hex
    };
    const json = JSON.stringify(malicious);
    const caught = new Set<string>();
    for (const canary of buildCanaries(live, live.seedBytes)) {
      if (!canary.authorized(live, { scope: "PUBLIC" }) && canary.leakedIn(live, malicious as unknown as ProjectedView, json)) {
        caught.add(canary.id);
      }
    }
    expect(caught.has("seed")).toBe(true);
    expect(caught.has("role:0")).toBe(true);
    expect(caught.has("wolfTeam:0")).toBe(true);
    if (live.seerChecks.length > 0) {
      expect([...caught].some((id) => id.startsWith("seerCheck:"))).toBe(true);
    }
    for (const token of FORBIDDEN_TOKENS) {
      expect(caught.has(`internal:${token}`)).toBe(false); // none of these leaked here
    }
  });

  it("对外阶段名泛化：投影与事件只出现四种对外阶段", () => {
    for (const game of games) {
      for (const state of game.boundaries) {
        for (const viewer of allViewers()) {
          const view = projectView(state, viewer);
          if (view.scope === "SYSTEM") continue;
          expect(["NIGHT", "DAY_DISCUSSION", "DAY_VOTE", "END"]).toContain(view.phase);
        }
      }
      for (const event of game.events) {
        if (event.payload.type === "PHASE") {
          expect(["NIGHT", "DAY_DISCUSSION", "DAY_VOTE", "END"]).toContain(event.payload.phase);
        }
      }
    }
  });
});
