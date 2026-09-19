/**
 * quick6-prng-v1: the frozen versioned PRNG (docs/quick6-v1-rules.md §9).
 *
 * Primitive: FNV-1a 64-bit over the derivation material, then a SplitMix64
 * stream — byte-compatible with the frozen executable reference so that the
 * frozen deal fixture (tests/fixtures/determinism.ts) reproduces exactly.
 *
 * Domain separation: every purpose derives its OWN independent stream from a
 * pure path. Derivation is a function of (seedBytes, algorithmVersion, path)
 * ONLY — it never reads or advances another stream's state — so the order in
 * which streams are created, and the order in which seat submissions
 * complete (including concurrently), can never affect any stream's draws.
 *
 *   deal                                — role dealing (无放回洗牌)
 *   night-wolf-tiebreak/round:<n>       — wolf-kill tiebreak settlement
 *   bot/phase:<token>/seat:<s>/purpose:<p> — per-seat bot randomness
 *
 * The algorithm version string is part of the derivation input: changing the
 * algorithm requires publishing a new version, and old streams stay
 * reproducible forever. Seeds must be ≥16 bytes (production: 32 bytes of
 * cryptographic randomness) and never enter projections or events.
 */
import type { Rng, RngStreamFactory } from "@/lib/games/core";
import { InvalidSeedError } from "@/lib/games/core";
import { QUICK6_GAME_VERSIONS } from "./versions";

const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over bytes. */
function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/** SplitMix64: stable, well-understood 64-bit stream. */
function splitmix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { state: next, value: z };
}

const encoder = new TextEncoder();

/** Validate seed bytes: ≥16 bytes, production uses 32 crypto-random bytes. */
export function assertSeedBytes(seedBytes: Uint8Array): void {
  if (!(seedBytes instanceof Uint8Array)) {
    throw new InvalidSeedError("seedBytes must be a Uint8Array");
  }
  if (seedBytes.length < 16) {
    throw new InvalidSeedError(
      "seedBytes must be at least 16 bytes (production uses 32 crypto-random bytes)",
    );
  }
}

/**
 * Seeded, version-pinned, path-derived RNG factory (quick6-prng-v1).
 *
 * `stream(...path)` returns an independent deterministic stream: the same
 * (seedBytes, version, path) yields the identical stream forever, and
 * different paths never share state.
 */
export function createQuick6Rng(seedBytes: Uint8Array): RngStreamFactory {
  assertSeedBytes(seedBytes);
  const prefix = encoder.encode(`${QUICK6_GAME_VERSIONS.prng}|`);
  return {
    stream(...pathParts: readonly string[]): Rng {
      const path = pathParts.join("/");
      const material = new Uint8Array(prefix.length + path.length + 1 + seedBytes.length);
      material.set(prefix, 0);
      for (let i = 0; i < path.length; i++) material[prefix.length + i] = path.charCodeAt(i);
      material[prefix.length + path.length] = 0x7c; // "|"
      material.set(seedBytes, prefix.length + path.length + 1);
      let state = fnv1a64(material);
      return {
        next(): number {
          const { state: nextState, value } = splitmix64(state);
          state = nextState;
          return Number(value >> 11n) / Number(1n << 53n);
        },
      };
    },
  };
}

/** Purpose-domain paths used by quick6 (documented, frozen). */
export const QUICK6_RNG_DOMAINS = {
  /** Role dealing (无放回洗牌). */
  DEAL: "deal",
  /** Wolf-kill tiebreak among distinct targets, one stream per round. */
  NIGHT_WOLF_TIEBREAK: "night-wolf-tiebreak",
} as const;
