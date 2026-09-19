/**
 * ≥1000 个不同、可打印、可复现的固定 seed：脚本机器人整局模拟。
 *
 * 每一局：
 * - 全部 6 席（含真人席）由确定性脚本机器人驱动，机器人只从 legal
 *   choice id 集合中选取动作，随机性取自 (phaseToken, seat, purpose)
 *   域分离的独立流 —— 并发完成顺序不可能影响任何一席的决策；
 * - 必然以真实胜负（TOWN / WOLF，无和局）终止，steps 不超过异常步数
 *   上限（任何超过上限的局直接判测试失败，绝不伪造和局）；
 * - 无死循环（驱动守卫 + 步数上限）、无重复死亡（每座位至多离场一次）、
 *   无非法状态（每步结构不变量校验）；
 * - 同 seed 重放字节级一致。
 *
 * 输出：每局一行 seed + 终局，以及最终终局分布汇总。
 */
import { describe, expect, it } from "vitest";

import {
  ALL_SEATS,
  DEFAULT_MAX_PHASE_STEPS,
  ROLE_MULTISET,
  createQuick6Engine,
  createQuick6Rng,
  runQuick6BotGame,
  seedBytesFromInt,
  seedLabel,
  viewFor,
} from "@/lib/games/werewolf";
import type { Quick6Engine } from "@/lib/games/werewolf";

const SEED_COUNT = 1000;

/** Structural invariants that must hold after every dispatch. */
function assertNoIllegalState(e: Quick6Engine): void {
  const state = e.state;
  // 无重复死亡
  const seen = new Set<number>();
  for (const record of state.eliminations) {
    expect(seen.has(record.seat)).toBe(false);
    seen.add(record.seat);
    expect(state.alive[record.seat]).toBe(false);
  }
  // 角色冻结
  expect([...state.roles].sort()).toEqual([...ROLE_MULTISET].sort());
  // 事件连续
  state.events.forEach((event, i) => expect(event.index).toBe(i));
  // 存活数 ≥ 1 且单调不增由记录保证；revision/steps 同步
  expect(state.revision).toBe(state.steps);
  // 夜间缓冲从不进入任何座位视图
  for (const s of ALL_SEATS) {
    const view = viewFor(state, s);
    expect(JSON.stringify(view)).not.toContain("nightWolfKills");
    expect(JSON.stringify(view)).not.toContain("nightSeerTarget");
    expect(JSON.stringify(view)).not.toContain("seedBytes");
  }
  // 终局一致性
  if (state.phase === "END") {
    expect(state.outcome).not.toBeNull();
  }
}

interface Distribution {
  wolfWins: number;
  townWins: number;
  byReason: Record<string, number>;
  minSteps: number;
  maxSteps: number;
}

