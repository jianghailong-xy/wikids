/**
 * Executable assertions for every decision table in docs/quick6-v1-rules.md:
 * configuration, night rules (legal targets, simultaneous submission, PRNG
 * tiebreak, seer-dies-same-night), day rules (seat order, skip, AI sees only
 * earlier speeches, mandatory votes, ties), win timing, elimination/reveal
 * visibility, abnormal step protection and external phase generalization.
 */
import { describe, expect, it } from "vitest";

import { seedBytesFromInt, seedBytesToHex } from "@/tests/support/prng";
import { SpecAbortError, SpecGame, SpecInputError, type SpecGameConfig } from "./model";
import { aiContextFor, publicProjection, viewFor } from "./projection";
import { randomLegalPlay } from "./random-play";
import { ALL_SEATS, SEAT_COUNT, type ExternalPhase, type Role } from "./types";

const SEED = seedBytesFromInt(0x51a6c0de);
const W = "WOLF";
const S = "SEER";
const V = "VILLAGER";

function game(roles: readonly Role[], opts: Partial<SpecGameConfig> = {}): SpecGame {
  return new SpecGame({ seedBytes: SEED, roles, ...opts });
}

/** Fresh game, night 1 resolved with both wolves killing `victim`. */
function afterNight1(roles: readonly Role[], victim: number, seerTarget: number): SpecGame {
  const g = game(roles);
  const wolves = ALL_SEATS.filter((s) => roles[s] === "WOLF");
  for (const w of wolves) g.submitWolfKill(w, victim);
  const seer = ALL_SEATS.find((s) => roles[s] === "SEER");
  if (seer !== undefined) g.submitSeerCheck(seer, seerTarget);
  g.finishNight();
  return g;
}

/** Everyone alive speaks/skips in seat order, then discussion ends. */
function finishDiscussion(g: SpecGame, texts: Record<number, string | null> = {}): void {
  let next = g.nextSpeaker();
  while (next !== null) {
    g.submitSpeech(next, texts[next] ?? null);
    next = g.nextSpeaker();
  }
  g.finishDiscussion();
}

const PHASES: readonly ExternalPhase[] = ["NIGHT", "DAY_DISCUSSION", "DAY_VOTE", "END"];
const FORBIDDEN_TOKENS = ["NIGHT_SEER", "NIGHT_WOLF", "PENDING", "pending"];

describe("quick6-v1 配置与开局", () => {
  it("冻结 6 席：1 真人 + 5 AI，2 狼 / 1 预言家 / 3 平民，从 NIGHT 开始", () => {
    const g = new SpecGame({ seedBytes: SEED });
    expect(ALL_SEATS).toHaveLength(SEAT_COUNT);
    expect(g.humanSeat).toBe(0);
    expect(ALL_SEATS.filter((s) => s !== g.humanSeat)).toHaveLength(5);
    expect(g.roles.filter((r) => r === "WOLF")).toHaveLength(2);
    expect(g.roles.filter((r) => r === "SEER")).toHaveLength(1);
    expect(g.roles.filter((r) => r === "VILLAGER")).toHaveLength(3);
    expect(g.phase).toBe("NIGHT");
    expect(g.round).toBe(1);
    expect(g.alive.every(Boolean)).toBe(true);
    expect(g.outcome).toBeNull();
    expect(publicProjection(g).rolesRevealed).toBeNull();
  });

  it("拒绝非法的固定角色表与非真人座位", () => {
    expect(() => new SpecGame({ seedBytes: SEED, roles: [W, W, W, S, V, V] })).toThrow(
      SpecInputError,
    );
    expect(() => new SpecGame({ seedBytes: SEED, roles: [W, W, S, V, V] })).toThrow(SpecInputError);
    expect(() => new SpecGame({ seedBytes: SEED, humanSeat: 6 })).toThrow(SpecInputError);
  });
});

