/**
 * 示例（examples）：两局带注释的手打对局，逐步验证生产引擎不变量 ——
 * revision 单调、角色不变、存活数不增、事件连续、终局不可行动、
 * 状态可序列化 —— 同时作为 lib/games/werewolf 的用法文档。
 *
 * 示例 1：好人胜 —— 首夜双狼分歧（并票 PRNG 定夺）、白天平票、逐轮
 * 放逐两只狼。
 * 示例 2：狼人胜 —— 双狼同刀 + 白天放逐好人，夜间达成狼数 ≥ 其他。
 */
import { describe, expect, it } from "vitest";

import { GameEngine } from "@/lib/games/core";
import {
  ALL_SEATS,
  Quick6Definition,
  createQuick6Engine,
  seedBytesFromInt,
  viewFor,
} from "@/lib/games/werewolf";
import type { Quick6Command, Quick6EventPayload, Quick6State, SeatView, PublicProjection } from "@/lib/games/werewolf";

type Quick6Engine = GameEngine<Quick6State, Quick6Command, SeatView, PublicProjection, Quick6EventPayload>;

const W = "WOLF";
const S = "SEER";
const V = "VILLAGER";

/** 逐步驱动并对每步断言核心不变量。 */
class Driven {
  constructor(readonly e: Quick6Engine, readonly roles: readonly string[]) {
    expect([...this.e.state.roles]).toEqual([...roles]);
  }

  private lastAlive = 6;

  step(command: Quick6Command, note: string): void {
    void note;
    const revisionBefore = this.e.state.revision;
    const eventsBefore = this.e.state.events.length;
    const aliveBefore = this.e.state.alive.filter(Boolean).length;
    this.e.dispatch(command);

    // 不变量 1：revision 单调（恰好 +1）
    expect(this.e.state.revision).toBe(revisionBefore + 1);
    // 不变量 2：角色不变
    expect([...this.e.state.roles]).toEqual([...this.roles]);
    // 不变量 3：存活数不增加
    const aliveAfter = this.e.state.alive.filter(Boolean).length;
    expect(aliveAfter).toBeLessThanOrEqual(aliveBefore);
    this.lastAlive = aliveAfter;
    // 不变量 4：事件连续（本次产生的事件紧跟其后，且携带当前 revision）
    const newEvents = this.e.state.events.slice(eventsBefore);
    newEvents.forEach((event, i) => {
      expect(event.index).toBe(eventsBefore + i);
      expect(event.revision).toBe(revisionBefore + 1);
    });
    // 不变量 5：状态可序列化（任意时刻往返一致）
    const restored = this.e.definition.deserializeState(this.e.serializeState());
    expect(this.e.definition.serializeState(restored)).toBe(this.e.serializeState());
  }

  wolves(): number[] {
    return ALL_SEATS.filter((s) => this.e.state.roles[s] === "WOLF");
  }

  seer(): number {
    return ALL_SEATS.find((s) => this.e.state.roles[s] === "SEER")!;
  }

  speakAllAndFinish(): void {
    for (;;) {
      const next = ALL_SEATS.find(
        (s) =>
          this.e.state.alive[s] &&
          !this.e.state.speeches.some((sp) => sp.round === this.e.state.round && sp.seat === s),
      );
      if (next === undefined) break;
      this.step({ type: "SUBMIT_SPEECH", seat: next, text: null }, `座位 ${next} 跳过发言`);
    }
    this.step({ type: "FINISH_DISCUSSION" }, "结束发言进入投票");
  }

  voteAll(votes: Record<number, number>): void {
    for (const s of ALL_SEATS) {
      if (!this.e.state.alive[s]) continue;
      this.step({ type: "SUBMIT_DAY_VOTE", seat: s, target: votes[s] }, `座位 ${s} 投票`);
    }
    this.step({ type: "FINISH_VOTE" }, "结算投票");
  }

  night(kills: Record<number, number>, seerTarget: number): void {
    for (const [seat, target] of Object.entries(kills)) {
      this.step(
        { type: "SUBMIT_WOLF_KILL", seat: Number(seat), target },
        `狼人 ${seat} 独立提交刀 ${target}`,
      );
    }
    if (this.e.state.alive[this.seer()]) {
      this.step({ type: "SUBMIT_SEER_CHECK", seat: this.seer(), target: seerTarget }, "预言家提交查验");
    }
    this.step({ type: "FINISH_NIGHT" }, "夜间结算");
  }
}

