/**
 * Visibility-compliant projections (docs/quick6-v1-rules.md §7) with a single
 * forward projector: {@link projectView}(state, viewer).
 *
 * The full server state (roles, deal seed, night buffers, check history,
 * revision bookkeeping) is never serialized to a player directly: every
 * observer gets exactly what its viewer scope authorizes, and nothing more.
 * The human API, AI prompts (`aiContextFor`), reconnection and replay MUST
 * all go through {@link projectView} — never `JSON.stringify(serverState)`
 * followed by field deletion.
 *
 * Viewer scopes:
 * - PUBLIC      — public facts only (phase, round, alive seats, speeches,
 *                 votes, eliminations, outcome). Roles are revealed here and
 *                 everywhere exactly at END (离场不揭示身份, §7).
 * - PLAYER      — public facts + exactly that seat's own private info:
 *                 own role, own seer-check history (living seer only), own
 *                 buffered night submission (§7: 提交者自己可见).
 * - TEAM_WOLVES — a wolf seat's view: PLAYER info + living wolf teammates.
 *                 Requested by a non-wolf it degrades to PLAYER (no team
 *                 info is ever granted).
 * - SYSTEM      — the full server state. Server-only: must never be
 *                 serialized to any client, bot or provider.
 * - POST_GAME   — the post-game reveal: public facts, with the role table
 *                 revealed exactly when the game has ended (§7).
 *
 * Dead players receive public info only (plus the role they already know)
 * and spectate.
 */
import { ALL_SEATS } from "./types";
import type {
  EliminationRecord,
  ExternalPhase,
  GameOutcome,
  Quick6State,
  Role,
  SeatId,
  SeerCheckRecord,
  SpeechRecord,
  VoteRecord,
} from "./types";

/** The five frozen visibility scopes. */
export type ViewerScope = "PUBLIC" | "PLAYER" | "TEAM_WOLVES" | "SYSTEM" | "POST_GAME";

/** A viewer descriptor: which scope, and for seat-scoped views which seat. */
export type Viewer =
  | { readonly scope: "PUBLIC" }
  | { readonly scope: "POST_GAME" }
  | { readonly scope: "SYSTEM" }
  | { readonly scope: "PLAYER"; readonly seat: SeatId }
  | { readonly scope: "TEAM_WOLVES"; readonly seat: SeatId };

/** Public facts shared by every non-SYSTEM view. */
export interface PublicFacts {
  readonly phase: ExternalPhase;
  readonly round: number;
  readonly seats: SeatId[];
  readonly aliveSeats: SeatId[];
  readonly humanSeat: SeatId;
  readonly eliminations: readonly EliminationRecord[];
  readonly speeches: readonly SpeechRecord[];
  readonly votes: readonly VoteRecord[];
  readonly outcome: GameOutcome | null;
  /** Full role reveal at END; null before that (离场不揭示身份). */
  readonly rolesRevealed: readonly Role[] | null;
}

/** The PUBLIC / POST_GAME scope: public facts only. */
export interface PublicProjection extends PublicFacts {
  readonly scope: "PUBLIC" | "POST_GAME";
}

/** A seat-scoped view: public facts + exactly that seat's own private info. */
export interface SeatView extends PublicFacts {
  readonly scope: "PLAYER" | "TEAM_WOLVES";
  readonly seat: SeatId;
  /** Own role is self-knowledge and stays visible after death. */
  readonly ownRole: Role;
  /** Wolf teammates (living wolves except self); only for a living wolf. */
  readonly wolfTeammates: SeatId[];
  /** Seer check history (living seer only); dead players get none. */
  readonly seerChecks: SeerCheckRecord[];
  /** Own buffered night submission (§7: 提交者自己可见), null outside NIGHT. */
  readonly ownNightSubmission: { readonly target: SeatId } | null;
}

/** The SYSTEM scope: the full server state (server-only, never to clients). */
export interface SystemView {
  readonly scope: "SYSTEM";
  readonly state: Readonly<Quick6State>;
}

export type ProjectedView = PublicProjection | SeatView | SystemView;

/** The public part of a projection, built forward from state (never by copy-then-delete). */
function publicInfo(state: Quick6State): PublicFacts {
  return {
    phase: state.phase,
    round: state.round,
    seats: [...ALL_SEATS],
    aliveSeats: livingSeats(state),
    humanSeat: state.humanSeat,
    eliminations: [...state.eliminations],
    speeches: [...state.speeches],
    votes: [...state.votes],
    outcome: state.outcome,
    rolesRevealed: state.phase === "END" ? [...state.roles] : null,
  };
}

/**
 * The single forward projector: every observer's view is produced here and
 * only here. The projected object contains ONLY fields the viewer scope
 * authorizes — the full state never appears in any non-SYSTEM view.
 */
export function projectView(state: Quick6State, viewer: Viewer): ProjectedView {
  switch (viewer.scope) {
    case "PUBLIC":
    case "POST_GAME":
      return { scope: viewer.scope, ...publicInfo(state) };
    case "SYSTEM":
      return { scope: "SYSTEM", state };
    case "PLAYER":
    case "TEAM_WOLVES":
      return seatView(state, viewer.seat, viewer.scope === "TEAM_WOLVES");
  }
}

/** Seat-scoped projection; team info is granted only to a living wolf. */
function seatView(state: Quick6State, seat: SeatId, requestTeam: boolean): SeatView {
  const role = state.roles[seat];
  const isAlive = state.alive[seat];
  const grantTeam = requestTeam && role === "WOLF" && isAlive;
  const ownNightSubmission =
    state.phase === "NIGHT"
      ? role === "WOLF" && state.nightWolfKills[seat] !== null
        ? { target: state.nightWolfKills[seat] as SeatId }
        : role === "SEER" && state.seerSubmitted && state.nightSeerTarget !== null
          ? { target: state.nightSeerTarget }
          : null
      : null;
  return {
    scope: requestTeam ? "TEAM_WOLVES" : "PLAYER",
    ...publicInfo(state),
    seat,
    ownRole: role,
    wolfTeammates: grantTeam
      ? ALL_SEATS.filter((s) => s !== seat && state.roles[s] === "WOLF" && state.alive[s])
      : [],
    seerChecks: role === "SEER" && isAlive ? [...state.seerChecks] : [],
    ownNightSubmission,
  };
}

/** Public projection via the single projector (PUBLIC scope). */
export function publicProjection(state: Quick6State): PublicProjection {
  return projectView(state, { scope: "PUBLIC" }) as PublicProjection;
}

/**
 * What `seat` sees, via the single projector: a wolf gets the TEAM_WOLVES
 * scope, every other seat the PLAYER scope. Dead players only receive public
 * info (plus their own role, which they already know) and spectate.
 */
export function viewFor(state: Quick6State, seat: SeatId): SeatView {
  const grantTeam = state.roles[seat] === "WOLF" && state.alive[seat];
  return seatView(state, seat, grantTeam);
}

/**
 * AI context = exactly viewFor(seat) through the single projector: later
 * speakers only see already-public earlier speeches plus their own private
 * info. Never hidden roles, other players' private data, or the seed.
 */
export function aiContextFor(state: Quick6State, seat: SeatId): SeatView {
  return viewFor(state, seat);
}

export function livingSeats(state: Quick6State): SeatId[] {
  return ALL_SEATS.filter((s) => state.alive[s]);
}
