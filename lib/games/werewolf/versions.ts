/**
 * Frozen version stamp for quick6-v1 (docs/quick6-v1-rules.md).
 *
 * Any change to the rules, the definition, the event schema or the PRNG
 * algorithm must be published as a NEW version — these constants are frozen
 * and the derivation material of every deterministic stream.
 */
import type { GameVersions } from "@/lib/games/core";

export const QUICK6_DEFINITION_ID = "quick6" as const;
export const QUICK6_TITLE = "狼人杀 quick6" as const;

/** Frozen: 规则版本 quick6-v1，PRNG 算法版本 quick6-prng-v1。 */
export const QUICK6_GAME_VERSIONS: GameVersions = {
  definition: "quick6-def-v1",
  rules: "quick6-v1",
  eventSchema: "quick6-events-v1",
  prng: "quick6-prng-v1",
};

/** Default abnormal-protection step cap (docs/quick6-v1-rules.md §6). */
export const DEFAULT_MAX_PHASE_STEPS = 200;
