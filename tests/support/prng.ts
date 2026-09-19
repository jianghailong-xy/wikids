import type { Rng } from "./ports";

/**
 * Frozen versioned PRNG for quick6.
 *
 * Production dealing will seed this with 32 bytes of server-side
 * cryptographic randomness (`crypto.randomBytes(32)`) and must keep the seed
 * out of every projection, event, ordinary log and client payload. The
 * algorithm version string is part of the derivation input, so changing the
 * algorithm requires publishing a new version: old streams stay reproducible
 * forever.
 */
export const QUICK6_PRNG_ALGORITHM_VERSION = "quick6-prng-v1";

/** Purpose domains: each purpose derives an independent deterministic stream. */
export const PRNG_DOMAINS = {
  /** Role dealing (无放回洗牌). */
  DEAL: "deal",
  /** Wolf-kill tiebreak among distinct targets. */
  NIGHT_WOLF_TIEBREAK: "night-wolf-tiebreak",
} as const;

export type PrngDomain = (typeof PRNG_DOMAINS)[keyof typeof PRNG_DOMAINS];

const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over bytes: mixes version, domain and seed into one state. */
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

export interface VersionedRngOptions {
  /** At least 16 bytes; production uses 32 bytes of crypto randomness. */
  seedBytes: Uint8Array;
  domain: PrngDomain | (string & {});
  /** Defaults to QUICK6_PRNG_ALGORITHM_VERSION. */
  algorithmVersion?: string;
}

/**
 * Deterministic, domain-separated, version-pinned RNG.
 * Same (seedBytes, domain, algorithmVersion) => identical stream, replayable
 * forever. Different seed, domain or version => different stream.
 */
export function createVersionedRng(options: VersionedRngOptions): Rng {
  const { seedBytes, domain, algorithmVersion = QUICK6_PRNG_ALGORITHM_VERSION } = options;
  if (seedBytes.length < 16) {
    throw new Error("seedBytes must be at least 16 bytes (production uses 32)");
  }
  const encoder = new TextEncoder();
    // "|" is unambiguous: version and domain strings never contain it.
  const prefix = encoder.encode(`${algorithmVersion}|${domain}|`);
  const material = new Uint8Array(prefix.length + seedBytes.length);
  material.set(prefix, 0);
  material.set(seedBytes, prefix.length);
  let state = fnv1a64(material);
  return {
    next() {
      const { state: nextState, value } = splitmix64(state);
      state = nextState;
      return Number(value >> 11n) / Number(1n << 53n);
    },
  };
}

/** 32-byte big-endian seed bytes from a non-negative integer (test seeds 1..1000+). */
export function seedBytesFromInt(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) throw new Error("seed int must be a non-negative integer");
  const out = new Uint8Array(32);
  let v = BigInt(n);
  for (let i = 31; i >= 24; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function seedBytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
