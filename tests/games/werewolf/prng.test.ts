/**
 * Production quick6-prng-v1 (lib/games/werewolf/prng.ts) vs the frozen
 * executable reference (tests/support/prng.ts): byte-compatible primitives,
 * the frozen deal fixture, and the path-derivation guarantees that make
 * randomness immune to concurrent completion order.
 */
import { describe, expect, it } from "vitest";

import {
  createQuick6Rng,
  QUICK6_GAME_VERSIONS,
  seedBytesFromInt,
} from "@/lib/games/werewolf";
import {
  createVersionedRng,
  PRNG_DOMAINS,
} from "@/tests/support/prng";
import {
  FROZEN_DEAL_DRAWS,
  FROZEN_DEAL_ROLES,
  QUICK6_TEST_SEED,
  QUICK6_TEST_SEED_BYTES,
} from "@/tests/fixtures/determinism";
import { createQuick6Engine } from "@/lib/games/werewolf";

const draws = (rng: { next(): number }, n: number): number[] =>
  Array.from({ length: n }, () => rng.next());

describe("quick6-prng-v1 生产实现与冻结参考字节级一致", () => {
  it("冻结算法版本常量", () => {
    expect(QUICK6_GAME_VERSIONS.prng).toBe("quick6-prng-v1");
    expect(QUICK6_GAME_VERSIONS.rules).toBe("quick6-v1");
  });

  it("单路径流与参考 createVersionedRng 完全一致（deal 域）", () => {
    const prod = createQuick6Rng(QUICK6_TEST_SEED_BYTES).stream("deal");
    const ref = createVersionedRng({
      seedBytes: QUICK6_TEST_SEED_BYTES,
      domain: PRNG_DOMAINS.DEAL,
    });
    expect(draws(prod, 8)).toEqual(draws(ref, 8));
  });

  it("冻结发牌夹具在生产引擎上逐字节复现", () => {
    const engine = createQuick6Engine(QUICK6_TEST_SEED_BYTES);
    expect([...engine.state.roles]).toEqual([...FROZEN_DEAL_ROLES]);
  });

  it("deal 域前 4 个抽取值与冻结夹具一致", () => {
    const rng = createQuick6Rng(QUICK6_TEST_SEED_BYTES).stream("deal");
    expect(draws(rng, 4)).toEqual([...FROZEN_DEAL_DRAWS]);
  });

  it("同种子同路径 → 相同流；种子/路径/版本任一不同 → 不同流", () => {
    const a = createQuick6Rng(seedBytesFromInt(1));
    const b = createQuick6Rng(seedBytesFromInt(1));
    const c = createQuick6Rng(seedBytesFromInt(2));
    expect(draws(a.stream("x"), 8)).toEqual(draws(b.stream("x"), 8));
    expect(draws(a.stream("x"), 8)).not.toEqual(draws(c.stream("x"), 8));
    expect(draws(a.stream("x"), 8)).not.toEqual(draws(a.stream("y"), 8));
  });

  it("种子必须 ≥16 字节", () => {
    expect(() => createQuick6Rng(new Uint8Array(8))).toThrow(/at least 16 bytes/);
    expect(() => createQuick6Rng(new Uint8Array(32).fill(7))).not.toThrow();
  });
});

describe("路径派生：并发完成顺序无关", () => {
  it("流之间完全独立：先创建/先消费任一流的次数不影响其他流", () => {
    const factory = createQuick6Rng(QUICK6_TEST_SEED_BYTES);
    const seatA = factory.stream("bot", "phase:night:1", "seat:0", "purpose:night");
    const seatB = factory.stream("bot", "phase:night:1", "seat:1", "purpose:night");
    const aBaseline = draws(seatA, 4);
    const bBaseline = draws(seatB, 4);
    // 用另一工厂重放，且改变创建顺序与消费次数
    const factory2 = createQuick6Rng(QUICK6_TEST_SEED_BYTES);
    const b2 = factory2.stream("bot", "phase:night:1", "seat:1", "purpose:night");
    draws(b2, 7); // b 先创建并多消费
    const a2 = factory2.stream("bot", "phase:night:1", "seat:0", "purpose:night");
    // a 的流完全不受 b 的创建/消费影响
    expect(draws(a2, 4)).toEqual(aBaseline);
    // b 的完整序列与独立重放一致（基线 + 原流后续 = 位置 0..10）
    const bReplay = factory.stream("bot", "phase:night:1", "seat:1", "purpose:night");
    expect(draws(bReplay, 11)).toEqual([...bBaseline, ...draws(seatB, 7)]);
  });

  it("任意交错创建/消费不同座位流，各自序列恒定", () => {
    const mk = () => createQuick6Rng(QUICK6_TEST_SEED_BYTES);
    const f1 = mk();
    const expected: Record<string, number[]> = {};
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      expected[`s${seat}`] = draws(
        f1.stream("bot", "phase:discussion:1", `seat:${seat}`, "purpose:speech"),
        5,
      );
    }
    // 反向顺序创建并交错消费
    const f2 = mk();
    const got: Record<string, number[]> = {};
    const streams: Record<string, ReturnType<ReturnType<typeof mk>["stream"]>> = {};
    for (const seat of [5, 4, 3, 2, 1, 0]) {
      streams[`s${seat}`] = f2.stream("bot", "phase:discussion:1", `seat:${seat}`, "purpose:speech");
      got[`s${seat}`] = [streams[`s${seat}`].next(), streams[`s${seat}`].next()];
    }
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      got[`s${seat}`].push(streams[`s${seat}`].next(), streams[`s${seat}`].next(), streams[`s${seat}`].next());
      expect(got[`s${seat}`]).toEqual(expected[`s${seat}`]);
    }
  });

  it("同一轮不同阶段（phaseToken）派生不同流", () => {
    const f = createQuick6Rng(QUICK6_TEST_SEED_BYTES);
    expect(draws(f.stream("bot", "phase:night:2", "seat:3", "purpose:night"), 3)).not.toEqual(
      draws(f.stream("bot", "phase:vote:2", "seat:3", "purpose:vote"), 3),
    );
  });

  it("测试 seed 整数与字节往返可复现", () => {
    for (let i = 1; i <= 50; i++) {
      const bytes = seedBytesFromInt(i);
      const again = seedBytesFromInt(i);
      expect(draws(createQuick6Rng(bytes).stream("deal"), 2)).toEqual(
        draws(createQuick6Rng(again).stream("deal"), 2),
      );
    }
  });

  it("QUICK6_TEST_SEED 常量可复现", () => {
    expect(QUICK6_TEST_SEED).toBe(0x51a6c0de);
  });
});
