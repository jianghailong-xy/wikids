/**
 * P3.3 anonymous game-seat HMAC (lib/ai/README.md §6): irreversible,
 * deterministic per (secret, gameId, seat), never embedding the inputs.
 */
import { describe, expect, it } from "vitest";

import { anonymousGameSeatId } from "@/lib/ai";

describe("anonymousGameSeatId", () => {
  it("is deterministic for the same (secret, gameId, seat)", () => {
    expect(anonymousGameSeatId("s", "g1", 1)).toBe(anonymousGameSeatId("s", "g1", 1));
  });

  it("differs across seats, games and secrets", () => {
    const ids = [
      anonymousGameSeatId("s", "g1", 1),
      anonymousGameSeatId("s", "g1", 2),
      anonymousGameSeatId("s", "g2", 1),
      anonymousGameSeatId("t", "g1", 1),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces a bounded anon- id that contains neither the game id nor the seat", () => {
    const id = anonymousGameSeatId("secret", "game-abc-123", 4);
    expect(id.startsWith("anon-")).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).not.toContain("game-abc-123");
    expect(id).not.toContain(":4");
    expect(id).not.toContain("secret");
  });

  it("is not reversible to the inputs (different inputs can never collide with the same id format)", () => {
    // No inverse exists: nothing in the output encodes gameId/seat beyond
    // the keyed MAC; the strongest observable statement is that the two
    // distinct inputs map to distinct opaque ids.
    const a = anonymousGameSeatId("s", "game-xyz", 0);
    const b = anonymousGameSeatId("s", "game-xyy", 0);
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
  });

  it("fails closed on missing secret or malformed inputs", () => {
    expect(() => anonymousGameSeatId("", "g", 1)).toThrow();
    expect(() => anonymousGameSeatId("s", "", 1)).toThrow();
    expect(() => anonymousGameSeatId("s", "g", -1)).toThrow();
    expect(() => anonymousGameSeatId("s", "g", 1.5)).toThrow();
    expect(() => anonymousGameSeatId("s", "g", 64)).toThrow();
  });
});
