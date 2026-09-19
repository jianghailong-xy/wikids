/**
 * quick6-v1 frozen spec types (test-side executable reference, not a
 * production engine). See docs/quick6-v1-rules.md.
 */

export const SEAT_COUNT = 6;
export const ALL_SEATS: readonly SeatId[] = [0, 1, 2, 3, 4, 5];

/** Seat id, 0..5. */
export type SeatId = number;

export type Role = "WOLF" | "SEER" | "VILLAGER";
export type Team = "WOLF" | "TOWN";

/** Frozen role multiset: 2 wolves / 1 seer / 3 villagers. */
export const ROLE_MULTISET: readonly Role[] = [
  "WOLF",
  "WOLF",
  "SEER",
  "VILLAGER",
  "VILLAGER",
  "VILLAGER",
];

/**
 * Generalized external phase names. Internal sub-steps (wolf-kill collection,
 * seer-check collection, pending AI turns, tiebreak) must NEVER appear here or
 * in any projection/event: names like NIGHT_SEER / NIGHT_WOLF are forbidden.
 */
export type ExternalPhase = "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE" | "END";

/** No draw exists in quick6-v1: a game always ends with one side winning. */
export type WinReason = "WOLVES_EXTERMINATED" | "WOLVES_MAJORITY";
export interface GameOutcome {
  winner: Team;
  reason: WinReason;
}

export type EliminationKind = "NIGHT_KILL" | "DAY_EXILE";
export interface EliminationRecord {
  round: number;
  kind: EliminationKind;
  seat: SeatId;
}

/** null text = explicit skip. */
export interface SpeechRecord {
  round: number;
  seat: SeatId;
  text: string | null;
}

export interface VoteRecord {
  round: number;
  seat: SeatId;
  target: SeatId;
}

/** Private seer history; retained even if the seer dies the same night. */
export interface SeerCheckRecord {
  round: number;
  target: SeatId;
  isWolf: boolean;
}

/** Public event log entries; values are generalized, no internal sub-phases. */
export type PublicEvent =
  | { type: "PHASE"; round: number; phase: ExternalPhase }
  | { type: "ELIMINATION"; record: EliminationRecord }
  | { type: "SPEECH"; record: SpeechRecord }
  | { type: "VOTE"; record: VoteRecord }
  | { type: "GAME_OVER"; winner: Team; reason: WinReason };