describe("示例 1：好人胜（双狼分歧 → 并票定夺；预言家同夜离场查验保留）", () => {
  it("按注释逐步推进并在每一步验证不变量", () => {
    // roles: 0=W, 1=W, 2=S, 3=V, 4=V, 5=V
    const g = new Driven(
      createQuick6Engine(seedBytesFromInt(42), { start: { roles: [W, W, S, V, V, V] } }),
      [W, W, S, V, V, V],
    );

    // 第 1 夜：双狼分歧 —— 狼 0 刀 3、狼 1 刀 4，由 quick6-prng-v1 的
    // night-wolf-tiebreak 域在并列目标 {3,4} 中定夺；预言家查验 1（狼）。
    g.night({ 0: 3, 1: 4 }, 1);
    const firstVictim = g.e.state.eliminations[0].seat;
    expect([3, 4]).toContain(firstVictim); // 受害者必来自并列目标集合
    expect(g.e.state.phase).toBe("DAY_DISCUSSION");
    expect([...g.e.state.seerChecks]).toEqual([{ round: 1, target: 1, isWolf: true }]);

    // 白天 1：按座位顺序发言；统一投票放逐狼 1（狼 1 也必须投票，
    // 投给其他存活玩家）→ 1 狼 + 3 好人，继续。
    g.speakAllAndFinish();
    for (const s of ALL_SEATS) {
      if (!g.e.state.alive[s]) continue;
      g.step({ type: "SUBMIT_DAY_VOTE", seat: s, target: s === 1 ? 0 : 1 }, `座位 ${s} 投票`);
    }
    g.step({ type: "FINISH_VOTE" }, "结算投票：放逐狼 1");
    expect(g.e.state.alive[1]).toBe(false);
    expect(g.e.state.outcome).toBeNull();

    // 第 2 夜：孤狼刀预言家 2；预言家同夜查验狼 0 —— 查验先结算并保留。
    g.night({ 0: 2 }, 0);
    expect(g.e.state.alive[2]).toBe(false);
    expect([...g.e.state.seerChecks].at(-1)).toEqual({ round: 2, target: 0, isWolf: true });
    // 1 狼 + 2 好人 → 继续
    expect(g.e.state.phase).toBe("DAY_DISCUSSION");

    // 白天 2：放逐最后一只狼（狼 0 也必须投票，投给任一存活好人）→ 好人胜。
    g.speakAllAndFinish();
    const wolfTarget = ALL_SEATS.find((s) => g.e.state.alive[s] && s !== 0)!;
    for (const s of ALL_SEATS) {
      if (!g.e.state.alive[s]) continue;
      g.step(
        { type: "SUBMIT_DAY_VOTE", seat: s, target: s === 0 ? wolfTarget : 0 },
        `座位 ${s} 投票`,
      );
    }
    g.step({ type: "FINISH_VOTE" }, "结算投票：放逐最后一只狼");
    expect(g.e.state.phase).toBe("END");
    expect(g.e.state.outcome).toEqual({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" });

    // 终局不可行动：一切命令被拒且状态不变。
    const before = g.e.serializeState();
    for (const command of [
      { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
      { type: "FINISH_NIGHT" },
      { type: "FINISH_VOTE" },
    ] as Quick6Command[]) {
      expect(() => g.e.dispatch(command)).toThrow();
      expect(g.e.serializeState()).toBe(before);
    }

    // 终局全揭示，且种子从未进入任何视图。
    const pub = viewFor(g.e.state, 0);
    expect(pub.rolesRevealed).toEqual([W, W, S, V, V, V]);
    expect(JSON.stringify(pub)).not.toContain("seed");
  });
});

describe("示例 2：狼人胜（双狼同刀 + 平票日无人离场 → 夜间达成多数）", () => {
  it("夜间淘汰后达成狼数 ≥ 其他，狼人胜", () => {
    const g = new Driven(
      createQuick6Engine(seedBytesFromInt(777), { start: { roles: [W, W, S, V, V, V] } }),
      [W, W, S, V, V, V],
    );

    // 第 1 夜：双狼同刀 5（平民），单狼目标直接生效；预言家查验 3。
    g.night({ 0: 5, 1: 5 }, 3);
    expect(g.e.state.alive[5]).toBe(false);

    // 白天 1：制造平票 —— 每人各投不同目标 → 并列最高票，无人离场
    // （不重投、不使用 RNG）。
    g.speakAllAndFinish();
    const alive = ALL_SEATS.filter((s) => g.e.state.alive[s]); // 0,1,2,3,4
    const half = Math.floor(alive.length / 2);
    for (let i = 0; i < alive.length; i++) {
      const s = alive[i];
      const t = alive[(i + half) % alive.length];
      g.step({ type: "SUBMIT_DAY_VOTE", seat: s, target: t }, `座位 ${s} 投 ${t}`);
    }
    g.step({ type: "FINISH_VOTE" }, "结算投票（平票无人离场）");
    expect(g.e.state.alive.filter(Boolean)).toHaveLength(alive.length);
    expect(g.e.state.outcome).toBeNull();

    // 第 2 夜：双狼同刀 4（平民）→ 2 狼 + 2 其他 → 狼人胜（夜间淘汰后
    // 立即结算）。
    g.night({ 0: 4, 1: 4 }, 1);
    expect(g.e.state.outcome).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(g.e.state.phase).toBe("END");

    // 终局吸收 + 可序列化。
    const restored = GameEngine.restore(
      g.e.definition,
      g.e.definition.deserializeState(g.e.serializeState()),
    );
    expect(restored.result()).toEqual({ winner: "WOLF", reason: "WOLVES_MAJORITY" });
    expect(() => restored.dispatch({ type: "FINISH_NIGHT" })).toThrow();
  });
});

describe("示例 3：非法动作全部拒绝且状态不变（§8 决策表抽查）", () => {
  it("非法阶段 / 死者行动 / 无权角色 / 自目标 / 弃票 / 重复动作 / 终局后动作", () => {
    const g = new Driven(createQuick6Engine(seedBytesFromInt(42), { start: { roles: [W, W, S, V, V, V] } }), [W, W, S, V, V, V]);
    const before = g.e.serializeState();

    // 非法阶段：白天动作在第 1 夜被拒
    expect(() => g.e.dispatch({ type: "SUBMIT_SPEECH", seat: 0, text: "x" })).toThrow(/WRONG_PHASE|阶段错误/);
    // 无权角色：预言家以外的座位提交查验被拒
    expect(() => g.e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: 0, target: 3 })).toThrow(/UNAUTHORIZED_ROLE/);
    // 自目标：狼人刀自己被拒
    expect(() => g.e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 0 })).toThrow(/SELF_TARGET/);
    // 狼刀狼被拒
    expect(() => g.e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 })).toThrow(/ILLEGAL_TARGET/);
    // 必交未交齐就结算被拒（弃票/漏交）
    expect(() => g.e.dispatch({ type: "FINISH_NIGHT" })).toThrow(/INCOMPLETE_SUBMISSIONS/);
    // 一切被拒后状态完全不变、不计步
    expect(g.e.serializeState()).toBe(before);
    expect(g.e.state.steps).toBe(0);

    // 重复动作：狼 0 提交后再次提交被拒
    g.step({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 3 }, "狼 0 提交");
    const afterFirst = g.e.serializeState();
    expect(() => g.e.dispatch({ type: "SUBMIT_WOLF_KILL", seat: 0, target: 4 })).toThrow(/DUPLICATE_ACTION/);
    expect(g.e.serializeState()).toBe(afterFirst);

    // 死者行动：走完第 1 夜后，死者无法行动
    g.step({ type: "SUBMIT_WOLF_KILL", seat: 1, target: 3 }, "狼 1 提交");
    g.step({ type: "SUBMIT_SEER_CHECK", seat: 2, target: 4 }, "预言家提交");
    g.step({ type: "FINISH_NIGHT" }, "夜间结算");
    const victim = g.e.state.eliminations[0].seat;
    expect(() => g.e.dispatch({ type: "SUBMIT_SPEECH", seat: victim, text: "x" })).toThrow(/DEAD_ACTOR/);
  });
});