describe("quick6-v1 夜间规则", () => {
  it("首夜即可淘汰：多狼同票直接生效，公开座位 ID 但不公开身份", () => {
    const g = afterNight1([W, W, S, V, V, V], 3, 1);
    expect(g.eliminations).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 3 }]);
    expect(g.alive[3]).toBe(false);
    expect(g.phase).toBe("DAY_DISCUSSION");
    const pub = publicProjection(g);
    expect(pub.rolesRevealed).toBeNull();
    expect(JSON.stringify(pub.eliminations)).not.toContain("WOLF");
    expect(JSON.stringify(pub.eliminations)).not.toContain("SEER");
    expect(JSON.stringify(pub.eliminations)).not.toContain("VILLAGER");
  });

  it("单狼直接生效", () => {
    // night 1 kills 5; day 1 exiles wolf seat 1; night 2 the lone wolf kills directly
    const g = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // seat 1 (wolf) exiled; wolves {0}, others {2,3,4}
    expect(g.phase).toBe("NIGHT");
    expect(g.round).toBe(2);
    expect(g.alive[1]).toBe(false);
    g.submitWolfKill(0, 2);
    g.submitSeerCheck(2, 3);
    g.finishNight();
    expect(g.eliminations.at(-1)).toEqual({ round: 2, kind: "NIGHT_KILL", seat: 2 });
  });

  it("多狼不同票：由版本化 PRNG 在并列目标中定夺，结果可重放且与提交顺序无关", () => {
    const victimOf = (submitOrder: "01" | "10") => {
      const g = game([W, W, S, V, V, V]);
      if (submitOrder === "01") {
        g.submitWolfKill(0, 2);
        g.submitWolfKill(1, 3);
      } else {
        g.submitWolfKill(1, 3);
        g.submitWolfKill(0, 2);
      }
      g.submitSeerCheck(2, 4);
      g.finishNight();
      return g.eliminations[0].seat;
    };
    const first = victimOf("01");
    expect([2, 3]).toContain(first); // 受害者必来自并列目标集合
    expect(victimOf("01")).toBe(first); // 相同 seed 与目标集合 → 完全可重放
    expect(victimOf("10")).toBe(first); // 同时提交：顺序无关
  });

  it("狼刀目标必须是存活非狼：禁自刀、禁刀狼、禁刀死者", () => {
    const g = afterNight1([W, W, S, V, V, V], 3, 1); // seat 3 dead; wolves 0,1 alive
    finishDiscussion(g);
    // tie day: nobody exiled, so wolves stay 2 and night 2 happens
    for (const [s, t] of [
      [0, 2],
      [1, 4],
      [2, 4],
      [4, 0],
      [5, 2],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 2:2 / 4:2 / 0:1 → 并列最高票，无人离场
    expect(g.alive[0] && g.alive[1]).toBe(true);
    expect(() => g.submitWolfKill(0, 0)).toThrow(/目标不能是自己/);
    expect(() => g.submitWolfKill(0, 1)).toThrow(/存活非狼/);
    expect(() => g.submitWolfKill(0, 3)).toThrow(/目标已死亡/);
    expect(() => g.submitWolfKill(2, 5)).toThrow(/只有狼人/);
  });

  it("查验：目标必须存活且非自己；允许跨夜重复查验；每夜至多一次", () => {
    const g = game([W, W, S, V, V, V]);
    expect(() => g.submitSeerCheck(2, 2)).toThrow(/不能是自己/);
    expect(() => g.submitSeerCheck(0, 3)).toThrow(/只有预言家/);
    g.submitSeerCheck(2, 3);
    expect(() => g.submitSeerCheck(2, 4)).toThrow(/已提交查验/);
    g.submitWolfKill(0, 5);
    g.submitWolfKill(1, 5);
    g.finishNight();
    expect(g.seerChecks).toEqual([{ round: 1, target: 3, isWolf: false }]);

    // day 1: exile wolf 1 so the game continues with the seer alive
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote();
    // night 2: repeat the same check target
    g.submitWolfKill(0, 4);
    g.submitSeerCheck(2, 3);
    g.finishNight();
    expect(g.seerChecks).toEqual([
      { round: 1, target: 3, isWolf: false },
      { round: 2, target: 3, isWolf: false },
    ]);
  });

  it("预言家同夜离场：查验仍生效并保留", () => {
    const g = game([W, W, S, V, V, V]);
    g.submitSeerCheck(2, 1); // checks wolf seat 1
    g.submitWolfKill(0, 2); // both wolves kill the seer
    g.submitWolfKill(1, 2);
    g.finishNight();
    expect(g.alive[2]).toBe(false);
    expect(g.seerChecks).toEqual([{ round: 1, target: 1, isWolf: true }]);
    expect(g.eliminations).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 2 }]);
  });

  it("夜间必交动作未交齐时拒绝结算", () => {
    const g = game([W, W, S, V, V, V]);
    expect(() => g.finishNight()).toThrow(/未提交夜间目标/);
    g.submitWolfKill(0, 3);
    expect(() => g.finishNight()).toThrow(/未提交夜间目标/);
    g.submitWolfKill(1, 3);
    expect(() => g.finishNight()).toThrow(/预言家未提交查验/);
    g.submitSeerCheck(2, 0);
    expect(() => g.finishNight()).not.toThrow();
  });

  it("夜间动作在结算前互相不可见：狼人互相看不到对方的提交", () => {
    const g = game([W, W, S, V, V, V]);
    g.submitWolfKill(0, 3);
    g.submitWolfKill(1, 4);
    const view0 = viewFor(g, 0);
    const view1 = viewFor(g, 1);
    // 夜间缓冲从不进入任何座位视图
    expect(JSON.stringify(view0)).not.toContain("nightWolfKills");
    expect(JSON.stringify(view1)).not.toContain("nightWolfKills");
    expect(JSON.stringify(view0)).not.toContain("nightSeerTarget");
  });
});

