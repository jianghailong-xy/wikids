import { describe, expect, it } from "vitest";

import {
  FIXED_NOW,
  QUICK6_TEST_SEED,
  fixedClock,
  seededRng,
} from "@/tests/fixtures/determinism";
import {
  QUICK6_PRNG_ALGORITHM_VERSION,
  PRNG_DOMAINS,
  createVersionedRng,
} from "@/tests/support/prng";

describe("test foundation", () => {
  it("resolves the @ path alias and repeats a fixed RNG sequence", () => {
    const first = seededRng(QUICK6_TEST_SEED);
    const second = seededRng(QUICK6_TEST_SEED);
    const sequence = () => Array.from({ length: 8 }, () => first.next());

    expect(sequence()).toEqual(Array.from({ length: 8 }, () => second.next()));
  });

  it("uses an injected fixed clock", () => {
    expect(fixedClock.now()).toEqual(FIXED_NOW);
    expect(fixedClock.now()).not.toBe(FIXED_NOW);
  });

  it("has no database or real DeepSeek credentials and blocks network", () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(() => fetch("https://api.deepseek.com")).toThrow(/Network access is disabled/);
  });

  it("exposes the frozen versioned PRNG", () => {
    expect(QUICK6_PRNG_ALGORITHM_VERSION).toBe("quick6-prng-v1");
    const a = createVersionedRng({
      seedBytes: new Uint8Array(32).fill(7),
      domain: PRNG_DOMAINS.DEAL,
    });
    const b = createVersionedRng({
      seedBytes: new Uint8Array(32).fill(7),
      domain: PRNG_DOMAINS.DEAL,
    });
    expect(Array.from({ length: 4 }, () => a.next())).toEqual(
      Array.from({ length: 4 }, () => b.next()),
    );
  });
});
