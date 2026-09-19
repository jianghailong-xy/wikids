/**
 * fast-check property tests over random legal play on the PRODUCTION quick6
 * engine: revision monotonicity, frozen roles, non-increasing alive count,
 * contiguous events, terminal absorption, state serializability,
 * determinism and the legal-choice/transition consistency contract.
 *
 * Every run uses an explicit fast-check seed: failures are reproducible.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GameEngine, IllegalActionError } from "@/lib/games/core";
import {
  ALL_PHASES,
  ALL_SEATS,
  ROLE_MULTISET,
  createQuick6Engine,
  seedBytesFromInt,
  viewFor,
} from "@/lib/games/werewolf";
import type { Quick6Command, Quick6State } from "@/lib/games/werewolf";
import type { Quick6Engine } from "./quick6-engine.test";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Structural invariants that must hold for every quick6 state. */
function assertStateInvariants(state: Quick6State): void {
  expect(ALL_PHASES).toContain(state.phase);
  expect(state.roles).toHaveLength(6);
  expect([...state.roles].sort()).toEqual([...ROLE_MULTISET].sort());
  expect(state.alive).toHaveLength(6);
  expect(state.revision).toBe(state.steps);
  state.events.forEach((event, i) => {
    expect(event.index).toBe(i);
    expect(event.revision).toBeLessThanOrEqual(state.revision);
  });
  if (state.phase === "END") {
    expect(state.outcome).not.toBeNull();
  } else {
    expect(state.outcome).toBeNull();
  }
  // 无重复死亡：每个座位至多离场一次
  const seen = new Set<number>();
  for (const record of state.eliminations) {
    expect(seen.has(record.seat)).toBe(false);
    seen.add(record.seat);
    expect(state.alive[record.seat]).toBe(false);
  }
  // 死者只能观战：不再下发任何私有信息
  for (const s of ALL_SEATS) {
    const view = viewFor(state, s);
    expect(view.ownRole).toBe(state.roles[s]);
    if (!state.alive[s]) {
      expect(view.wolfTeammates).toEqual([]);
      expect(view.seerChecks).toEqual([]);
    }
  }
}

/** Map a legal choice id to its command (speech ids carry test text). */
function commandFromChoiceId(id: string): Quick6Command | null {
  if (id === "finish-night") return { type: "FINISH_NIGHT" };
  if (id === "finish-discussion") return { type: "FINISH_DISCUSSION" };
  if (id === "finish-vote") return { type: "FINISH_VOTE" };
  const seatTarget = /^(wolf-kill|seer-check|day-vote)@(\d+):(\d+)$/.exec(id);
  if (seatTarget) {
    const kind = seatTarget[1];
    const seat = Number(seatTarget[2]);
    const target = Number(seatTarget[3]);
    if (kind === "wolf-kill") return { type: "SUBMIT_WOLF_KILL", seat, target };
    if (kind === "seer-check") return { type: "SUBMIT_SEER_CHECK", seat, target };
    return { type: "SUBMIT_DAY_VOTE", seat, target };
  }
  const skip = /^skip@(\d+)$/.exec(id);
  if (skip) return { type: "SUBMIT_SPEECH", seat: Number(skip[1]), text: null };
  const speech = /^speech@(\d+)$/.exec(id);
  if (speech) return { type: "SUBMIT_SPEECH", seat: Number(speech[1]), text: "属性测试发言" };
  return null;
}

/**
 * Play one full legal game. `actionSeed` drives choice selection
 * (test-side randomness); the engine itself only ever consumes its own
 * domain-separated streams.
 */
function playRandomLegalGame(seedInt: number, actionSeed: number): Quick6Engine {
  const e = createQuick6Engine(seedBytesFromInt(seedInt));
  const r = mulberry32(actionSeed);
  let rounds = 0;
  while (!e.isTerminal()) {
    assertStateInvariants(e.state);
    rounds += 1;
    expect(rounds).toBeLessThanOrEqual(200); // 异常防护：必须远早于上限终止
    const actors = [...e.actors()].sort((a, b) => a - b);
    for (const seat of actors) {
      if (e.isTerminal()) break;
      const choices = e.legalChoicesFor(seat).map((c) => c.id);
      const command = commandFromChoiceId(choices[Math.floor(r() * choices.length)]);
      if (command !== null) {
        e.dispatch(command);
        assertStateInvariants(e.state);
      }
    }
    if (e.actors().length === 0) {
      const finish = e.systemCommand();
      if (finish !== null) e.dispatch(finish);
    }
  }
  return e;
}

const ALIVE_COUNT = (s: Quick6State): number => s.alive.filter(Boolean).length;

