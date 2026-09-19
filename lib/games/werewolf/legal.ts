/**
 * The legal-choice vocabulary of quick6-v1: every legal command maps onto
 * exactly one stable choice id, and every choice id maps back onto exactly
 * one command. The predicate helpers here are the single source of rule
 * truth — both {@link legalChoices} and the transition validation in
 * definition.ts are built on them, so they can never drift apart.
 *
 * Choice ids:
 *   wolf-kill@<seat>:<target>     — living wolf, living non-wolf target
 *   seer-check@<seat>:<target>    — living seer, living non-self target
 *   speech@<seat> / skip@<seat>   — current speaker in seat order
 *   day-vote@<seat>:<target>      — living voter, living non-self target
 *   finish-night / finish-discussion / finish-vote — system settlement
 */
import type { LegalChoice } from "@/lib/games/core";
import { ALL_SEATS, SEAT_COUNT } from "./types";
import type { Quick6Command, Quick6State, SeatId } from "./types";

// ---------------------------------------------------------------------------
// Basic predicates (single source of truth)
// ---------------------------------------------------------------------------

export function isSeatId(value: unknown): value is SeatId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SEAT_COUNT;
}

export function isAlive(state: Quick6State, seat: SeatId): boolean {
  return state.alive[seat] === true;
}

/** §3: a wolf-kill target must be alive and not a wolf (never self). */
export function isLegalWolfTarget(state: Quick6State, wolf: SeatId, target: SeatId): boolean {
  return (
    isAlive(state, target) &&
    target !== wolf &&
    state.roles[target] !== "WOLF"
  );
}

/** §3: a seer-check target must be alive and not the seer themself. */
export function isLegalSeerTarget(state: Quick6State, seer: SeatId, target: SeatId): boolean {
  return isAlive(state, target) && target !== seer;
}

/** §4: a vote target must be alive and not the voter themself. */
export function isLegalVoteTarget(state: Quick6State, voter: SeatId, target: SeatId): boolean {
  return isAlive(state, target) && target !== voter;
}

export function hasWolves(state: Quick6State): boolean {
  return ALL_SEATS.some((s) => isAlive(state, s) && state.roles[s] === "WOLF");
}

/** Living seats that still owe a night submission (wolves then seer). */
export function pendingNightSeats(state: Quick6State): SeatId[] {
  if (state.phase !== "NIGHT") return [];
  const pending: SeatId[] = [];
  for (const s of ALL_SEATS) {
    if (!isAlive(state, s)) continue;
    if (state.roles[s] === "WOLF" && state.nightWolfKills[s] === null) pending.push(s);
  }
  const seer = ALL_SEATS.find((s) => isAlive(state, s) && state.roles[s] === "SEER");
  if (seer !== undefined && !state.seerSubmitted) pending.push(seer);
  return pending;
}

/** Smallest living seat that has not spoken this round, or null. */
export function nextSpeaker(state: Quick6State): SeatId | null {
  if (state.phase !== "DAY_DISCUSSION") return null;
  const spoken = new Set(
    state.speeches.filter((s) => s.round === state.round).map((s) => s.seat),
  );
  return ALL_SEATS.find((s) => isAlive(state, s) && !spoken.has(s)) ?? null;
}

/** Living seats that still owe a vote this round. */
export function pendingVoters(state: Quick6State): SeatId[] {
  if (state.phase !== "DAY_VOTE") return [];
  const voted = new Set(
    state.votes.filter((v) => v.round === state.round).map((v) => v.seat),
  );
  return ALL_SEATS.filter((s) => isAlive(state, s) && !voted.has(s));
}

// ---------------------------------------------------------------------------
// Choice ids
// ---------------------------------------------------------------------------

export function choiceIdOf(command: Quick6Command): string | null {
  switch (command.type) {
    case "SUBMIT_WOLF_KILL":
      return isSeatId(command.seat) && isSeatId(command.target)
        ? `wolf-kill@${command.seat}:${command.target}`
        : null;
    case "SUBMIT_SEER_CHECK":
      return isSeatId(command.seat) && isSeatId(command.target)
        ? `seer-check@${command.seat}:${command.target}`
        : null;
    case "SUBMIT_SPEECH":
      return isSeatId(command.seat)
        ? command.text === null
          ? `skip@${command.seat}`
          : typeof command.text === "string"
            ? `speech@${command.seat}`
            : null
        : null;
    case "SUBMIT_DAY_VOTE":
      return isSeatId(command.seat) && isSeatId(command.target)
        ? `day-vote@${command.seat}:${command.target}`
        : null;
    case "FINISH_NIGHT":
      return "finish-night";
    case "FINISH_DISCUSSION":
      return "finish-discussion";
    case "FINISH_VOTE":
      return "finish-vote";
  }
}

