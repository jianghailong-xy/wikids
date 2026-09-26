/**
 * The client-side reading of the P5.1 session envelope (P6.1 UI).
 *
 * docs/game-api-protocol.md freezes what crosses the wire. This module is
 * the ONE place the UI reads it: every field is copied out explicitly through
 * a whitelist, so a field the protocol does not define can never reach the
 * DOM, the RSC payload or a component prop even if a response carries it.
 *
 * It is deliberately dependency-free (no `server-only`, no node builtins, no
 * import of the service layer) because the same code runs in the RSC render
 * and in the browser bundle.
 *
 * Nothing here re-derives game rules: the legal set, the phase, the alive
 * seats and the role reveal all come from the server projection verbatim.
 */

export type UiPhase = "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE" | "END";
export type UiRole = "WOLF" | "SEER" | "VILLAGER";
export type UiTeam = "WOLF" | "TOWN";
export type UiSessionStatus = "active" | "finished" | "aborted" | "abandoned";

/** docs/game-api-protocol.md: the public wire id of the shipped definition. */
export const PUBLIC_GAME_DEFINITION_ID = "quick6-v1";

export interface UiElimination {
  readonly round: number;
  readonly kind: "NIGHT_KILL" | "DAY_EXILE";
  readonly seat: number;
}

export interface UiSpeech {
  readonly round: number;
  readonly seat: number;
  readonly text: string | null;
}

export interface UiVote {
  readonly round: number;
  readonly seat: number;
  readonly target: number;
}

export interface UiSeerCheck {
  readonly round: number;
  readonly target: number;
  readonly isWolf: boolean;
}

export interface UiOutcome {
  readonly winner: UiTeam;
  readonly reason: "WOLVES_EXTERMINATED" | "WOLVES_MAJORITY";
}

/** The public facts every authorized view carries (§7 visibility). */
export interface UiPublicFacts {
  readonly phase: UiPhase;
  readonly round: number;
  readonly seats: readonly number[];
  readonly aliveSeats: readonly number[];
  readonly humanSeat: number;
  readonly eliminations: readonly UiElimination[];
  readonly speeches: readonly UiSpeech[];
  readonly votes: readonly UiVote[];
  readonly outcome: UiOutcome | null;
  /** Present only at END; null before that (离场不揭示身份). */
  readonly rolesRevealed: readonly UiRole[] | null;
}

/** The own-seat view (PLAYER / TEAM_WOLVES) — the owner's private facts. */
export interface UiSeatView extends UiPublicFacts {
  readonly scope: "PLAYER" | "TEAM_WOLVES";
  readonly seat: number;
  readonly ownRole: UiRole;
  readonly wolfTeammates: readonly number[];
  readonly seerChecks: readonly UiSeerCheck[];
  readonly ownNightSubmission: { readonly target: number } | null;
}

/** PUBLIC / POST_GAME — public facts only (dead players and the reveal). */
export interface UiPublicView extends UiPublicFacts {
  readonly scope: "PUBLIC" | "POST_GAME";
}

export type UiProjectView = UiSeatView | UiPublicView;

export type UiEvent =
  | { readonly type: "PHASE"; readonly round: number; readonly phase: UiPhase }
  | { readonly type: "ELIMINATION"; readonly record: UiElimination }
  | { readonly type: "SPEECH"; readonly record: UiSpeech }
  | { readonly type: "VOTE"; readonly record: UiVote }
  | { readonly type: "GAME_OVER"; readonly winner: UiTeam; readonly reason: UiOutcome["reason"] };

export interface UiLegalAction {
  readonly id: string;
  readonly label: string;
}

/** The session envelope exactly as docs/game-api-protocol.md defines it. */
export interface UiEnvelope {
  readonly sessionId: string;
  readonly gameDefinitionId: string;
  readonly status: UiSessionStatus;
  readonly revision: number;
  readonly phaseToken: string;
  readonly projectView: UiProjectView;
  readonly legalActions: readonly UiLegalAction[];
  readonly increments: readonly UiEvent[];
  readonly pending: boolean;
  readonly retryAfterMs: number;
}

/** The action response adds the idempotency receipt flag. */
export interface UiActionEnvelope extends UiEnvelope {
  readonly applied: boolean;
}

