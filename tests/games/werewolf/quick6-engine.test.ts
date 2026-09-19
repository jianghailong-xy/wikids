/**
 * Production quick6 engine: every decision table of docs/quick6-v1-rules.md
 * asserted against lib/games/werewolf (not the test reference model):
 * configuration, night rules (legal targets, simultaneous submission, the
 * versioned PRNG tiebreak, seer-dies-same-night), day rules (seat order,
 * explicit skip, mandatory votes, ties), win timing, elimination/reveal
 * visibility, abnormal step protection, terminal absorption, phase
 * generalization and seed secrecy.
 */
import { describe, expect, it } from "vitest";

import { GameEngine, IllegalActionError, StepLimitError } from "@/lib/games/core";
import {
  ALL_SEATS,
  Quick6Definition,
  aiContextFor,
  createQuick6Engine,
  publicProjection,
  seedBytesFromInt,
  seedBytesToHex,
  viewFor,
} from "@/lib/games/werewolf";
import type {
  ExternalPhase,
  Quick6Command,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  Role,
  SeatView,
  PublicProjection,
} from "@/lib/games/werewolf";
import { QUICK6_TEST_SEED_BYTES } from "@/tests/fixtures/determinism";

const SEED = seedBytesFromInt(0x51a6c0de);
const W = "WOLF";
const S = "SEER";
const V = "VILLAGER";

export type Quick6Engine = GameEngine<
  Quick6State,
  Quick6Command,
  SeatView,
  PublicProjection,
  Quick6EventPayload
>;

function engine(
  roles?: readonly Role[],
  opts: { start?: Quick6StartOptions; maxPhaseSteps?: number } = {},
): Quick6Engine {
  const definition = new Quick6Definition(
    opts.maxPhaseSteps === undefined ? {} : { maxPhaseSteps: opts.maxPhaseSteps },
  );
  const start = roles ? { ...opts.start, roles } : opts.start;
  return new GameEngine(definition, SEED, start);
}

/** Fresh engine, night 1 resolved with both wolves killing `victim`. */
function afterNight1(roles: readonly Role[], victim: number, seerTarget: number): Quick6Engine {
  const e = engine(roles);
  for (const w of ALL_SEATS) {
    if (roles[w] === "WOLF") e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: w, target: victim });
  }
  const seer = ALL_SEATS.find((s) => roles[s] === "SEER");
  if (seer !== undefined) e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: seer, target: seerTarget });
  e.dispatch({ type: "FINISH_NIGHT" });
  return e;
}

/** Everyone alive speaks/skips in seat order, then discussion ends. */
function finishDiscussion(e: Quick6Engine, texts: Record<number, string | null> = {}): void {
  for (;;) {
    const next = ALL_SEATS.find(
      (s) =>
        e.state.alive[s] &&
        !e.state.speeches.some((sp) => sp.round === e.state.round && sp.seat === s),
    );
    if (next === undefined) break;
    e.dispatch({ type: "SUBMIT_SPEECH", seat: next, text: texts[next] ?? null });
  }
  e.dispatch({ type: "FINISH_DISCUSSION" });
}

const PHASES: readonly ExternalPhase[] = ["NIGHT", "DAY_DISCUSSION", "DAY_VOTE", "END"];
const FORBIDDEN_TOKENS = ["NIGHT_SEER", "NIGHT_WOLF", "PENDING", "pending"];

describe("quick6 配置与开局（生产引擎）", () => {
  it("冻结 6 席：1 真人 + 5 AI，2 狼 / 1 预言家 / 3 平民，从 NIGHT 开始", () => {
    const e = engine();
    expect(ALL_SEATS).toHaveLength(6);
    expect(e.state.humanSeat).toBe(0);
    expect(e.state.roles.filter((r) => r === "WOLF")).toHaveLength(2);
    expect(e.state.roles.filter((r) => r === "SEER")).toHaveLength(1);
    expect(e.state.roles.filter((r) => r === "VILLAGER")).toHaveLength(3);
    expect(e.state.phase).toBe("NIGHT");
    expect(e.state.round).toBe(1);
    expect(e.state.alive.every(Boolean)).toBe(true);
    expect(e.state.outcome).toBeNull();
    expect(e.state.revision).toBe(0);
    expect(publicProjection(e.state).rolesRevealed).toBeNull();
  });

  it("拒绝非法的固定角色表与非真人座位", () => {
    expect(() => engine([W, W, W, S, V, V])).toThrow(IllegalActionError);
    expect(() => engine([W, W, S, V, V])).toThrow(IllegalActionError);
    expect(() => engine(undefined, { start: { humanSeat: 6 } })).toThrow(IllegalActionError);
  });

  it("生产发牌与冻结夹具一致（QUICK6_TEST_SEED）", () => {
    const e = createQuick6Engine(QUICK6_TEST_SEED_BYTES);
    expect([...e.state.roles]).toEqual(["SEER", "VILLAGER", "WOLF", "VILLAGER", "WOLF", "VILLAGER"]);
  });
});

