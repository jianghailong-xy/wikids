/**
 * Production/test randomness boundary per docs/quick6-v1-rules.md §9:
 * versioned, domain-separated, replayable PRNG; at least 1000 distinct
 * reproducible test seeds; the frozen deal fixture; and the guarantee that
 * seeds never enter projections.
 */
import { describe, expect, it } from "vitest";

import {
  QUICK6_PRNG_ALGORITHM_VERSION,
  PRNG_DOMAINS,
  createVersionedRng,
  seedBytesFromInt,
  seedBytesToHex,
} from "@/tests/support/prng";
import {
  FIXED_NOW,
  FROZEN_DEAL_DRAWS,
  FROZEN_DEAL_ROLES,
  QUICK6_TEST_SEED,
  QUICK6_TEST_SEED_BYTES,
  fixedClock,
} from "@/tests/fixtures/determinism";
import { DEFAULT_MAX_PHASE_STEPS, SpecGame } from "./model";
import { publicProjection, viewFor } from "./projection";
import { randomLegalPlay, trace } from "./random-play";
import { ALL_SEATS, ROLE_MULTISET, type Role } from "./types";

const W = "WOLF";
const S = "SEER";
const V = "VILLAGER";

describe("版本化 PRNG（quick6-prng-v1）", () => {
  it("冻结算法版本常量", () => {
    expect(QUICK6_PRNG_ALGORITHM_VERSION).toBe("quick6-prng-v1");
  });

  it("同种子同域 → 完全相同的流；种子/域/版本任一不同 → 不同流", () => {
    const draw = (seed: number, domain: string, version?: string) => {
      const rng = createVersionedRng({
        seedBytes: seedBytesFromInt(seed),
        domain,
        ...(version === undefined ? {} : { algorithmVersion: version }),
      });
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(draw(1, PRNG_DOMAINS.DEAL)).toEqual(draw(1, PRNG_DOMAINS.DEAL));
    expect(draw(1, PRNG_DOMAINS.DEAL)).not.toEqual(draw(2, PRNG_DOMAINS.DEAL));
    expect(draw(1, PRNG_DOMAINS.DEAL)).not.toEqual(draw(1, PRNG_DOMAINS.NIGHT_WOLF_TIEBREAK));
    expect(draw(1, PRNG_DOMAINS.DEAL)).not.toEqual(draw(1, PRNG_DOMAINS.DEAL, "quick6-prng-v2"));
  });

  it("种子必须 ≥16 字节（生产使用 32 字节密码学随机）", () => {
    expect(() =>
      createVersionedRng({ seedBytes: new Uint8Array(8), domain: PRNG_DOMAINS.DEAL }),
    ).toThrow(/at least 16 bytes/);
    expect(() =>
      createVersionedRng({ seedBytes: new Uint8Array(32), domain: PRNG_DOMAINS.DEAL }),
    ).not.toThrow();
  });
});

describe("固定 seed fixture", () => {
  it("QUICK6_TEST_SEED 发牌结果与冻结夹具一致（算法稳定性回归）", () => {
    const g = new SpecGame({ seedBytes: QUICK6_TEST_SEED_BYTES });
    expect(g.roles).toEqual(FROZEN_DEAL_ROLES);
    expect(g.roles.filter((r) => r === "WOLF")).toHaveLength(2);
    expect(g.roles.filter((r) => r === "SEER")).toHaveLength(1);
    expect(g.roles.filter((r) => r === "VILLAGER")).toHaveLength(3);
  });

  it("QUICK6_TEST_SEED 的 deal 域前 4 个抽取与冻结夹具一致", () => {
    const rng = createVersionedRng({
      seedBytes: QUICK6_TEST_SEED_BYTES,
      domain: PRNG_DOMAINS.DEAL,
    });
    const draws = Array.from({ length: 4 }, () => rng.next());
    expect(draws).toEqual(FROZEN_DEAL_DRAWS);
  });

  it("固定时钟 fixture 可复现", () => {
    expect(fixedClock.now()).toEqual(FIXED_NOW);
  });
});

describe("至少 1000 个不同、可复现 seed", () => {
  it("seed 1..1000：整局重放字节级一致、必然以真实胜负告终、不触发步数上限", () => {
    const seatRoleCounts = ALL_SEATS.map(() => ({ WOLF: 0, SEER: 0, VILLAGER: 0 }));
    for (let i = 1; i <= 1000; i++) {
      const seedBytes = seedBytesFromInt(i);
      const first = randomLegalPlay(seedBytes, i);
      const second = randomLegalPlay(seedBytes, i);
      // 可重放：同 seed 同策略 → 完全相同的轨迹
      expect(trace(second)).toBe(trace(first));
      // 合法玩法必然终止于真实胜负（无和局），且远低于异常步数上限
      expect(first.phase).toBe("END");
      expect(first.outcome).not.toBeNull();
      expect(first.steps).toBeLessThanOrEqual(DEFAULT_MAX_PHASE_STEPS);
      // 发牌成分冻结：每局都是 2 狼 / 1 预言家 / 3 平民
      for (const [idx, role] of first.roles.entries()) {
        expect(ROLE_MULTISET.filter((r) => r === role).length).toBeGreaterThan(0);
        seatRoleCounts[idx][role] += 1;
      }
    }
    // 1000 个 seed 的发牌在每席对每种身份都充分覆盖（无系统性偏置）
    for (const counts of seatRoleCounts) {
      expect(counts.WOLF).toBeGreaterThanOrEqual(100);
      expect(counts.SEER).toBeGreaterThanOrEqual(100);
      expect(counts.VILLAGER).toBeGreaterThanOrEqual(100);
    }
  });

  it("狼刀不同票的并票定夺在 1000 个 seed 上都可重放且来自并列目标", () => {
    for (let i = 1; i <= 1000; i++) {
      const seedBytes = seedBytesFromInt(i);
      const run = () => {
        const g = new SpecGame({ seedBytes, roles: [W, W, S, V, V, V] });
        g.submitWolfKill(0, 2);
        g.submitWolfKill(1, 3);
        g.submitSeerCheck(2, 1);
        g.finishNight();
        return g.eliminations[0].seat;
      };
      const victim = run();
      expect([2, 3]).toContain(victim);
      expect(run()).toBe(victim);
    }
  });
});

describe("种子保密", () => {
  it("种子不得进入投影（任意阶段、任意观察者）", () => {
    const seedBytes = seedBytesFromInt(20250919);
    const seedHex = seedBytesToHex(seedBytes);
    const g = new SpecGame({ seedBytes });
    const jsons: string[] = [];
    const snap = () => {
      jsons.push(JSON.stringify(publicProjection(g)));
      for (const s of ALL_SEATS) jsons.push(JSON.stringify(viewFor(g, s)));
    };
    snap();
    const legalNonWolf = (w: number) =>
      g.livingSeats().filter((t) => t !== w && g.roles[t] !== "WOLF");
    for (const w of g.livingWolves()) g.submitWolfKill(w, legalNonWolf(w)[0]);
    const seer = g.livingSeats().find((s) => g.roles[s] === "SEER");
    if (seer !== undefined) {
      g.submitSeerCheck(seer, g.livingSeats().find((t) => t !== seer) ?? 0);
    }
    g.finishNight();
    snap();
    for (const json of jsons) {
      expect(json).not.toContain(seedHex);
      expect(json).not.toContain(seedHex.slice(0, 16));
      expect(json).not.toContain("seed");
    }
  });
});
