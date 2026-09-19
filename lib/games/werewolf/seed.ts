/**
 * Production/test seed boundary (docs/quick6-v1-rules.md §9).
 *
 * Production dealing accepts 32 bytes of server-side cryptographic
 * randomness via {@link generateSeedBytes}; the domain itself never reads
 * environment variables or touches the network. Test fixtures pass fixed
 * seeds via {@link seedBytesFromInt}.
 *
 * The seed is server-private: it must never enter any projection, event,
 * ordinary log or client payload.
 */
import { randomBytes } from "node:crypto";

/** Production seed: 32 bytes of cryptographic randomness. */
export function generateSeedBytes(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/** 32-byte big-endian seed bytes from a non-negative integer (test seeds). */
export function seedBytesFromInt(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("seed int must be a non-negative integer");
  }
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

/** Printable, reproducible ASCII seed label, e.g. `s-0042 (hex 00…2a)`. */
export function seedLabel(bytes: Uint8Array, int?: number): string {
  const hex = seedBytesToHex(bytes);
  return int === undefined ? `hex-${hex}` : `s-${String(int).padStart(4, "0")} (${hex})`;
}