describe("quick6 夜间规则（生产引擎）", () => {
  it("首夜即可淘汰：多狼同票直接生效，公开座位 ID 但不公开身份", () => {
    const e = afterNight1([W, W, S, V, V, V], 3, 1);
    expect([...e.state.eliminations]).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 3 }]);
    expect(e.state.alive[3]).toBe(false);
    expect(e.state.phase).toBe("DAY_DISCUSSION");
    const pub = publicProjection(e.state);
    expect(pub.rolesRevealed).toBeNull();
    expect(JSON.stringify(pub.eliminations)).not.toContain("WOLF");
    expect(JSON.stringify(pub.eliminations)).not.toContain("SEER");
    expect(JSON.stringify(pub.eliminations)).not.toContain("VILLAGER");
  });

  it("单狼直接生效", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 1], [1, 2], [2, 1], [3, 1], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐狼 1
    expect(e.state.phase).toBe("NIGHT");
    expect(e.state.round).toBe(2);
    expect(e.state.alive[1]).toBe(false);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 3 });
    e.dispatch({ type: "FINISH_NIGHT" });
    expect([...e.state.eliminations].at(-1)).toEqual({ round: 2, kind: "NIGHT_KILL", seat: 2 });
  });

  it("多狼不同票：版本化 PRNG 在并列目标中定夺，可重放且与提交顺序无关", () => {
    const victimOf = (submitOrder: "01" | "10"): number => {
      const e = engine([W, W, S, V, V, V]);
      if (submitOrder === "01") {
        e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
        e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 });
      } else {
        e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 });
        e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
      }
      e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 4 });
      e.dispatch({ type: "FINISH_NIGHT" });
      return e.state.eliminations[0].seat;
    };
    const first = victimOf("01");
    expect([2, 3]).toContain(first); // 受害者必来自并列目标集合
    expect(victimOf("01")).toBe(first); // 相同 seed 与目标集合 → 完全可重放
    expect(victimOf("10")).toBe(first); // 同时提交：顺序无关
  });

  it("狼刀非法目标全部拒绝（细粒度 code，状态不变）", () => {
    const e = afterNight1([W, W, S, V, V, V], 3, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 2], [1, 4], [2, 4], [4, 0], [5, 2]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 平票，无人离场
    expect(e.state.alive[0] && e.state.alive[1]).toBe(true);
    const rejects = (command: Quick6Command, code: string) => {
      const before = JSON.stringify(e.state);
      const revision = e.state.revision;
      try {
        e.dispatch(command);
        throw new Error(`expected rejection for ${command.type}`);
      } catch (error) {
        expect(error).toBeInstanceOf(IllegalActionError);
        expect((error as IllegalActionError).code).toBe(code);
      }
      expect(JSON.stringify(e.state)).toBe(before);
      expect(e.state.revision).toBe(revision);
    };
    rejects({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 0 }, "SELF_TARGET");
    rejects({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 }, "ILLEGAL_TARGET");
    rejects({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 }, "DEAD_TARGET");
    rejects({ type: "SUBMIT_WOLF_KILL", seat: 2, target: 5 }, "UNAUTHORIZED_ROLE");
    rejects({ type: "SUBMIT_WOLF_KILL", seat: 3, target: 4 }, "DEAD_ACTOR");
  });

  it("查验：目标必须存活且非自己；允许跨夜重复查验；每夜至多一次", () => {
    const e = engine([W, W, S, V, V, V]);
    expect(() => e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 2 })).toThrow(IllegalActionError);
    expect(() => e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 0, target: 3 })).toThrow(/UNAUTHORIZED_ROLE/);
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 3 });
    expect(() => e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 4 })).toThrow(/DUPLICATE_ACTION/);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 5 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 5 });
    e.dispatch({ type: "FINISH_NIGHT" });
    expect([...e.state.seerChecks]).toEqual([{ round: 1, target: 3, isWolf: false }]);

    finishDiscussion(e);
    for (const [s, t] of [[0, 1], [1, 2], [2, 1], [3, 1], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐狼 1，游戏继续
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 4 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 3 });
    e.dispatch({ type: "FINISH_NIGHT" });
    expect([...e.state.seerChecks]).toEqual([
      { round: 1, target: 3, isWolf: false },
      { round: 2, target: 3, isWolf: false },
    ]);
  });

  it("预言家同夜离场：查验仍生效并保留", () => {
    const e = engine([W, W, S, V, V, V]);
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 }); // 查验狼 1
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 }); // 双狼刀预言家
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 2 });
    e.dispatch({ type: "FINISH_NIGHT" });
    expect(e.state.alive[2]).toBe(false);
    expect([...e.state.seerChecks]).toEqual([{ round: 1, target: 1, isWolf: true }]);
    expect([...e.state.eliminations]).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 2 }]);
  });

  it("夜间必交动作未交齐时拒绝结算", () => {
    const e = engine([W, W, S, V, V, V]);
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(/未提交夜间目标/);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(/未提交夜间目标/);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 });
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(/预言家未提交查验/);
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 0 });
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).not.toThrow();
  });

  it("夜间动作在结算前互相不可见：狼人互相看不到对方的提交", () => {
    const e = engine([W, W, S, V, V, V]);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 4 });
    const view0 = viewFor(e.state, 0);
    const view1 = viewFor(e.state, 1);
    expect(JSON.stringify(view0)).not.toContain("nightWolfKills");
    expect(JSON.stringify(view1)).not.toContain("nightWolfKills");
    expect(JSON.stringify(view0)).not.toContain("nightSeerTarget");
  });
});