describe("fast-check 属性（生产引擎）", () => {
  it("revision 严格单调 +1、角色不变、存活数不增、事件连续、必然真实终局", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (seedInt, actionSeed) => {
          const e = createQuick6Engine(seedBytesFromInt(seedInt));
          const rolesAtStart = JSON.stringify([...e.state.roles]);
          const r = mulberry32(actionSeed);
          let lastRevision = e.state.revision;
          let lastAlive = ALIVE_COUNT(e.state);
          let iterations = 0;
          const track = (): void => {
            // revision 严格单调 +1（每次接受）
            expect(e.state.revision).toBe(lastRevision + 1);
            lastRevision = e.state.revision;
            // 角色永不改变
            expect(JSON.stringify([...e.state.roles])).toBe(rolesAtStart);
            // 存活数不增加
            expect(ALIVE_COUNT(e.state)).toBeLessThanOrEqual(lastAlive);
            lastAlive = ALIVE_COUNT(e.state);
            // 事件连续
            e.state.events.forEach((event, i) => expect(event.index).toBe(i));
          };
          while (!e.isTerminal()) {
            iterations += 1;
            expect(iterations).toBeLessThanOrEqual(300); // 必然终止的保护
            for (const seat of [...e.actors()].sort((a, b) => a - b)) {
              if (e.isTerminal()) break;
              const choices = e.legalChoicesFor(seat).map((c) => c.id);
              const command = commandFromChoiceId(choices[Math.floor(r() * choices.length)]);
              if (command === null) continue;
              e.dispatch(command);
              track();
            }
            if (e.actors().length === 0) {
              const finish = e.systemCommand();
              if (finish !== null) {
                e.dispatch(finish);
                track();
              }
            }
          }
          expect(e.result()).not.toBeNull();
          expect(["TOWN", "WOLF"]).toContain(e.result()?.winner);
          expect(e.state.steps).toBeLessThanOrEqual(200); // 异常步数上限从未触发
        },
      ),
      { seed: 20250101, numRuns: 300 },
    );
  });

  it("终局吸收：任何终局状态对全部命令类型保持不变", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (seedInt, actionSeed) => {
          const e = playRandomLegalGame(seedInt, actionSeed);
          expect(e.isTerminal()).toBe(true);
          const before = JSON.stringify(e.state);
          const commands: Quick6Command[] = [
            { type: "SUBMIT_WOLF_KILL", seat: 0, target: 1 },
            { type: "SUBMIT_SEER_CHECK", seat: 2, target: 1 },
            { type: "SUBMIT_SPEECH", seat: 0, text: "x" },
            { type: "SUBMIT_DAY_VOTE", seat: 0, target: 1 },
            { type: "FINISH_NIGHT" },
            { type: "FINISH_DISCUSSION" },
            { type: "FINISH_VOTE" },
          ];
          for (const command of commands) {
            expect(() => e.dispatch(command)).toThrow(IllegalActionError);
            expect(JSON.stringify(e.state)).toBe(before);
          }
        },
      ),
      { seed: 20250101, numRuns: 100 },
    );
  });

  it("状态可序列化：往返一致且可被 restore 继续驱动", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (seedInt, actionSeed) => {
          const e = playRandomLegalGame(seedInt, actionSeed);
          const json = e.serializeState();
          expect(json).toBeTypeOf("string");
          const restored = e.definition.deserializeState(json);
          expect(e.definition.serializeState(restored)).toBe(json);
          assertStateInvariants(restored);
          const rehydrated = GameEngine.restore(e.definition, restored);
          expect(rehydrated.serializeState()).toBe(json);
          expect(rehydrated.result()).toEqual(e.state.outcome);
          // 终局吸收在恢复后的引擎上依旧成立
          expect(() => rehydrated.dispatch({ type: "FINISH_NIGHT" })).toThrow(IllegalActionError);
        },
      ),
      { seed: 20250101, numRuns: 100 },
    );
  });

  it("确定性：同 seed 同策略 → 完整状态字节级一致", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (seedInt, actionSeed) => {
          const first = playRandomLegalGame(seedInt, actionSeed);
          const second = playRandomLegalGame(seedInt, actionSeed);
          expect(second.serializeState()).toBe(first.serializeState());
        },
      ),
      { seed: 20250101, numRuns: 100 },
    );
  });

  it("legalChoices 与 transition 一致：每个合法 choice 在快照上都被接受", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (seedInt, actionSeed) => {
          const e = createQuick6Engine(seedBytesFromInt(seedInt));
          const r = mulberry32(actionSeed);
          // 随机推进几步，制造非平凡状态
          const warmup = Math.floor(r() * 6);
          for (let i = 0; i < warmup && !e.isTerminal(); i++) {
            for (const seat of [...e.actors()].sort((a, b) => a - b)) {
              if (e.isTerminal()) break;
              const choices = e.legalChoicesFor(seat).map((c) => c.id);
              const command = commandFromChoiceId(choices[Math.floor(r() * choices.length)]);
              if (command !== null) e.dispatch(command);
            }
            if (e.actors().length === 0 && e.systemCommand() !== null) {
              e.dispatch(e.systemCommand()!);
            }
          }
          if (e.isTerminal()) return; // 终局无合法 choice，契约已由吸收性覆盖
          const choices = e.legalChoices();
          expect(choices.length).toBeGreaterThan(0);
          for (const choice of choices) {
            // 每个 choice 都在同一状态的独立快照上验证
            const fresh = GameEngine.restore(e.definition, e.definition.deserializeState(e.serializeState()));
            const command = commandFromChoiceId(choice.id);
            expect(command, `choice ${choice.id} must map to a command`).not.toBeNull();
            expect(() => fresh.dispatch(command!)).not.toThrow(IllegalActionError);
          }
        },
      ),
      { seed: 20250101, numRuns: 100 },
    );
  });
});
