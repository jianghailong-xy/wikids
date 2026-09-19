/**
 * Visibility-compliant projections per docs/quick6-v1-rules.md §7.
 * The full server state (roles, deal seed, night buffers, check history) is
 * never serialized to a player directly; each observer gets viewFor(seat).
 */
import type { SpecGame } from "./model";
import {
  ALL_SEATS,
  type EliminationRecord,
  type ExternalPhase,
  type GameOutcome,
  type Role,
  type SeatId,
  type SeerCheckRecord,
  type SpeechRecord,
  type VoteRecord,
} from "./types";

export interface PublicProjection {
  phase: ExternalPhase;
  round: number;
  seats: SeatId[];
  aliveSeats: SeatId[];
  humanSeat: SeatId;
  eliminations: EliminationRecord[];
  speeches: SpeechRecord[];
  votes: VoteRecord[];
  outcome: GameOutcome | null;
  /** Full role reveal at END; null before that (离场不揭示身份). */
  rolesRevealed: readonly Role[] | null;
}

export function publicProjection(game: SpecGame): PublicProjection {
  return {
    phase: game.phase,
    round: game.round,
    seats: [...ALL_SEATS],
    aliveSeats: game.livingSeats(),
    humanSeat: game.humanSeat,
    eliminations: [...game.eliminations],
    speeches: [...game.speeches],
    votes: [...game.dayVotes],
    outcome: game.outcome,
    rolesRevealed: game.phase === "END" ? [...game.roles] : null,
  };
}

export interface SeatView extends PublicProjection {
  seat: SeatId;
  /** Own role is self-knowledge and stays visible after death. */
  ownRole: Role;
  /** Wolf teammates (alive wolves only); dead players get none. */
  wolfTeammates: SeatId[];
  /** Seer check history (alive seer only); dead players get none. */
  seerChecks: SeerCheckRecord[];
}

/**
 * What seat sees: public info plus exactly its own private info per §7.
 * Dead players only receive public info (plus their own role, which they
 * already know) and spectate.
 */
export function viewFor(game: SpecGame, seat: SeatId): SeatView {
  const role = game.roles[seat];
  const isAlive = game.alive[seat];
  return {
    ...publicProjection(game),
    seat,
    ownRole: role,
    wolfTeammates:
      role === "WOLF" && isAlive
        ? ALL_SEATS.filter((s) => s !== seat && game.roles[s] === "WOLF")
        : [],
    seerChecks: role === "SEER" && isAlive ? [...game.seerChecks] : [],
  };
}

/**
 * AI context = exactly viewFor(seat): later speakers only see already-public
 * earlier speeches (enforced by seat order in the model) plus their own
 * private info. Never hidden roles, other players' private data, or the seed.
 */
export function aiContextFor(game: SpecGame, seat: SeatId): SeatView {
  return viewFor(game, seat);
}