describe("脚本机器人 1000 局模拟（生产引擎）", () => {
  it("至少 1000 个不同可打印 seed 全部正常终止，无死循环/重复死亡/伪造和局/非法状态，并输出终局分布", () => {
    const distribution: Distribution = {
      wolfWins: 0,
      townWins: 0,
      byReason: {},
      minSteps: Number.POSITIVE_INFINITY,
      maxSteps: 0,
    };
    const lines: string[] = [];
    const traces: string[] = [];

    for (let i = 1; i <= SEED_COUNT; i++) {
      const seedBytes = seedBytesFromInt(i);
      const label = seedLabel(seedBytes, i);
      const e = createQuick6Engine(seedBytes);

      const report = runQuick6BotGame(e, {
        seedLabel: label,
        maxDispatches: 10_000, // 死循环守卫：任何超步数局判失败
      });

      // 终局分布与步数统计
      if (report.winner === "WOLF") distribution.wolfWins += 1;
      else distribution.townWins += 1;
      distribution.byReason[report.reason] = (distribution.byReason[report.reason] ?? 0) + 1;
      distribution.minSteps = Math.min(distribution.minSteps, report.steps);
      distribution.maxSteps = Math.max(distribution.maxSteps, report.steps);

      // 无死循环 / 无异常步数：任何超过上限的局直接判测试失败（绝不伪造和局）
      expect(report.steps).toBeLessThanOrEqual(DEFAULT_MAX_PHASE_STEPS);
      expect(report.outcome.winner === "WOLF" || report.outcome.winner === "TOWN").toBe(true);

      assertNoIllegalState(e);
      lines.push(`${label} → ${report.winner}_WIN (${report.reason}) steps=${report.steps}`);
      traces.push(e.serializeState());
    }

    // 可复现：同 seed 重放字节级一致
    const replay = createQuick6Engine(seedBytesFromInt(123));
    runQuick6BotGame(replay, { seedLabel: seedLabel(seedBytesFromInt(123), 123) });
    expect(replay.serializeState()).toBe(traces[122]);

    // 输出：全部 seed 与终局（验证工件）
    for (const line of lines) console.log(line);
    console.log(
      `\n终局分布（${SEED_COUNT} 局）：` +
        `WOLF_WIN=${distribution.wolfWins} ` +
        `TOWN_WIN=${distribution.townWins} ` +
        `reasons=${JSON.stringify(distribution.byReason)} ` +
        `steps∈[${distribution.minSteps}, ${distribution.maxSteps}]`,
    );

    // 双方胜负都必须出现（随机合法玩法在 1000 局上覆盖两种结局）
    expect(distribution.wolfWins).toBeGreaterThan(0);
    expect(distribution.townWins).toBeGreaterThan(0);
    expect(distribution.wolfWins + distribution.townWins).toBe(SEED_COUNT);
    expect(distribution.maxSteps).toBeLessThanOrEqual(DEFAULT_MAX_PHASE_STEPS);
  });

  it("机器人动作完全来自合法 choice 集：1000 局零非法拒绝", () => {
    // runQuick6BotGame 内任一非法拒绝都会抛出并使整局失败；此处以
    // 显式计数再次确认 1000 局中引擎从不拒绝机器人动作。
    let totalDispatches = 0;
    for (let i = 1; i <= SEED_COUNT; i++) {
      const e = createQuick6Engine(seedBytesFromInt(i));
      runQuick6BotGame(e, { seedLabel: seedLabel(seedBytesFromInt(i), i) });
      totalDispatches += e.state.revision;
      expect(e.isTerminal()).toBe(true);
    }
    expect(totalDispatches).toBeGreaterThan(SEED_COUNT * 20); // 每局≥21 次成功迁移
  });

  it("并发完成顺序不影响结果：不同提交顺序产生同一终局状态", async () => {
    const bytes = seedBytesFromInt(777);
    // 双狼座位由发牌决定；两次模拟按相反顺序“并发完成”提交（调度
    // 顺序不同）。每席目标取自其自身的 (phaseToken, seat, purpose)
    // 域分离流，因此调度顺序不可能改变任何一席的抽取与最终结算。
    const probe = createQuick6Engine(bytes);
    const wolves = ALL_SEATS.filter((s) => probe.state.roles[s] === "WOLF");
    const results: string[] = [];
    for (const order of [wolves, [...wolves].reverse()] as const) {
      const e = createQuick6Engine(bytes);
      const tasks = order.map(async (w) => {
        await new Promise((resolve) => setTimeout(resolve, order.indexOf(w) * 2));
        const rng = createQuick6Rng(e.state.seedBytes).stream(
          "bot",
          "phase:night:1",
          `seat:${w}`,
          "purpose:night",
        );
        const choices = e.legalChoicesFor(w)
          .map((c) => c.id)
          .filter((id) => id.startsWith("wolf-kill@"));
        const id = choices[Math.floor(rng.next() * choices.length)];
        const seatTarget = /^wolf-kill@\d+:(\d+)$/.exec(id);
        if (seatTarget) {
          e.dispatch({
            type: "SUBMIT_WOLF_KILL",
            seat: w,
            target: Number(seatTarget[1]),
          });
        }
      });
      await Promise.all(tasks);
      const seer = ALL_SEATS.find((s) => e.state.roles[s] === "SEER");
      if (seer !== undefined) {
        e.dispatch({ type: "SUBMIT_SEER_CHECK", seat: seer, target: (seer + 1) % 6 });
      }
      e.dispatch({ type: "FINISH_NIGHT" });
      results.push(JSON.stringify([...e.state.eliminations]));
    }
    expect(results[0]).toBe(results[1]);
  });
});
