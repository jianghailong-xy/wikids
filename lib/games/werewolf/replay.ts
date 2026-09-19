/**
 * Deterministic event-stream replay for quick6-v1 (docs/quick6-v1-rules.md
 * §9 可重放性): from (seedBytes, options, event stream) rebuild the state.
 *
 * The engine appends events with contiguous indexes (`events[i].index === i`)
 * and the revision that produced them; replay is the inverse direction: it
 * folds the PUBLIC event stream forward from the initial state, enforcing
 * the full legality of the stream — so a replayed state can only ever be one
 * a real game could have reached.
 *
 * Replay contract:
 * - The same (seedBytes, options, event stream) always yields the same state
 *   (byte-for-byte determinism; the stream is re-folded, never trusted as a
 *   state).
 * - Any prefix of a legal stream replays without error.
 * - The replayed state matches the live state on every field derivable from
 *   (seedBytes, options, events): roles (seeded deal), alive, eliminations,
 *   speeches, votes, round, phase, outcome, revision, steps (steps ≡ revision).
 * - The ONLY live field a public event stream cannot reconstruct is
 *   `seerChecks` (§7: the check history is private to the seer and never
 *   enters events) — replayed states carry `[]`. Consequently replayed
 *   states are read-only projections: they must not be dispatched (night
 *   buffers are likewise unreconstructable mid-night).
 * - Corrupted, duplicate, gapped, out-of-order or rule-inconsistent events
 *   are rejected explicitly with a granular {@link ReplayError} code.
 *
 * Replay is server-side; client views of a replayed state go through
 * {@link projectView} exactly like live views.
 */
import { deepFreeze } from "@/lib/games/core";
import { Quick6Definition } from "./definition";
import { isAlive, isSeatId, nextSpeaker } from "./legal";
import { ALL_PHASES, ALL_SEATS } from "./types";
import type {
  ExternalPhase,
  GameOutcome,
  Quick6Event,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  Role,
  SeatId,
} from "./types";

export type ReplayErrorCode =
  /** The stream has no events (every legal stream starts with the initial PHASE event). */
  | "EMPTY_EVENT_STREAM"
  /** An event's index is not its position: duplicate, gap or reorder. */
  | "NON_CONTIGUOUS_INDEX"
  /** An event revision is not a non-negative, non-decreasing integer. */
  | "INVALID_REVISION"
  /** The payload is missing, wrong-typed or its fields are out of range. */
  | "MALFORMED_PAYLOAD"
  /** The payload type is a string but not a known quick6 event type. */
  | "UNKNOWN_EVENT_TYPE"
  /** The first event is not the canonical initial event (PHASE round 1 NIGHT, revision 0). */
  | "FIRST_EVENT_MISMATCH"
  /** The event cannot legally follow the state reached so far. */
  | "ILLEGAL_TRANSITION"
  /** GAME_OVER / continued play contradicts the §5 win table. */
  | "INCONSISTENT_OUTCOME";

export class ReplayError extends Error {
  readonly code: ReplayErrorCode;
  readonly eventIndex: number | null;
  constructor(code: ReplayErrorCode, message: string, eventIndex: number | null = null) {
    super(`event replay rejected (${code}${eventIndex === null ? "" : ` @${eventIndex}`}): ${message}`);
    this.name = "ReplayError";
    this.code = code;
    this.eventIndex = eventIndex;
  }
}

/** §5 win table, evaluated at any point of the replay (mirrors the definition). */
function checkWin(roles: readonly Role[], alive: readonly boolean[]): GameOutcome | null {
  let livingWolves = 0;
  let livingOthers = 0;
  for (const s of ALL_SEATS) {
    if (!alive[s]) continue;
    if (roles[s] === "WOLF") livingWolves += 1;
    else livingOthers += 1;
  }
  if (livingWolves === 0) return { winner: "TOWN", reason: "WOLVES_EXTERMINATED" };
  if (livingWolves >= livingOthers) return { winner: "WOLF", reason: "WOLVES_MAJORITY" };
  return null;
}