describe("quick6-v1 白天规则", () => {
  it("发言必须按座位顺序、允许显式跳过、重复发言被拒", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1); // alive 0,1,2,3,4
    expect(() => g.submitSpeech(3, "插队")).toThrow(/座位顺序/);
    g.submitSpeech(0, null); // 显式跳过
    expect(() => g.submitSpeech(2, "插队")).toThrow(/座位顺序/);
    g.submitSpeech(1, "白天好");
    expect(() => g.submitSpeech(0, "重复")).toThrow(/座位顺序/);
    g.submitSpeech(2, null);
    g.submitSpeech(3, "大家好");
    g.submitSpeech(4, null);
    expect(g.nextSpeaker()).toBeNull();
    g.finishDiscussion();
    expect(g.phase).toBe("DAY_VOTE");
    expect(g.speeches).toEqual([
      { round: 1, seat: 0, text: null },
      { round: 1, seat: 1, text: "白天好" },
      { round: 1, seat: 2, text: null },
      { round: 1, seat: 3, text: "大家好" },
      { round: 1, seat: 4, text: null },
    ]);
  });

  it("后发 AI 只看已公开的前序发言", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1); // alive 0,1,2,3,4
    g.submitSpeech(0, "一号发言");
    g.submitSpeech(1, null);
    // seat 2 发言时刻，只看到 0、1 的发言
    expect(aiContextFor(g, 2).speeches.map((s) => s.seat)).toEqual([0, 1]);
    expect(aiContextFor(g, 4).speeches.map((s) => s.seat)).toEqual([0, 1]);
    g.submitSpeech(2, "二号发言");
    g.submitSpeech(3, null);
    expect(aiContextFor(g, 4).speeches.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    // AI 语境只含该座位自己的私有信息
    expect(aiContextFor(g, 2).wolfTeammates).toEqual([]);
    expect(aiContextFor(g, 0).wolfTeammates).toEqual([1]);
    expect(aiContextFor(g, 2).seerChecks).toEqual([{ round: 1, target: 1, isWolf: true }]);
    expect(aiContextFor(g, 0).seerChecks).toEqual([]);
  });

  it("投票：每名存活玩家必须投给另一名存活玩家；最高票淘汰", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1); // alive 0,1,2,3,4
    finishDiscussion(g);
    expect(() => g.finishVote()).toThrow(/不得弃票/);
    expect(() => g.submitDayVote(0, 0)).toThrow(/不得自投/);
    expect(() => g.submitDayVote(0, 5)).toThrow(/目标已死亡/);
    for (const [s, t] of [
      [0, 1],
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    expect(() => g.submitDayVote(0, 2)).toThrow(/已投票/);
    g.finishVote(); // 1:3 最高票 → 放逐座位 1
    expect(g.eliminations.at(-1)).toEqual({ round: 1, kind: "DAY_EXILE", seat: 1 });
    expect(g.alive[1]).toBe(false);
    expect(g.round).toBe(2);
    expect(g.phase).toBe("NIGHT");
  });

  it("平票：无人离场，不重投", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1); // alive 0,1,2,3,4
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 0],
      [4, 2],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 2:2 / 3:2 / 0:1 → 并列最高票
    expect(g.eliminations).toEqual([{ round: 1, kind: "NIGHT_KILL", seat: 5 }]);
    expect(g.alive.filter(Boolean)).toHaveLength(5);
    expect(g.phase).toBe("NIGHT");
    expect(g.round).toBe(2);
  });
});