describe("quick6 白天规则（生产引擎）", () => {
  it("发言必须按座位顺序、允许显式跳过、插队/重复被拒", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1); // alive 0,1,2,3,4
    expect(() => e.dispatch({ type: "SUBMIT_SPEECH", seat: 3, text: "插队" })).toThrow(/座位顺序/);
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 0, text: null }); // 显式跳过
    expect(() => e.dispatch({ type: "SUBMIT_SPEECH", seat: 2, text: "插队" })).toThrow(/座位顺序/);
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 1, text: "白天好" });
    expect(() => e.dispatch({ type: "SUBMIT_SPEECH", seat: 0, text: "重复" })).toThrow(/座位顺序/);
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 2, text: null });
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 3, text: "大家好" });
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 4, text: null });
    e.dispatch({ type: "FINISH_DISCUSSION" });
    expect(e.state.phase).toBe("DAY_VOTE");
    expect([...e.state.speeches]).toEqual([
      { round: 1, seat: 0, text: null },
      { round: 1, seat: 1, text: "白天好" },
      { round: 1, seat: 2, text: null },
      { round: 1, seat: 3, text: "大家好" },
      { round: 1, seat: 4, text: null },
    ]);
  });

  it("后发 AI 只看已公开的前序发言", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 0, text: "一号发言" });
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 1, text: null });
    expect(aiContextFor(e.state, 2).speeches.map((s) => s.seat)).toEqual([0, 1]);
    expect(aiContextFor(e.state, 4).speeches.map((s) => s.seat)).toEqual([0, 1]);
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 2, text: "二号发言" });
    e.dispatch({ type: "SUBMIT_SPEECH", seat: 3, text: null });
    expect(aiContextFor(e.state, 4).speeches.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    expect(aiContextFor(e.state, 2).wolfTeammates).toEqual([]);
    expect(aiContextFor(e.state, 0).wolfTeammates).toEqual([1]);
    expect(aiContextFor(e.state, 2).seerChecks).toEqual([{ round: 1, target: 1, isWolf: true }]);
    expect(aiContextFor(e.state, 0).seerChecks).toEqual([]);
  });

  it("投票：必投、禁自投、禁弃票、禁重复；最高票淘汰", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    expect(() => e.dispatch({ type: "FINISH_VOTE" })).toThrow(/不得弃票/);
    expect(() => e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: 0, target: 0 })).toThrow(/不得自投/);
    expect(() => e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: 0, target: 5 })).toThrow(/目标已死亡/);
    for (const [s, t] of [[0, 1], [1, 0], [2, 1], [3, 1], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    expect(() => e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: 0, target: 2 })).toThrow(/已投票/);
    e.dispatch({ type: "FINISH_VOTE" });
    expect([...e.state.eliminations].at(-1)).toEqual({ round: 1, kind: "DAY_EXILE", seat: 1 });
    expect(e.state.alive[1]).toBe(false);
    expect(e.state.round).toBe(2);
    expect(e.state.phase).toBe("NIGHT");
  });

  it("平票：无人离场，不重投", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 2], [1, 3], [2, 3], [3, 0], [4, 2]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" });
    expect([...e.state.eliminations]).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 5 }]);
    expect(e.state.alive.filter(Boolean)).toHaveLength(5);
    expect(e.state.phase).toBe("NIGHT");
    expect(e.state.round).toBe(2);
  });
});

