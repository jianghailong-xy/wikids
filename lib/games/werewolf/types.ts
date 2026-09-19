/**
 * quick6-v1 frozen spec types (production domain implementation).
 * See docs/quick6-v1-rules.md — every decision table there is implemented by
 * the Quick6Definition in ./definition.ts.
 *
 * The external phase names are generalized: internal sub-steps (wolf-kill
 * collection, seer-check collection, pending AI turns, tiebreak) must NEVER
 * appear in projections, events or any client-visible field — names like
 * NIGHT_SEER / NIGHT_WOLF are forbidden (§2).
 */
import type { EngineState, GameEvent, GameResult } from "@/lib/games/core";

export const SEAT_COUNT = 6;
export const ALL_SEATS: readonly SeatId[] = [0, 1, 2, 3, 4, 5];

/** Seat id, 0..5. */
export type SeatId = number;

export type Role = "WOLF" | "SEER" | "VILLAGER";
export type Team = "WOLF" | "TOWN";

/** Frozen role multiset: 2 wolves / 1 seer / 3 villagers (§1). */
export const ROLE_MULTISET: readonly Role[] = [
  "WOLF",
  "WOLF",
  "SEER",
  "VILLAGER",
  "VILLAGER",
  "VILLAGER",
];

/** Generalized external phases — exactly these four values (§2). */
export type ExternalPhase = "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE" | "END";
export const ALL_PHASES: readonly ExternalPhase[] = [
  "NIGHT",
  "DAY_DISCUSSION",
  "DAY_VOTE",
  "END",
];

/** No draw exists in quick6-v1: a game always ends with one side winning. */
export type WinReason = "WOLVES_EXTERMINATED" | "WOLVES_MAJORITY";
export interface GameOutcome extends GameResult {
  winner: Team;
  reason: WinReason;
}

export type EliminationKind = "NIGHT_KILL" | "DAY_EXILE";
export interface EliminationRecord {
  readonly round: number;
  readonly kind: EliminationKind;
  readonly seat: SeatId;
}

/** null text = explicit skip (§4). */
export interface SpeechRecord {
  readonly round: number;
  readonly seat: SeatId;
  readonly text: string | null;
}

export interface VoteRecord {
  readonly round: number;
  readonly seat: SeatId;
  readonly target: SeatId;
}

/** Private seer history; retained even if the seer dies the same night (§3). */
export interface SeerCheckRecord {
  readonly round: number;
  readonly target: SeatId;
  readonly isWolf: boolean;
}

/**
 * Public event payloads (event schema `quick6-events-v1`). Values are
 * generalized: no internal sub-phases, no roles of the eliminated, no seeds.
 */
export type Quick6EventPayload =
  | { type: "PHASE"; round: number; phase: ExternalPhase }
  | { type: "ELIMINATION"; record: EliminationRecord }
  | { type: "SPEECH"; record: SpeechRecord }
  | { type: "VOTE"; record: VoteRecord }
  | { type: "GAME_OVER"; winner: Team; reason: WinReason };

export type Quick6Event = GameEvent<Quick6EventPayload>;

/**
 * Commands. Submission commands come from seats (human or AI); settlement
 * commands (FINISH_*) come from the system once submissions are complete.
 */
export type Quick6Command =
  | { type: "SUBMIT_WOLF_KILL"; seat: SeatId; target: SeatId }
  | { type: "SUBMIT_SEER_CHECK"; seat: SeatId; target: SeatId }
  | { type: "FINISH_NIGHT" }
  | { type: "SUBMIT_SPEECH"; seat: SeatId; text: string | null }
  | { type: "FINISH_DISCUSSION" }
  | { type: "SUBMIT_DAY_VOTE"; seat: SeatId; target: SeatId }
  | { type: "FINISH_VOTE" };

export interface Quick6StartOptions {
  /** Optional explicit role table (must be the §1 multiset) for fixtures. */
  roles?: readonly Role[];
  /** Human seat, default 0; the other five seats are AI (§1). */
  humanSeat?: SeatId;
}

/**
 * Full server state. `revision` and `events` are engine-owned; `seedBytes`
 * is server-private and must never enter projections, events or any client
 * payload (§9). All containers are plain JSON-safe arrays (no Map/Set) so
 * the state serializes deterministically.
 */
export interface Quick6State extends EngineState<Quick6EventPayload> {
  readonly definitionId: typeof import("./versions").QUICK6_DEFINITION_ID;
  readonly seedBytes: Uint8Array;
  readonly humanSeat: SeatId;
  readonly roles: readonly Role[];
  readonly alive: readonly boolean[];
  /** Successful transitions so far (abnormal-protection counter, §6). */
  readonly steps: number;
  readonly round: number;
  readonly phase: ExternalPhase;
  readonly outcome: GameOutcome | null;
  readonly eliminations: readonly EliminationRecord[];
  readonly speeches: readonly SpeechRecord[];
  readonly votes: readonly VoteRecord[];
  readonly seerChecks: readonly SeerCheckRecord[];
  /** Server-private night buffers (indexed by seat; never in any view). */
  readonly nightWolfKills: readonly (SeatId | null)[];
  readonly seerSubmitted: boolean;
  readonly nightSeerTarget: SeatId | null;
}