describe("quick6-v1 胜负判定", () => {
  it("狼为 0 → 好人胜（白天放逐最后一只狼后立即结算）", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 放逐狼 1 → 1W + 3 others，继续
    g.submitWolfKill(0, 2);
    g.submitSeerCheck(2, 4);
    g.finishNight(); // 夜间击杀 2 → 1W + 2 others，继续
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 4],
      [3, 0],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 放逐最后一只狼 0
    expect(g.outcome).toEqual({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" });
    expect(g.phase).toBe("END");
    expect(g.events.at(-2)).toEqual({
      type: "GAME_OVER",
      winner: "TOWN",
      reason: "WOLVES_EXTERMINATED",
    });
  });

  it("存活狼数 ≥ 其他存活人数 → 狼人胜（夜间淘汰后结算）", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1); // 2W + 3 others，继续
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 0],
      [4, 2],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 平票，无人离场
    g.submitWolfKill(0, 4);
    g.submitWolfKill(1, 4);
    g.submitSeerCheck(2, 1);
    g.finishNight(); // 2W + 2 others → 狼人胜（夜间淘汰后立即结算）
    expect(g.outcome).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(g.phase).toBe("END");
  });

  it("存活狼数 ≥ 其他存活人数 → 狼人胜（白天淘汰后结算）", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 放逐 4 → 2W + 2 others → 狼人胜
    expect(g.outcome).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(g.phase).toBe("END");
  });

  it("平票无人离场时胜负检查不误报，游戏继续", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 0],
      [4, 2],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote();
    expect(g.outcome).toBeNull();
    expect(g.phase).toBe("NIGHT");
  });
});