/** Unique top-voted seat of the current round, or null on a tie / no votes. */
function uniqueTopVote(state: Quick6State): SeatId | null {
  const tally = new Map<SeatId, number>();
  for (const v of state.votes) {
    if (v.round !== state.round) continue;
    tally.set(v.target, (tally.get(v.target) ?? 0) + 1);
  }
  const counts = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (counts.length === 0) return null;
  if (counts.length > 1 && counts[1][1] === counts[0][1]) return null;
  return counts[0][0];
}

function fail(code: ReplayErrorCode, message: string, index: number): never {
  throw new ReplayError(code, message, index);
}

function validatePayloadSchema(payload: unknown, index: number): Quick6EventPayload {
  if (typeof payload !== "object" || payload === null) {
    fail("MALFORMED_PAYLOAD", "payload must be an object", index);
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== "string") fail("MALFORMED_PAYLOAD", "payload.type must be a string", index);
  switch (p.type) {
    case "PHASE": {
      const round = p.round;
      const phase = p.phase;
      if (!Number.isInteger(round) || (round as number) < 1) {
        fail("MALFORMED_PAYLOAD", `PHASE round must be an integer >= 1, got ${String(round)}`, index);
      }
      if (!ALL_PHASES.includes(phase as ExternalPhase)) {
        fail("MALFORMED_PAYLOAD", `PHASE phase must be one of ${ALL_PHASES.join("/")}, got ${String(phase)}`, index);
      }
      return { type: "PHASE", round: round as number, phase: phase as ExternalPhase };
    }
    case "ELIMINATION": {
      const record = p.record as Record<string, unknown>;
      if (typeof record !== "object" || record === null) {
        fail("MALFORMED_PAYLOAD", "ELIMINATION record must be an object", index);
      }
      if (!Number.isInteger(record.round) || (record.round as number) < 1) {
        fail("MALFORMED_PAYLOAD", "ELIMINATION record.round must be an integer >= 1", index);
      }
      if (record.kind !== "NIGHT_KILL" && record.kind !== "DAY_EXILE") {
        fail("MALFORMED_PAYLOAD", `unknown elimination kind: ${String(record.kind)}`, index);
      }
      if (!isSeatId(record.seat)) {
        fail("MALFORMED_PAYLOAD", `eliminated seat out of range: ${String(record.seat)}`, index);
      }
      return {
        type: "ELIMINATION",
        record: { round: record.round as number, kind: record.kind, seat: record.seat as SeatId },
      };
    }
    case "SPEECH": {
      const record = p.record as Record<string, unknown>;
      if (typeof record !== "object" || record === null) {
        fail("MALFORMED_PAYLOAD", "SPEECH record must be an object", index);
      }
      if (!Number.isInteger(record.round) || (record.round as number) < 1) {
        fail("MALFORMED_PAYLOAD", "SPEECH record.round must be an integer >= 1", index);
      }
      if (!isSeatId(record.seat)) fail("MALFORMED_PAYLOAD", `speaker out of range: ${String(record.seat)}`, index);
      if (record.text !== null && typeof record.text !== "string") {
        fail("MALFORMED_PAYLOAD", "SPEECH text must be a string or null", index);
      }
      return { type: "SPEECH", record: { round: record.round as number, seat: record.seat as SeatId, text: record.text } };
    }
    case "VOTE": {
      const record = p.record as Record<string, unknown>;
      if (typeof record !== "object" || record === null) {
        fail("MALFORMED_PAYLOAD", "VOTE record must be an object", index);
      }
      if (!Number.isInteger(record.round) || (record.round as number) < 1) {
        fail("MALFORMED_PAYLOAD", "VOTE record.round must be an integer >= 1", index);
      }
      if (!isSeatId(record.seat)) fail("MALFORMED_PAYLOAD", `voter out of range: ${String(record.seat)}`, index);
      if (!isSeatId(record.target)) fail("MALFORMED_PAYLOAD", `vote target out of range: ${String(record.target)}`, index);
      return {
        type: "VOTE",
        record: { round: record.round as number, seat: record.seat as SeatId, target: record.target as SeatId },
      };
    }
    case "GAME_OVER": {
      const winner = p.winner;
      const reason = p.reason;
      if (winner !== "TOWN" && winner !== "WOLF") {
        fail("MALFORMED_PAYLOAD", `unknown winner: ${String(winner)}`, index);
      }
      if (reason !== "WOLVES_EXTERMINATED" && reason !== "WOLVES_MAJORITY") {
        fail("MALFORMED_PAYLOAD", `unknown reason: ${String(reason)}`, index);
      }
      return { type: "GAME_OVER", winner, reason };
    }
    default:
      fail("UNKNOWN_EVENT_TYPE", `unknown event type: ${String(p.type)}`, index);
  }
}