describe("quick6 胜负判定（生产引擎）", () => {
  it("狼为 0 → 好人胜（白天放逐最后一只狼后立即结算）", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 1], [1, 2], [2, 1], [3, 1], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 4 });
    e.dispatch({ type: "FINISH_NIGHT" });
    finishDiscussion(e);
    for (const [s, t] of [[0, 4], [3, 0], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐最后一只狼 0
    expect(e.state.outcome).toEqual({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" });
    expect(e.state.phase).toBe("END");
    const gameOver = e.state.events.filter((ev) => ev.payload.type === "GAME_OVER");
    expect(gameOver.at(-1)?.payload).toEqual({
      type: "GAME_OVER",
      winner: "TOWN",
      reason: "WOLVES_EXTERMINATED",
    });
  });

  it("存活狼数 ≥ 其他存活人数 → 狼人胜（夜间淘汰后结算）", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 2], [1, 3], [2, 3], [3, 0], [4, 2]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 平票
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 4 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 4 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 });
    e.dispatch({ type: "FINISH_NIGHT" });
    expect(e.state.outcome).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(e.state.phase).toBe("END");
  });

  it("存活狼数 ≥ 其他存活人数 → 狼人胜（白天淘汰后结算）", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 4], [1, 4], [2, 4], [3, 4], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐 4 → 2W + 2 others → 狼人胜
    expect(e.state.outcome).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(e.state.phase).toBe("END");
  });

  it("平票无人离场时胜负检查不误报，游戏继续", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 2], [1, 3], [2, 3], [3, 0], [4, 2]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" });
    expect(e.state.outcome).toBeNull();
    expect(e.state.phase).toBe("NIGHT");
  });
});

