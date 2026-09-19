import type { AiProvider, Clock, Rng } from "@/tests/support/ports";
import { seedBytesFromInt } from "@/tests/support/prng";
import type { Role } from "@/tests/spec/quick6/types";

/** Fixed test seed; scenario tests and the frozen deal fixture build on it. */
export const QUICK6_TEST_SEED = 0x51a6c0de;
export const QUICK6_TEST_SEED_BYTES = seedBytesFromInt(QUICK6_TEST_SEED);
export const FIXED_NOW = new Date("2025-01-01T00:00:00.000Z");

/**
 * 冻结夹具：quick6-prng-v1 / deal 域 / QUICK6_TEST_SEED 的确定性发牌结果。
 * 算法版本变更时必须同步更新本夹具并发布新版本（docs/quick6-v1-rules.md §9）。
 */
export const FROZEN_DEAL_ROLES: readonly Role[] = [
  "SEER",
  "VILLAGER",
  "WOLF",
  "VILLAGER",
  "WOLF",
  "VILLAGER",
];
/** 同上：deal 域前 4 个抽取值（算法稳定性回归）。 */
export const FROZEN_DEAL_DRAWS: readonly number[] = [
  0.6550235152904839, 0.3656275711218726, 0.37717502864884733, 0.13702610371287816,
];

/** Small deterministic fixture PRNG (smoke only); spec code must receive the Rng port. */
export function seededRng(seed = QUICK6_TEST_SEED): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    },
  };
}

export const fixedClock: Clock = { now: () => new Date(FIXED_NOW) };

export function fakeAiProvider(responses: readonly string[]): AiProvider {
  let cursor = 0;
  return {
    async complete() {
      const response = responses[cursor++];
      if (response === undefined) throw new Error("No fake AI response queued");
      return response;
    },
  };
}