/**
 * Rebuild the state reached after `events` from the seeded initial state.
 *
 * @param seedBytes  the same seed bytes the game was created with.
 * @param events     the engine-produced event log (any prefix is legal input).
 * @param options    the same start options the game was created with
 *                   (e.g. explicit role table fixtures).
 * @throws ReplayError on any corrupted / duplicate / gapped / out-of-order /
 *         rule-inconsistent event.
 */
export function replayQuick6(
  seedBytes: Uint8Array,
  events: readonly Quick6Event[],
  options?: Quick6StartOptions,
): Quick6State {
  if (events.length === 0) {
    throw new ReplayError("EMPTY_EVENT_STREAM", "every legal event stream starts with the initial PHASE event");
  }
  // Contiguity + revision bookkeeping, before any event is applied.
  let prevRevision = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.index !== i) {
      throw new ReplayError(
        "NON_CONTIGUOUS_INDEX",
        `expected index ${i}, got ${event.index} (duplicate, gap or reorder)`,
        i,
      );
    }
    if (!Number.isInteger(event.revision) || event.revision < 0 || event.revision < prevRevision) {
      throw new ReplayError(
        "INVALID_REVISION",
        `revision must be a non-decreasing integer >= 0, got ${String(event.revision)} after ${prevRevision}`,
        i,
      );
    }
    prevRevision = event.revision;
  }

  const definition = new Quick6Definition();
  const initial = definition.initialState(seedBytes, options);
  const canonicalFirst = initial.events[0];
  const first = events[0];
  if (
    first.index !== canonicalFirst.index ||
    first.revision !== canonicalFirst.revision ||
    first.payload.type !== "PHASE" ||
    first.payload.round !== 1 ||
    first.payload.phase !== "NIGHT"
  ) {
    throw new ReplayError(
      "FIRST_EVENT_MISMATCH",
      "the first event must be the canonical initial event { index: 0, revision: 0, PHASE round 1 NIGHT }",
      0,
    );
  }

  // Fold forward from the initial state; the canonical event 0 is re-provided
  // by the input stream. seerChecks stays [] (unreconstructable, §7) and the
  // night buffers stay neutral — replayed states are read-only projections.
  let state: Quick6State = { ...initial, events: [] };
  let eliminatedSeatInBatch: SeatId | null = null;
  for (const event of events) {
    const payload = validatePayloadSchema(event.payload, event.index);
    // Event 0 is the canonical initial PHASE event: the initial state already
    // sits at round 1 NIGHT, so it is validated (schema + first-event pin)
    // and appended, but not re-applied.
    const next: { state: Quick6State; eliminatedSeatInBatch: SeatId | null } =
      event.index === 0
        ? { state, eliminatedSeatInBatch }
        : applyEvent(state, payload, eliminatedSeatInBatch, event.index);
    state = { ...next.state, events: [...state.events, event] };
    eliminatedSeatInBatch = next.eliminatedSeatInBatch;
  }

  const finalRevision = events[events.length - 1].revision;
  return deepFreeze({
    ...state,
    revision: finalRevision,
    steps: finalRevision, // steps ≡ revision: one accepted transition per revision
  });
}

