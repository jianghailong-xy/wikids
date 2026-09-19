import fc from "fast-check";
import { expect, it } from "vitest";

it("runs reproducible property tests with an explicit seed", () => {
  const property = fc.property(fc.array(fc.integer()), (values) => {
    expect([...values].reverse().reverse()).toEqual(values);
  });
  // 显式 seed + numRuns：失败可重放；重复运行结果确定
  fc.assert(property, { seed: 20250101, numRuns: 100 });
  fc.assert(property, { seed: 20250101, numRuns: 100 });
});
