/**
 * P2.1 deterministic event replay: contiguous append-only event indexes,
 * replay from (seedBytes, options, event stream), prefix replay, full-replay
 * equality with the live snapshot, byte-for-byte determinism, and explicit
 * rejection of corrupted / duplicate / gapped / out-of-order events.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_SEATS,
  createQuick6Engine,
  projectView,
  replayQuick6,
  seedBytesFromInt,
} from "@/lib/games/werewolf";
import type {
  Quick6Event,
  Quick6StartOptions,
  Role,
  Viewer,
} from "@/lib/games/werewolf";
import { ReplayError } from "@/lib/games/werewolf";
import { playWithBoundaries, type DrivenGame } from "./drive";

const ARRANGEMENTS: readonly (readonly Role[])[] = [
  ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"],
  ["SEER", "VILLAGER", "VILLAGER", "WOLF", "WOLF", "VILLAGER"],
];

function driveGames(): DrivenGame[] {
  const games: DrivenGame[] = [];
  for (const roles of ARRANGEMENTS) {
    const engine = createQuick6Engine(seedBytesFromInt(101), { start: { roles } });
    games.push(playWithBoundaries(engine, { roles }));
  }
  for (const int of [1001, 1002]) {
    const engine = createQuick6Engine(seedBytesFromInt(int));
    games.push(playWithBoundaries(engine, undefined));
  }
  return games;
}

const CLIENT_VIEWERS: readonly Viewer[] = [
  { scope: "PUBLIC" },
  { scope: "POST_GAME" },
  ...ALL_SEATS.map((seat) => ({ scope: "PLAYER", seat } as const)),
];

describe("P2.1 确定性事件重放", () => {
  const games = driveGames();

  it("事件序号连续：live 引擎每步 events[i].index === i 且 revision 非降", () => {
    for (const game of games) {
      for (const state of game.boundaries) {
        let prevRevision = -1;
        state.events.forEach((event, i) => {
          expect(event.index).toBe(i);
          expect(event.revision).toBeGreaterThanOrEqual(prevRevision);
          prevRevision = event.revision;
        });
      }
      expect(game.events.length).toBeGreaterThan(0);
      expect(game.events[game.events.length - 1].payload).toMatchObject({ type: "PHASE", phase: "END" });
    }
  });

  it("任意前缀可重放：每个前缀（含批次中间）都成功折叠且事件数等于前缀长度", () => {
    for (const game of games) {
      for (let k = 1; k <= game.events.length; k++) {
        const replayed = replayQuick6(
          game.boundaries[0].seedBytes,
          game.events.slice(0, k),
          game.options,
        );
        expect(replayed.events.length).toBe(k);
        replayed.events.forEach((event, i) => expect(event.index).toBe(i));
      }
    }
  });

  it("每个事件前缀的客户端投影与 live 快照深度相等（本人夜提交与查验史为唯一合法差异）", () => {
    // PUBLIC/POST_GAME views are fully event-derivable and must match
    // exactly. Seat views match too, except the two purely private channels
    // of §7 that never enter the public event stream and therefore cannot be
    // reconstructed by replay: ownNightSubmission (the submitter's buffered
    // target) and seerChecks (the seer's own check history). The replayed
    // view carries the neutral values (null / []) where live carries the
    // seat's own private data — absence, never a leak (the canary matrix
    // asserts exactly this).
    const comparable = (view: ReturnType<typeof projectView>): ReturnType<typeof projectView> =>
      view.scope === "PLAYER" || view.scope === "TEAM_WOLVES"
        ? { ...view, ownNightSubmission: null, seerChecks: [] }
        : view;
    for (const game of games) {
      for (const live of game.boundaries) {
        const prefix = live.events.length;
        const replayed = replayQuick6(
          live.seedBytes,
          game.events.slice(0, prefix),
          game.options,
        );
        for (const viewer of CLIENT_VIEWERS) {
          expect(
            comparable(projectView(replayed, viewer)),
            `game prefix ${prefix} viewer ${JSON.stringify(viewer)}`,
          ).toEqual(comparable(projectView(live, viewer)));
        }
        // The replayed private channels are always neutral — replay never
        // fabricates private data it did not derive from events.
        for (const seat of ALL_SEATS) {
          const replayedView = projectView(replayed, { scope: "PLAYER", seat });
          if (replayedView.scope === "PLAYER" || replayedView.scope === "TEAM_WOLVES") {
            expect(replayedView.seerChecks).toEqual([]);
            expect(replayedView.ownNightSubmission).toBeNull();
          }
        }
        expect(replayed.outcome).toEqual(live.outcome);
      }
    }
  });

  it("完整重放与终局快照深度相等（唯一例外：§7 私有的 seerChecks 不进入事件流）", () => {
    for (const game of games) {
      const live = game.boundaries[game.boundaries.length - 1];
      expect(live.phase).toBe("END");
      const replayed = replayQuick6(live.seedBytes, game.events, game.options);
      expect(replayed).toEqual({ ...live, seerChecks: [] });
      // The only divergence is exactly the private seer history — nothing else.
      expect(replayed.roles).toEqual([...live.roles]);
      expect(replayed.alive).toEqual([...live.alive]);
      expect(replayed.eliminations).toEqual([...live.eliminations]);
      expect(replayed.speeches).toEqual([...live.speeches]);
      expect(replayed.votes).toEqual([...live.votes]);
      expect(replayed.round).toBe(live.round);
      expect(replayed.revision).toBe(live.revision);
      expect(replayed.steps).toBe(live.revision); // steps ≡ revision
    }
  });

  it("同 seed、同选项、同事件流 → 重放字节级一致；两次 live 对局事件流完全一致", () => {
    for (const game of games) {
      const seed = game.boundaries[0].seedBytes;
      const options = game.options;
      const first = replayQuick6(seed, game.events, options);
      const second = replayQuick6(seed, game.events, options);
      expect(JSON.stringify(first, (_k, v) => (v instanceof Uint8Array ? [...v] : v))).toBe(
        JSON.stringify(second, (_k, v) => (v instanceof Uint8Array ? [...v] : v)),
      );
    }
    // Two independent live games with the same seed and options produce the
    // same event stream and the same outcome.
    for (const roles of ARRANGEMENTS) {
      const options: Quick6StartOptions = { roles };
      const a = createQuick6Engine(seedBytesFromInt(101), { start: options });
      const b = createQuick6Engine(seedBytesFromInt(101), { start: options });
      const runA = playWithBoundaries(a, options);
      const runB = playWithBoundaries(b, options);
      expect(runB.events).toEqual(runA.events);
      expect(runB.boundaries[runB.boundaries.length - 1].outcome).toEqual(
        runA.boundaries[runA.boundaries.length - 1].outcome,
      );
      expect(
        replayQuick6(seedBytesFromInt(101), runB.events, options),
      ).toEqual(replayQuick6(seedBytesFromInt(101), runA.events, options));
    }
  });

  it("损坏事件被明确拒绝（MALFORMED_PAYLOAD / UNKNOWN_EVENT_TYPE）", () => {
    const game = games[0];
    const seed = game.boundaries[0].seedBytes;
    const options = game.options;
    const phaseIndex = game.events.findIndex((e) => e.payload.type === "PHASE" && e.index > 0);

    const badPhase = game.events.map((e, i) =>
      i === phaseIndex
        ? { ...e, payload: { ...e.payload, type: "PHASE", phase: "NIGHT_SEER" } }
        : e,
    ) as Quick6Event[];
    expect(() => replayQuick6(seed, badPhase, options)).toThrowError(ReplayError);
    try {
      replayQuick6(seed, badPhase, options);
    } catch (error) {
      expect((error as ReplayError).code).toBe("MALFORMED_PAYLOAD");
    }

    const unknownType = game.events.map((e, i) =>
      i === 3 ? { ...e, payload: { ...e.payload, type: "BOGUS_EVENT" } } : e,
    ) as Quick6Event[];
    try {
      replayQuick6(seed, unknownType, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("UNKNOWN_EVENT_TYPE");
    }

    const badRound = game.events.map((e, i) =>
      i === phaseIndex
        ? { ...e, payload: { ...e.payload, type: "PHASE", round: 999 } }
        : e,
    ) as Quick6Event[];
    try {
      replayQuick6(seed, badRound, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("重复、断序（缺口）与乱序事件被明确拒绝（NON_CONTIGUOUS_INDEX）", () => {
    const game = games[0];
    const seed = game.boundaries[0].seedBytes;
    const options = game.options;

    const duplicated = [
      ...game.events.slice(0, 5),
      game.events[5],
      ...game.events.slice(5),
    ] as Quick6Event[];
    try {
      replayQuick6(seed, duplicated, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("NON_CONTIGUOUS_INDEX");
    }

    const gapped = game.events.filter((e) => e.index !== 7) as Quick6Event[];
    try {
      replayQuick6(seed, gapped, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("NON_CONTIGUOUS_INDEX");
    }

    const reordered = game.events.map((e, i) => (i === 3 ? game.events[4] : i === 4 ? game.events[3] : e)) as Quick6Event[];
    try {
      replayQuick6(seed, reordered, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("NON_CONTIGUOUS_INDEX");
    }
  });

  it("非法转移与自相矛盾的结局被明确拒绝（ILLEGAL_TRANSITION / INCONSISTENT_OUTCOME）", () => {
    const game = games[0];
    const seed = game.boundaries[0].seedBytes;
    const options = game.options;

    const speechIndex = game.events.findIndex((e) => e.payload.type === "SPEECH");
    expect(speechIndex).toBeGreaterThan(-1);
    const outOfOrder = game.events.map((e, i) =>
      i === speechIndex
        ? {
            ...e,
            payload: {
              ...e.payload,
              type: "SPEECH",
              record: { ...(e.payload as { record: object }).record, seat: (ALL_SEATS.find((s) => s !== (e.payload as { record: { seat: number } }).record.seat) ?? 0) },
            },
          }
        : e,
    ) as Quick6Event[];
    try {
      replayQuick6(seed, outOfOrder, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("ILLEGAL_TRANSITION");
    }

    const gameOverIndex = game.events.findIndex((e) => e.payload.type === "GAME_OVER");
    expect(gameOverIndex).toBeGreaterThan(-1);
    const flipped = game.events.map((e, i) =>
      i === gameOverIndex
        ? {
            ...e,
            payload: {
              ...e.payload,
              type: "GAME_OVER",
              winner: (e.payload as { winner: string }).winner === "WOLF" ? "TOWN" : "WOLF",
            },
          }
        : e,
    ) as Quick6Event[];
    try {
      replayQuick6(seed, flipped, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("INCONSISTENT_OUTCOME");
    }
  });

  it("空事件流、首事件不符与非法 revision 被明确拒绝", () => {
    const game = games[0];
    const seed = game.boundaries[0].seedBytes;
    const options = game.options;

    try {
      replayQuick6(seed, [], options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("EMPTY_EVENT_STREAM");
    }

    const wrongFirst = game.events.map((e, i) =>
      i === 0 ? { ...e, payload: { type: "PHASE", round: 2, phase: "NIGHT" } } : e,
    ) as Quick6Event[];
    try {
      replayQuick6(seed, wrongFirst, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("FIRST_EVENT_MISMATCH");
    }

    const badRevision = game.events.map((e, i) => (i === 5 ? { ...e, revision: 9999 } : e)) as Quick6Event[];
    try {
      replayQuick6(seed, badRevision, options);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ReplayError).code).toBe("INVALID_REVISION");
    }
  });
});