describe("quick6 离场、揭示与观战（生产引擎）", () => {
  it("离场不揭示身份，END 后全揭示", () => {
    const e = afterNight1([W, W, S, V, V, V], 3, 1);
    expect(publicProjection(e.state).rolesRevealed).toBeNull();
    finishDiscussion(e);
    for (const [s, t] of [[0, 1], [1, 2], [2, 1], [4, 1], [5, 1]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐狼 1
    expect(e.state.outcome).toBeNull();
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 0 });
    e.dispatch({ type: "FINISH_NIGHT" });
    finishDiscussion(e);
    for (const [s, t] of [[0, 4], [4, 0], [5, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // 放逐最后一只狼 → TOWN_WIN
    const end = publicProjection(e.state);
    expect(end.phase).toBe("END");
    expect(end.rolesRevealed).toEqual([W, W, S, V, V, V]);
    expect(end.outcome).toEqual({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" });
  });

  it("死者只能看公开信息并观战", () => {
    const e = afterNight1([W, W, S, V, V, V], 2, 1); // 预言家第 1 夜死亡
    const deadSeer = viewFor(e.state, 2);
    expect(deadSeer.ownRole).toBe(S);
    expect(deadSeer.seerChecks).toEqual([]);
    expect(deadSeer.wolfTeammates).toEqual([]);
    expect(viewFor(e.state, 0).wolfTeammates).toEqual([1]);
    expect(viewFor(e.state, 1).wolfTeammates).toEqual([0]);
    expect(viewFor(e.state, 3).wolfTeammates).toEqual([]);
  });

  it("END 后拒绝一切游戏动作（终局吸收，状态不变）", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(e);
    for (const [s, t] of [[0, 4], [1, 4], [2, 4], [3, 4], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" }); // WOLF_WIN, END
    expect(e.state.phase).toBe("END");
    const before = JSON.stringify(e.state);
    const commands: Quick6Command[] = [
      { type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 },
      { type: "SUBMIT_SEER_CHECK", seat: 2, target: 0 },
      { type: "SUBMIT_SPEECH", seat: 0, text: "x" },
      { type: "SUBMIT_DAY_VOTE", seat: 0, target: 2 },
      { type: "FINISH_NIGHT" },
      { type: "FINISH_VOTE" },
    ];
    for (const command of commands) {
      expect(() => e.dispatch(command)).toThrow(/TERMINAL_STATE|终局/);
      expect(JSON.stringify(e.state)).toBe(before);
    }
  });
});

describe("quick6 异常防护（生产引擎）", () => {
  it("阶段步数上限触发 StepLimitError（测试失败），绝不伪造和局", () => {
    const e = engine([W, W, S, V, V, V], { maxPhaseSteps: 3 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 0 });
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(StepLimitError);
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(/never a draw/);
    expect(e.state.phase).toBe("NIGHT");
    expect(e.state.outcome).toBeNull();
    expect(e.state.steps).toBe(3);
    expect(e.state.eliminations).toEqual([]);
  });

  it("非法输入被拒绝时状态完全不变、不计步", () => {
    const e = engine([W, W, S, V, V, V]);
    const before = JSON.stringify(e.state);
    expect(() => e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 })).toThrow(IllegalActionError);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(e.state.steps).toBe(0);
    expect(() => e.dispatch({ type: "FINISH_NIGHT" })).toThrow(IllegalActionError);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(e.state.phase).toBe("NIGHT");
  });

  it("阶段错误的动作被拒绝（WRONG_PHASE）", () => {
    const e = afterNight1([W, W, S, V, V, V], 5, 1);
    try {
      e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 2 });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalActionError);
      expect((error as IllegalActionError).code).toBe("WRONG_PHASE");
    }
  });
});

describe("quick6 对外阶段名与种子保密（生产引擎）", () => {
  it("对外阶段名泛化：不泄露 NIGHT_SEER / pending 等内部子阶段", () => {
    const e = engine([W, W, S, V, V, V]);
    const snapshots: string[] = [];
    const snapshot = () => {
      snapshots.push(JSON.stringify(publicProjection(e.state)));
      for (const s of ALL_SEATS) {
        snapshots.push(JSON.stringify(viewFor(e.state, s)));
        snapshots.push(JSON.stringify(aiContextFor(e.state, s)));
      }
    };
    snapshot();
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 5 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 5 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 });
    e.dispatch({ type: "FINISH_NIGHT" });
    snapshot();
    finishDiscussion(e);
    snapshot();
    for (const [s, t] of [[0, 4], [1, 4], [2, 4], [3, 4], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" });
    snapshot();
    for (const json of snapshots) {
      for (const token of FORBIDDEN_TOKENS) {
        expect(json).not.toContain(token);
      }
    }
    for (const event of e.state.events) {
      if (event.payload.type === "PHASE") {
        expect(PHASES).toContain(event.payload.phase);
      }
    }
  });

  it("发牌种子不得进入任何投影或事件", () => {
    const seedHex = seedBytesToHex(SEED);
    const e = engine([W, W, S, V, V, V]);
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 5 });
    e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 5 });
    e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 });
    e.dispatch({ type: "FINISH_NIGHT" });
    finishDiscussion(e);
    for (const [s, t] of [[0, 4], [1, 4], [2, 4], [3, 4], [4, 0]] as const) {
      e.dispatch({ type: "SUBMIT_DAY_VOTE", seat: s, target: t });
    }
    e.dispatch({ type: "FINISH_VOTE" });
    const jsons = [
      JSON.stringify(publicProjection(e.state)),
      ...ALL_SEATS.map((s) => JSON.stringify(viewFor(e.state, s))),
      ...ALL_SEATS.map((s) => JSON.stringify(aiContextFor(e.state, s))),
      ...e.state.events.map((ev) => JSON.stringify(ev)),
    ];
    for (const json of jsons) {
      expect(json).not.toContain(seedHex);
      expect(json).not.toContain(seedHex.slice(0, 16));
      expect(json).not.toContain("seed");
    }
  });
});
