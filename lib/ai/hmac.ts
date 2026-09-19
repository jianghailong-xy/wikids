/**
 * Irreversible game-seat HMAC → anonymous provider user id (P3.3 contract,
 * lib/ai/README.md §6).
 *
 * Providers receive a `user` id that identifies (game, seat) to the provider
 * without revealing it: an HMAC-SHA256 over the game id and seat keyed by a
 * server-only secret. The mapping is one-way — the provider id cannot be
 * reversed to a game or seat, the raw game id is never sent, and no name,
 * email or account identifier ever appears in a provider request.
 *
 * Server-only: node:crypto. Never import from a client component.
 */
import "server-only";

import { createHmac } from "node:crypto";

const HMAC_ALGORITHM = "sha256";
/** Domain-separation label, bumped on any change to the derivation. */
const HMAC_DOMAIN = "game-seat-anon-v1";

/**
 * Anonymous provider user id for a deciding seat. Deterministic for
 * (secret, gameId, seat); distinct across games, seats and secrets; the
 * output contains neither the game id nor the seat.
 */
export function anonymousGameSeatId(secret: string, gameId: string, seat: number): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("anonymousGameSeatId: secret must be a non-empty string");
  }
  if (typeof gameId !== "string" || gameId.length === 0) {
    throw new Error("anonymousGameSeatId: gameId must be a non-empty string");
  }
  if (!Number.isInteger(seat) || seat < 0 || seat > 63) {
    throw new Error("anonymousGameSeatId: seat must be an integer in 0..63");
  }
  const mac = createHmac(HMAC_ALGORITHM, secret)
    .update(`${HMAC_DOMAIN}:${gameId}:${seat}`)
    .digest("base64url");
  return `anon-${mac}`;
}