/** Inverse of {@link choiceIdOf} for non-speech ids (bots build commands from ids). */
export function parseChoiceId(id: string): Quick6Command | null {
  const seatTarget = /^(wolf-kill|seer-check|day-vote)@(\d+):(\d+)$/.exec(id);
  if (seatTarget) {
    const [, kind, seatStr, targetStr] = seatTarget;
    const seat = Number(seatStr);
    const target = Number(targetStr);
    if (!isSeatId(seat) || !isSeatId(target)) return null;
    if (kind === "wolf-kill") return { type: "SUBMIT_WOLF_KILL", seat, target };
    if (kind === "seer-check") return { type: "SUBMIT_SEER_CHECK", seat, target };
    return { type: "SUBMIT_DAY_VOTE", seat, target };
  }
  const skip = /^skip@(\d+)$/.exec(id);
  if (skip) {
    const seat = Number(skip[1]);
    return isSeatId(seat) ? { type: "SUBMIT_SPEECH", seat, text: null } : null;
  }
  // speech@ carries free text content: the inverse maps to a placeholder
  // text; callers (bots) replace it with their own scripted line.
  const speech = /^speech@(\d+)$/.exec(id);
  if (speech) {
    const seat = Number(speech[1]);
    return isSeatId(seat) ? { type: "SUBMIT_SPEECH", seat, text: "" } : null;
  }
  switch (id) {
    case "finish-night":
      return { type: "FINISH_NIGHT" };
    case "finish-discussion":
      return { type: "FINISH_DISCUSSION" };
    case "finish-vote":
      return { type: "FINISH_VOTE" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The legal choice set for a state
// ---------------------------------------------------------------------------

export function legalChoices(state: Quick6State): readonly LegalChoice[] {
  const choices: LegalChoice[] = [];
  if (state.phase === "END") return choices; // terminal absorbs everything

  if (state.phase === "NIGHT") {
    for (const seat of ALL_SEATS) {
      if (!isAlive(state, seat)) continue;
      if (state.roles[seat] === "WOLF" && state.nightWolfKills[seat] === null) {
        for (const target of ALL_SEATS) {
          if (isLegalWolfTarget(state, seat, target)) {
            choices.push({
              id: `wolf-kill@${seat}:${target}`,
              seat,
              label: `狼人 ${seat} 刀 ${target}`,
            });
          }
        }
      }
      if (state.roles[seat] === "SEER" && !state.seerSubmitted) {
        for (const target of ALL_SEATS) {
          if (isLegalSeerTarget(state, seat, target)) {
            choices.push({
              id: `seer-check@${seat}:${target}`,
              seat,
              label: `预言家 ${seat} 查验 ${target}`,
            });
          }
        }
      }
    }
    if (pendingNightSeats(state).length === 0) {
      choices.push({ id: "finish-night", seat: null, label: "夜间结算" });
    }
  } else if (state.phase === "DAY_DISCUSSION") {
    const speaker = nextSpeaker(state);
    if (speaker !== null) {
      choices.push({ id: `speech@${speaker}`, seat: speaker, label: `座位 ${speaker} 发言` });
      choices.push({ id: `skip@${speaker}`, seat: speaker, label: `座位 ${speaker} 跳过` });
    } else {
      choices.push({ id: "finish-discussion", seat: null, label: "结束发言" });
    }
  } else if (state.phase === "DAY_VOTE") {
    for (const voter of ALL_SEATS) {
      if (!isAlive(state, voter)) continue;
      const alreadyVoted = state.votes.some(
        (v) => v.round === state.round && v.seat === voter,
      );
      if (alreadyVoted) continue;
      for (const target of ALL_SEATS) {
        if (isLegalVoteTarget(state, voter, target)) {
          choices.push({
            id: `day-vote@${voter}:${target}`,
            seat: voter,
            label: `座位 ${voter} 投 ${target}`,
          });
        }
      }
    }
    if (pendingVoters(state).length === 0) {
      choices.push({ id: "finish-vote", seat: null, label: "结束投票" });
    }
  }
  return choices;
}

/** Seats that currently have at least one legal choice. */
export function actors(state: Quick6State): readonly SeatId[] {
  if (state.phase === "END") return [];
  const seats = new Set<SeatId>();
  for (const choice of legalChoices(state)) {
    if (choice.seat !== null) seats.add(choice.seat);
  }
  return [...seats];
}

/** The system settlement command legal right now, or null. */
export function systemCommand(state: Quick6State): Quick6Command | null {
  if (state.phase === "END") return null;
  if (state.phase === "NIGHT" && pendingNightSeats(state).length === 0) {
    return { type: "FINISH_NIGHT" };
  }
  if (state.phase === "DAY_DISCUSSION" && nextSpeaker(state) === null) {
    return { type: "FINISH_DISCUSSION" };
  }
  if (state.phase === "DAY_VOTE" && pendingVoters(state).length === 0) {
    return { type: "FINISH_VOTE" };
  }
  return null;
}

/** Stable phase token for RNG domain separation, e.g. `night:2`. */
export function phaseToken(state: Quick6State): string {
  switch (state.phase) {
    case "NIGHT":
      return `night:${state.round}`;
    case "DAY_DISCUSSION":
      return `discussion:${state.round}`;
    case "DAY_VOTE":
      return `vote:${state.round}`;
    case "END":
      return "end";
  }
}