/** The state after one event, plus the batch-local elimination tracking. */
function applyEvent(
  state: Quick6State,
  payload: Quick6EventPayload,
  eliminatedSeatInBatch: SeatId | null,
  index: number,
): { state: Quick6State; eliminatedSeatInBatch: SeatId | null } {
  switch (payload.type) {
    case "PHASE":
      return { state: applyPhase(state, payload, eliminatedSeatInBatch, index), eliminatedSeatInBatch: null };
    case "ELIMINATION":
      return {
        state: applyElimination(state, payload, eliminatedSeatInBatch, index),
        eliminatedSeatInBatch: payload.record.seat,
      };
    case "SPEECH":
      return { state: applySpeech(state, payload, index), eliminatedSeatInBatch };
    case "VOTE":
      return { state: applyVote(state, payload, index), eliminatedSeatInBatch };
    case "GAME_OVER":
      return { state: applyGameOver(state, payload, index), eliminatedSeatInBatch };
  }
}

function applyPhase(
  state: Quick6State,
  payload: Extract<Quick6EventPayload, { type: "PHASE" }>,
  eliminatedSeatInBatch: SeatId | null,
  index: number,
): Quick6State {
  const { round, phase: next } = payload;

  // The win table (§5) is decisive: once the position is decisive the game
  // must end, and once GAME_OVER has been seen only PHASE END may follow.
  if (state.outcome !== null) {
    if (next !== "END") {
      fail("ILLEGAL_TRANSITION", "GAME_OVER must be followed by PHASE END", index);
    }
  } else if (next === "END") {
    fail("INCONSISTENT_OUTCOME", "PHASE END requires a preceding GAME_OVER outcome", index);
  }

  let expectedNext: readonly ExternalPhase[];
  let expectedRound: number | null;
  switch (state.phase) {
    case "NIGHT":
      expectedNext = ["DAY_DISCUSSION", "END"];
      expectedRound = state.round;
      break;
    case "DAY_DISCUSSION":
      expectedNext = ["DAY_VOTE"];
      expectedRound = state.round;
      break;
    case "DAY_VOTE":
      expectedNext = ["NIGHT", "END"];
      expectedRound = next === "NIGHT" ? state.round + 1 : state.round;
      break;
    case "END":
      fail("ILLEGAL_TRANSITION", "no event may follow the END phase", index);
  }
  if (!expectedNext.includes(next)) {
    fail(
      "ILLEGAL_TRANSITION",
      `cannot move ${state.phase} -> ${next} (expected ${expectedNext.join(" or ")})`,
      index,
    );
  }
  if (round !== expectedRound) {
    fail("ILLEGAL_TRANSITION", `PHASE round ${round} does not match the expected round ${expectedRound}`, index);
  }

  // Settlement completeness against §3/§4.
  if (state.phase === "NIGHT" && eliminatedSeatInBatch === null) {
    fail("ILLEGAL_TRANSITION", "night settlement must eliminate exactly one seat (§3)", index);
  }
  if (state.phase === "DAY_VOTE") {
    const top = uniqueTopVote(state);
    if (top !== null && eliminatedSeatInBatch !== top) {
      fail("ILLEGAL_TRANSITION", `day settlement must exile the unique top-voted seat ${top}`, index);
    }
    if (top === null && eliminatedSeatInBatch !== null) {
      fail("ILLEGAL_TRANSITION", "a tied vote cannot exile anyone (§4)", index);
    }
  }

  // A non-END transition requires a still-undecided position (§5).
  if (next !== "END" && checkWin(state.roles, state.alive) !== null) {
    fail("INCONSISTENT_OUTCOME", "the win table is decisive here: the game must end", index);
  }

  return { ...state, phase: next, round };
}