/** One row of GET /api/games/sessions (the lobby list). */
export interface UiSessionSummary {
  readonly sessionId: string;
  readonly gameDefinitionId: string;
  readonly title: string;
  readonly status: UiSessionStatus;
  readonly revision: number;
  readonly phaseToken: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Whitelist readers — every value is checked, nothing is passed through
// ---------------------------------------------------------------------------

const PHASES: readonly string[] = ["NIGHT", "DAY_DISCUSSION", "DAY_VOTE", "END"];
const ROLES: readonly string[] = ["WOLF", "SEER", "VILLAGER"];
const STATUSES: readonly string[] = ["active", "finished", "aborted", "abandoned"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asPhase(value: unknown): UiPhase {
  return typeof value === "string" && PHASES.includes(value) ? (value as UiPhase) : "END";
}

function asRole(value: unknown): UiRole | null {
  return typeof value === "string" && ROLES.includes(value) ? (value as UiRole) : null;
}

function asStatus(value: unknown): UiSessionStatus {
  return typeof value === "string" && STATUSES.includes(value)
    ? (value as UiSessionStatus)
    : "active";
}

function asSeatList(value: unknown): number[] {
  return asArray(value).filter((seat): seat is number => typeof seat === "number");
}

function asElimination(value: unknown): UiElimination | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kind = record.kind;
  if (kind !== "NIGHT_KILL" && kind !== "DAY_EXILE") return null;
  return { round: asInt(record.round), kind, seat: asInt(record.seat) };
}

function asSpeech(value: unknown): UiSpeech | null {
  const record = asRecord(value);
  if (record === null) return null;
  return {
    round: asInt(record.round),
    seat: asInt(record.seat),
    text: typeof record.text === "string" ? record.text : null,
  };
}

function asVote(value: unknown): UiVote | null {
  const record = asRecord(value);
  if (record === null) return null;
  return { round: asInt(record.round), seat: asInt(record.seat), target: asInt(record.target) };
}

function asSeerCheck(value: unknown): UiSeerCheck | null {
  const record = asRecord(value);
  if (record === null) return null;
  return { round: asInt(record.round), target: asInt(record.target), isWolf: asBool(record.isWolf) };
}

function asOutcome(value: unknown): UiOutcome | null {
  const record = asRecord(value);
  if (record === null) return null;
  const winner = record.winner;
  const reason = record.reason;
  if (winner !== "WOLF" && winner !== "TOWN") return null;
  if (reason !== "WOLVES_EXTERMINATED" && reason !== "WOLVES_MAJORITY") return null;
  return { winner, reason };
}

function asRolesRevealed(value: unknown): UiRole[] | null {
  if (!Array.isArray(value)) return null;
  const roles: UiRole[] = [];
  for (const entry of value) {
    const role = asRole(entry);
    if (role === null) return null;
    roles.push(role);
  }
  return roles;
}

/**
 * Read one projected view. The scope decides which private fields are even
 * looked at: a PUBLIC projection has no `ownRole`, and the reader must not
 * invent one (that is what makes a dead player's spectate view safe).
 */
export function readProjectView(raw: unknown): UiProjectView {
  const record = asRecord(raw) ?? {};
  const facts: UiPublicFacts = {
    phase: asPhase(record.phase),
    round: asInt(record.round, 1),
    seats: asSeatList(record.seats),
    aliveSeats: asSeatList(record.aliveSeats),
    humanSeat: asInt(record.humanSeat),
    eliminations: asArray(record.eliminations)
      .map(asElimination)
      .filter((entry): entry is UiElimination => entry !== null),
    speeches: asArray(record.speeches)
      .map(asSpeech)
      .filter((entry): entry is UiSpeech => entry !== null),
    votes: asArray(record.votes).map(asVote).filter((entry): entry is UiVote => entry !== null),
    outcome: asOutcome(record.outcome),
    rolesRevealed: asRolesRevealed(record.rolesRevealed),
  };
  if (record.scope === "PLAYER" || record.scope === "TEAM_WOLVES") {
    const ownRole = asRole(record.ownRole);
    // A seat-scoped view without an own role is not a view we can render as
    // one: fall back to treating it as public rather than showing a blank
    // identity card.
    if (ownRole !== null) {
      const submission = asRecord(record.ownNightSubmission);
      return {
        ...facts,
        scope: record.scope,
        seat: asInt(record.seat, facts.humanSeat),
        ownRole,
        wolfTeammates: asSeatList(record.wolfTeammates),
        seerChecks: asArray(record.seerChecks)
          .map(asSeerCheck)
          .filter((entry): entry is UiSeerCheck => entry !== null),
        ownNightSubmission:
          submission !== null ? { target: asInt(submission.target) } : null,
      };
    }
  }
  return { ...facts, scope: record.scope === "PUBLIC" ? "PUBLIC" : "POST_GAME" };
}

/** Read one public event payload inside `increments`. */
export function readEvent(raw: unknown): UiEvent | null {
  const record = asRecord(raw);
  if (record === null) return null;
  switch (record.type) {
    case "PHASE": {
      // An event whose phase is not one of the four generalized names is not
      // a public event we may render — dropped, never guessed at.
      if (typeof record.phase !== "string" || !PHASES.includes(record.phase)) return null;
      return { type: "PHASE", round: asInt(record.round, 1), phase: record.phase as UiPhase };
    }
    case "ELIMINATION": {
      const elimination = asElimination(record.record);
      return elimination === null ? null : { type: "ELIMINATION", record: elimination };
    }
    case "SPEECH": {
      const speech = asSpeech(record.record);
      return speech === null ? null : { type: "SPEECH", record: speech };
    }
    case "VOTE": {
      const vote = asVote(record.record);
      return vote === null ? null : { type: "VOTE", record: vote };
    }
    case "GAME_OVER": {
      const winner = record.winner;
      const reason = record.reason;
      if (winner !== "WOLF" && winner !== "TOWN") return null;
      if (reason !== "WOLVES_EXTERMINATED" && reason !== "WOLVES_MAJORITY") return null;
      return { type: "GAME_OVER", winner, reason };
    }
    default:
      return null;
  }
}

export function readLegalActions(raw: unknown): UiLegalAction[] {
  const actions: UiLegalAction[] = [];
  for (const entry of asArray(raw)) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = record.id;
    const label = record.label;
    if (typeof id !== "string" || id.length === 0) continue;
    actions.push({ id, label: typeof label === "string" ? label : id });
  }
  return actions;
}

