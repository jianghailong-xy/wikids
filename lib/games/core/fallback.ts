/**
 * Deterministic fallback choice derivation (P3 persistence layer).
 *
 * When every provider attempt for a seat's action has failed, the fallback
 * choice is derived purely from (seed, phaseToken, seat, purpose) through
 * the version-pinned, path-derived RNG stream factory:
 *
 *   stream(`bot/phase:${phaseToken}/seat:${seat}/purpose:${purpose}`)
 *
 * Because the derivation is a pure function of the path and the seed, the
 * order in which concurrent submissions complete — or the order in which
 * streams are created — can never affect the result. The seed itself comes
 * from the SYSTEM-private store (game_system_private) and never from any
 * projection.
 */
import type { RngStreamFactory } from "./types";

/**
 * Pick a deterministic fallback choice id from `choiceIds` for
 * (phaseToken, seat, purpose). Same inputs -> same choice, regardless of
 * creation order or concurrency.
 *
 * @param rng     the seeded RNG stream factory (e.g. createQuick6Rng(seed)).
 * @param choiceIds the legal choice ids to pick from, in stable order.
 */
export function deriveFallbackChoice(
  rng: RngStreamFactory,
  phaseToken: string,
  seat: number,
  purpose: string,
  choiceIds: readonly string[],
): string {
  if (choiceIds.length === 0) {
    throw new Error("deriveFallbackChoice: no choice ids to pick from");
  }
  const stream = rng.stream(
    "bot",
    `phase:${phaseToken}`,
    `seat:${seat}`,
    `purpose:${purpose}`,
  );
  const index = Math.min(choiceIds.length - 1, Math.floor(stream.next() * choiceIds.length));
  return choiceIds[index];
}