function applyElimination(
  state: Quick6State,
  payload: Extract<Quick6EventPayload, { type: "ELIMINATION" }>,
  eliminatedSeatInBatch: SeatId | null,
  index: number,
): Quick6State {
  const { record } = payload;
  if (record.kind === "NIGHT_KILL" && state.phase !== "NIGHT") {
    fail("ILLEGAL_TRANSITION", "NIGHT_KILL can only settle a NIGHT phase", index);
  }
  if (record.kind === "DAY_EXILE" && state.phase !== "DAY_VOTE") {
    fail("ILLEGAL_TRANSITION", "DAY_EXILE can only settle a DAY_VOTE phase", index);
  }
  if (record.round !== state.round) {
    fail("ILLEGAL_TRANSITION", `elimination round ${record.round} does not match round ${state.round}`, index);
  }
  if (eliminatedSeatInBatch !== null) {
    fail("ILLEGAL_TRANSITION", "at most one elimination per settlement", index);
  }
  if (!isAlive(state, record.seat)) {
    fail("ILLEGAL_TRANSITION", `seat ${record.seat} is already dead`, index);
  }
  if (record.kind === "NIGHT_KILL" && state.roles[record.seat] === "WOLF") {
    fail("ILLEGAL_TRANSITION", "a wolf-kill victim must be a living non-wolf (§3)", index);
  }
  if (record.kind === "DAY_EXILE" && uniqueTopVote(state) !== record.seat) {
    fail("ILLEGAL_TRANSITION", "the exile must match the unique top-voted seat (§4)", index);
  }
  const alive = [...state.alive];
  alive[record.seat] = false;
  return {
    ...state,
    alive,
    eliminations: [...state.eliminations, record],
  };
}

function applySpeech(
  state: Quick6State,
  payload: Extract<Quick6EventPayload, { type: "SPEECH" }>,
  index: number,
): Quick6State {
  const { record } = payload;
  if (state.phase !== "DAY_DISCUSSION") {
    fail("ILLEGAL_TRANSITION", "speeches are only legal during DAY_DISCUSSION", index);
  }
  if (record.round !== state.round) {
    fail("ILLEGAL_TRANSITION", `speech round ${record.round} does not match round ${state.round}`, index);
  }
  if (!isAlive(state, record.seat)) {
    fail("ILLEGAL_TRANSITION", `speaker ${record.seat} is dead`, index);
  }
  const expectedSpeaker = nextSpeaker(state);
  if (record.seat !== expectedSpeaker) {
    fail(
      "ILLEGAL_TRANSITION",
      `speech out of seat order: expected seat ${String(expectedSpeaker)}, got ${record.seat}`,
      index,
    );
  }
  return { ...state, speeches: [...state.speeches, record] };
}

function applyVote(
  state: Quick6State,
  payload: Extract<Quick6EventPayload, { type: "VOTE" }>,
  index: number,
): Quick6State {
  const { record } = payload;
  if (state.phase !== "DAY_VOTE") {
    fail("ILLEGAL_TRANSITION", "votes are only legal during DAY_VOTE", index);
  }
  if (record.round !== state.round) {
    fail("ILLEGAL_TRANSITION", `vote round ${record.round} does not match round ${state.round}`, index);
  }
  if (!isAlive(state, record.seat)) {
    fail("ILLEGAL_TRANSITION", `voter ${record.seat} is dead`, index);
  }
  if (!isAlive(state, record.target)) {
    fail("ILLEGAL_TRANSITION", `vote target ${record.target} is dead`, index);
  }
  if (record.target === record.seat) {
    fail("ILLEGAL_TRANSITION", "self-voting is forbidden (§4)", index);
  }
  if (state.votes.some((v) => v.round === state.round && v.seat === record.seat)) {
    fail("ILLEGAL_TRANSITION", `seat ${record.seat} already voted this round`, index);
  }
  return { ...state, votes: [...state.votes, record] };
}

function applyGameOver(
  state: Quick6State,
  payload: Extract<Quick6EventPayload, { type: "GAME_OVER" }>,
  index: number,
): Quick6State {
  if (state.phase !== "NIGHT" && state.phase !== "DAY_VOTE") {
    fail("ILLEGAL_TRANSITION", "GAME_OVER can only settle a NIGHT or DAY_VOTE phase", index);
  }
  if (state.outcome !== null) {
    fail("ILLEGAL_TRANSITION", "duplicate GAME_OVER event", index);
  }
  const expected = checkWin(state.roles, state.alive);
  if (expected === null || expected.winner !== payload.winner || expected.reason !== payload.reason) {
    fail(
      "INCONSISTENT_OUTCOME",
      `GAME_OVER ${payload.winner}/${payload.reason} contradicts the §5 win table (${
        expected === null ? "position not decisive" : `${expected.winner}/${expected.reason}`
      })`,
      index,
    );
  }
  return { ...state, outcome: { winner: payload.winner, reason: payload.reason } };
}