/** Read a full session envelope (a view, an action response or an advance). */
export function readEnvelope(raw: unknown): UiEnvelope {
  const record = asRecord(raw) ?? {};
  return {
    sessionId: asString(record.sessionId),
    gameDefinitionId: asString(record.gameDefinitionId, PUBLIC_GAME_DEFINITION_ID),
    status: asStatus(record.status),
    revision: asInt(record.revision),
    phaseToken: asString(record.phaseToken),
    projectView: readProjectView(record.projectView),
    legalActions: readLegalActions(record.legalActions),
    increments: asArray(record.increments)
      .map(readEvent)
      .filter((event): event is UiEvent => event !== null),
    pending: asBool(record.pending),
    retryAfterMs: asInt(record.retryAfterMs),
  };
}

export function readActionEnvelope(raw: unknown): UiActionEnvelope {
  return { ...readEnvelope(raw), applied: asBool(asRecord(raw)?.applied) };
}

export function readSessionList(raw: unknown): UiSessionSummary[] {
  const record = asRecord(raw);
  const sessions: UiSessionSummary[] = [];
  for (const entry of asArray(record?.sessions)) {
    const item = asRecord(entry);
    if (item === null) continue;
    const sessionId = asString(item.sessionId);
    if (sessionId === "") continue;
    sessions.push({
      sessionId,
      gameDefinitionId: asString(item.gameDefinitionId, PUBLIC_GAME_DEFINITION_ID),
      title: asString(item.title),
      status: asStatus(item.status),
      revision: asInt(item.revision),
      phaseToken: asString(item.phaseToken),
      createdAt: asString(item.createdAt),
      updatedAt: asString(item.updatedAt),
    });
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// Derived facts the UI is allowed to state
// ---------------------------------------------------------------------------

/** The own seat's projection when the response carried one, else null. */
export function seatViewOf(view: UiProjectView): UiSeatView | null {
  return view.scope === "PLAYER" || view.scope === "TEAM_WOLVES" ? view : null;
}

export function isTerminalStatus(status: UiSessionStatus): boolean {
  return status === "finished" || status === "aborted" || status === "abandoned";
}