describe("quick6-v1 离场、揭示与观战", () => {
  it("离场不揭示身份，END 后全揭示", () => {
    const g = afterNight1([W, W, S, V, V, V], 3, 1); // seat 3 (villager) dead
    const pub = publicProjection(g);
    expect(pub.rolesRevealed).toBeNull();
    expect(pub.eliminations.map((e) => e.seat)).toEqual([3]);
    // 白天放逐最后… 直接走完一局到 END
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [4, 1],
      [5, 1],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 放逐狼 1 → 1W(0) + 3 others(2,4,5)… wait 3 is dead: others alive = 2,4,5 → 3
    expect(g.outcome).toBeNull();
    g.submitWolfKill(0, 2);
    g.submitSeerCheck(2, 0);
    g.finishNight(); // 1W + 2 others → 继续
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 4],
      [4, 0],
      [5, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // 放逐最后一只狼 → TOWN_WIN
    const end = publicProjection(g);
    expect(end.phase).toBe("END");
    expect(end.rolesRevealed).toEqual([W, W, S, V, V, V]);
    expect(end.outcome).toEqual({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" });
  });

  it("死者只能看公开信息并观战", () => {
    const g = afterNight1([W, W, S, V, V, V], 2, 1); // seer seat 2 killed night 1
    const deadSeer = viewFor(g, 2);
    const pub = publicProjection(g);
    expect(deadSeer.ownRole).toBe(S); // 自身身份是既有私知
    expect(deadSeer.seerChecks).toEqual([]); // 死亡后系统不再下发查验历史
    expect(deadSeer.wolfTeammates).toEqual([]);
    expect(deadSeer).toMatchObject(pub);
    // 狼人队友仅存活狼人可见
    expect(viewFor(g, 0).wolfTeammates).toEqual([1]);
    expect(viewFor(g, 1).wolfTeammates).toEqual([0]);
    expect(viewFor(g, 3).wolfTeammates).toEqual([]);
  });

  it("END 后拒绝一切游戏动作", () => {
    const g = afterNight1([W, W, S, V, V, V], 5, 1);
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote(); // WOLF_WIN, END
    expect(g.phase).toBe("END");
    expect(() => g.submitWolfKill(0, 2)).toThrow(SpecInputError);
    expect(() => g.submitSeerCheck(2, 0)).toThrow(SpecInputError);
    expect(() => g.submitSpeech(0, "x")).toThrow(SpecInputError);
    expect(() => g.submitDayVote(0, 2)).toThrow(SpecInputError);
    expect(() => g.finishNight()).toThrow(SpecInputError);
    expect(() => g.finishVote()).toThrow(SpecInputError);
  });
});

describe("quick6-v1 异常防护", () => {
  it("阶段步数上限触发 SpecAbortError（测试失败），绝不伪造和局", () => {
    const g = game([W, W, S, V, V, V], { maxPhaseSteps: 3 });
    g.submitWolfKill(0, 2); // steps 1
    g.submitWolfKill(1, 3); // steps 2
    g.submitSeerCheck(2, 0); // steps 3
    expect(() => g.finishNight()).toThrow(SpecAbortError);
    expect(() => g.finishNight()).toThrow(/never a draw/);
    // 中止时状态未被部分应用，且没有产生任何“平局”结局
    expect(g.phase).toBe("NIGHT");
    expect(g.outcome).toBeNull();
    expect(g.steps).toBe(3);
    expect(g.eliminations).toEqual([]);
  });

  it("非法输入被拒绝时状态完全不变、不计步", () => {
    const g = game([W, W, S, V, V, V]);
    const before = g.steps;
    expect(() => g.submitWolfKill(0, 1)).toThrow(SpecInputError);
    expect(g.steps).toBe(before);
    expect(() => g.finishNight()).toThrow(SpecInputError);
    expect(g.steps).toBe(before);
    expect(g.phase).toBe("NIGHT");
  });
});

describe("quick6-v1 对外阶段名与种子保密", () => {
  it("对外阶段名泛化：不泄露 NIGHT_SEER / pending AI 等内部子阶段", () => {
    const g = game([W, W, S, V, V, V]);
    const snapshots: string[] = [];
    const snapshot = () => {
      snapshots.push(JSON.stringify(publicProjection(g)));
      snapshots.push(JSON.stringify(viewFor(g, 0)));
      snapshots.push(JSON.stringify(aiContextFor(g, 4)));
    };
    snapshot(); // NIGHT
    g.submitWolfKill(0, 5);
    g.submitWolfKill(1, 5);
    g.submitSeerCheck(2, 1);
    g.finishNight();
    snapshot(); // DAY_DISCUSSION
    finishDiscussion(g);
    snapshot(); // DAY_VOTE
    for (const [s, t] of [
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote();
    snapshot(); // END
    for (const json of snapshots) {
      for (const token of FORBIDDEN_TOKENS) {
        expect(json).not.toContain(token);
      }
    }
    for (const event of g.events) {
      if ("phase" in event && event.type === "PHASE") {
        expect(PHASES).toContain(event.phase);
      }
    }
  });

  it("发牌种子不得进入任何投影", () => {
    const seedHex = seedBytesToHex(SEED);
    const g = game([W, W, S, V, V, V]);
    g.submitWolfKill(0, 5);
    g.submitWolfKill(1, 5);
    g.submitSeerCheck(2, 1);
    g.finishNight();
    finishDiscussion(g);
    for (const [s, t] of [
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 0],
    ] as const) {
      g.submitDayVote(s, t);
    }
    g.finishVote();
    const jsons = [
      JSON.stringify(publicProjection(g)),
      ...ALL_SEATS.map((s) => JSON.stringify(viewFor(g, s))),
      ...ALL_SEATS.map((s) => JSON.stringify(aiContextFor(g, s))),
    ];
    for (const json of jsons) {
      expect(json).not.toContain(seedHex);
      expect(json).not.toContain(seedHex.slice(0, 16));
      expect(json).not.toContain("seed");
    }
  });

  it("合法随机玩法必然以真实胜负告终（默认步数上限永不触发）", () => {
    const g = randomLegalPlay(SEED, 7);
    expect(g.phase).toBe("END");
    expect(g.outcome).not.toBeNull();
    expect(g.steps).toBeLessThanOrEqual(200);
  });
});
