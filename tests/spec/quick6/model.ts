/**
 * quick6-v1 executable reference model (test-side only, NOT the production
 * engine). It turns every decision table in docs/quick6-v1-rules.md into
 * runnable assertions: legal targets, simultaneous night submission, the
 * versioned PRNG wolf-kill tiebreak, seat-ordered day speech, mandatory votes,
 * win checks after every elimination, no draws, abnormal step protection and
 * the randomness boundary.
 */
import type { Rng } from "@/tests/support/ports";
import { createVersionedRng, PRNG_DOMAINS } from "@/tests/support/prng";
import {
  ALL_SEATS,
  ROLE_MULTISET,
  SEAT_COUNT,
  type EliminationRecord,
  type ExternalPhase,
  type GameOutcome,
  type PublicEvent,
  type Role,
  type SeatId,
  type SeerCheckRecord,
  type SpeechRecord,
  type VoteRecord,
} from "./types";

export const DEFAULT_MAX_PHASE_STEPS = 200;

/** Abnormal protection: step limit hit. Tests must FAIL on this, never fake a draw. */
export class SpecAbortError extends Error {
  readonly reason = "TOO_MANY_STEPS" as const;
  constructor() {
    super("quick6 spec abort: phase step limit exceeded (abnormal protection; never a draw)");
    this.name = "SpecAbortError";
  }
}

/** Illegal input: rejected with state fully unchanged and no step counted. */
export class SpecInputError extends Error {
  constructor(message: string) {
    super(`quick6 spec input rejected: ${message}`);
    this.name = "SpecInputError";
  }
}

export interface SpecGameConfig {
  seedBytes: Uint8Array;
  /** Optional explicit role table for fixed-fixture scenarios (must be the §1 multiset). */
  roles?: readonly Role[];
  /** Human seat, default 0; the other five seats are AI. */
  humanSeat?: SeatId;
  /** Step cap for abnormal protection, default DEFAULT_MAX_PHASE_STEPS. */
  maxPhaseSteps?: number;
}

export class SpecGame {
  readonly humanSeat: SeatId;
  readonly roles: readonly Role[];
  readonly maxPhaseSteps: number;

  round = 1;
  phase: ExternalPhase = "NIGHT";
  steps = 0;
  alive: boolean[];
  readonly eliminations: EliminationRecord[] = [];
  readonly speeches: SpeechRecord[] = [];
  readonly dayVotes: VoteRecord[] = [];
  readonly seerChecks: SeerCheckRecord[] = [];
  readonly events: PublicEvent[] = [];
  outcome: GameOutcome | null = null;

  private readonly nightWolfKills = new Map<SeatId, SeatId>();
  private seerSubmitted = false;
  private nightSeerTarget: SeatId | null = null;
  private readonly tiebreakRng: Rng;

  constructor(config: SpecGameConfig) {
    this.humanSeat = config.humanSeat ?? 0;
    if (!ALL_SEATS.includes(this.humanSeat)) {
      throw new SpecInputError(`human seat out of range: ${this.humanSeat}`);
    }
    this.maxPhaseSteps = config.maxPhaseSteps ?? DEFAULT_MAX_PHASE_STEPS;
    if (this.maxPhaseSteps < 1) throw new SpecInputError("maxPhaseSteps must be >= 1");
    this.roles = config.roles ? [...config.roles] : this.dealRoles(config.seedBytes);
    const sorted = [...this.roles].sort().join(",");
    const expected = [...ROLE_MULTISET].sort().join(",");
    if (sorted !== expected) {
      throw new SpecInputError("roles must be exactly 2 wolves / 1 seer / 3 villagers");
    }
    this.alive = Array<boolean>(SEAT_COUNT).fill(true);
    this.tiebreakRng = createVersionedRng({
      seedBytes: config.seedBytes,
      domain: PRNG_DOMAINS.NIGHT_WOLF_TIEBREAK,
    });
    this.events.push({ type: "PHASE", round: this.round, phase: this.phase });
  }

  private dealRoles(seedBytes: Uint8Array): Role[] {
    const rng = createVersionedRng({ seedBytes, domain: PRNG_DOMAINS.DEAL });
    const deck = [...ROLE_MULTISET];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  livingSeats(): SeatId[] {
    return ALL_SEATS.filter((s) => this.alive[s]);
  }

  livingWolves(): SeatId[] {
    return this.livingSeats().filter((s) => this.roles[s] === "WOLF");
  }

  /** Smallest living seat that has not spoken this round, or null if none. */
  nextSpeaker(): SeatId | null {
    if (this.phase !== "DAY_DISCUSSION") return null;
    const spoken = new Set(
      this.speeches.filter((s) => s.round === this.round).map((s) => s.seat),
    );
    return this.livingSeats().find((s) => !spoken.has(s)) ?? null;
  }

  // ----- night -----

  submitWolfKill(seat: SeatId, target: SeatId): void {
    this.assertPhase("NIGHT");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(seat, "行动者已死亡");
    if (this.roles[seat] !== "WOLF") throw new SpecInputError("只有狼人能提交夜间目标");
    if (this.nightWolfKills.has(seat)) throw new SpecInputError("该狼人已提交夜间目标");
    this.assertAlive(target, "目标已死亡");
    if (target === seat) throw new SpecInputError("目标不能是自己");
    if (this.roles[target] === "WOLF") throw new SpecInputError("狼人目标必须是存活非狼");
    this.bump();
    this.nightWolfKills.set(seat, target);
  }

  submitSeerCheck(seat: SeatId, target: SeatId): void {
    this.assertPhase("NIGHT");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(seat, "行动者已死亡");
    if (this.roles[seat] !== "SEER") throw new SpecInputError("只有预言家能提交查验");
    if (this.seerSubmitted) throw new SpecInputError("预言家本夜已提交查验");
    this.assertAlive(target, "查验目标已死亡");
    if (target === seat) throw new SpecInputError("查验目标不能是自己");
    this.bump();
    this.seerSubmitted = true;
    this.nightSeerTarget = target;
  }

  /**
   * Simultaneous night resolution: the seer check is resolved FIRST and is
   * retained even if the seer dies this night; then the wolf kill victim is
   * picked (unanimous target, or versioned-PRNG tiebreak among the sorted
   * distinct targets — submission order never matters); death is applied and
   * announced by seat id only; then the win table runs.
   */
  finishNight(): void {
    this.assertPhase("NIGHT");
    const wolves = this.livingWolves();
    for (const w of wolves) {
      if (!this.nightWolfKills.has(w)) throw new SpecInputError("仍有存活狼人未提交夜间目标");
    }
    const seer = this.livingSeats().find((s) => this.roles[s] === "SEER");
    if (seer !== undefined && !this.seerSubmitted) {
      throw new SpecInputError("存活预言家未提交查验");
    }
    this.bump();

    if (this.seerSubmitted && seer !== undefined && this.nightSeerTarget !== null) {
      const target = this.nightSeerTarget;
      this.seerChecks.push({
        round: this.round,
        target,
        isWolf: this.roles[target] === "WOLF",
      });
    }

    const distinct = [...new Set(this.nightWolfKills.values())].sort((a, b) => a - b);
    let victim: SeatId | undefined;
    if (distinct.length === 1) victim = distinct[0];
    else if (distinct.length > 1) {
      victim = distinct[Math.floor(this.tiebreakRng.next() * distinct.length)];
    }

    if (victim !== undefined) {
      this.alive[victim] = false;
      const record: EliminationRecord = { round: this.round, kind: "NIGHT_KILL", seat: victim };
      this.eliminations.push(record);
      this.events.push({ type: "ELIMINATION", record });
    }

    this.checkWinAfterElimination();
    this.nightWolfKills.clear();
    this.seerSubmitted = false;
    this.nightSeerTarget = null;
    this.endOrTransition("DAY_DISCUSSION");
  }

  // ----- day -----

  submitSpeech(seat: SeatId, text: string | null): void {
    this.assertPhase("DAY_DISCUSSION");
    this.assertSeat(seat);
    this.assertAlive(seat, "行动者已死亡");
    const next = this.nextSpeaker();
    if (seat !== next) throw new SpecInputError(`发言必须按座位顺序：当前轮到座位 ${next}`);
    this.bump();
    const record: SpeechRecord = { round: this.round, seat, text };
    this.speeches.push(record);
    this.events.push({ type: "SPEECH", record });
  }

  finishDiscussion(): void {
    this.assertPhase("DAY_DISCUSSION");
    if (this.nextSpeaker() !== null) throw new SpecInputError("仍有存活玩家未发言");
    this.bump();
    this.phase = "DAY_VOTE";
    this.events.push({ type: "PHASE", round: this.round, phase: this.phase });
  }

  submitDayVote(seat: SeatId, target: SeatId): void {
    this.assertPhase("DAY_VOTE");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(seat, "行动者已死亡");
    if (this.dayVotes.some((v) => v.round === this.round && v.seat === seat)) {
      throw new SpecInputError("该玩家本轮已投票");
    }
    this.assertAlive(target, "投票目标已死亡");
    if (target === seat) throw new SpecInputError("不得自投");
    this.bump();
    const record: VoteRecord = { round: this.round, seat, target };
    this.dayVotes.push(record);
    this.events.push({ type: "VOTE", record });
  }

  /**
   * Day vote resolution: unique top count exiles exactly that seat; a tie
   * exiles nobody (no re-vote, no RNG). Exile is announced by seat id only,
   * then the win table runs; otherwise the next round starts at NIGHT.
   */
  finishVote(): void {
    this.assertPhase("DAY_VOTE");
    const voted = new Set(
      this.dayVotes.filter((v) => v.round === this.round).map((v) => v.seat),
    );
    if (this.livingSeats().some((s) => !voted.has(s))) {
      throw new SpecInputError("每名存活玩家必须投票（不得弃票）");
    }
    this.bump();

    const tally = new Map<SeatId, number>();
    for (const v of this.dayVotes) {
      if (v.round === this.round) tally.set(v.target, (tally.get(v.target) ?? 0) + 1);
    }
    const counts = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const uniqueTop = counts.length > 0 && (counts.length === 1 || counts[1][1] < counts[0][1]);
    if (uniqueTop) {
      const exiled = counts[0][0];
      this.alive[exiled] = false;
      const record: EliminationRecord = { round: this.round, kind: "DAY_EXILE", seat: exiled };
      this.eliminations.push(record);
      this.events.push({ type: "ELIMINATION", record });
    }

    this.checkWinAfterElimination();
    if (this.outcome === null) {
      this.round += 1;
      this.endOrTransition("NIGHT");
    } else {
      this.endOrTransition("END");
    }
  }

  // ----- win table -----

  /** Runs after every night kill and every day exile (even a tie day). */
  private checkWinAfterElimination(): void {
    const wolves = this.livingWolves().length;
    const others = this.livingSeats().length - wolves;
    if (wolves === 0) {
      this.outcome = { winner: "TOWN", reason: "WOLVES_EXTERMINATED" };
    } else if (wolves >= others) {
      this.outcome = { winner: "WOLF", reason: "WOLVES_MAJORITY" };
    }
  }

  /** END on outcome (with GAME_OVER event), otherwise the given next phase. */
  private endOrTransition(nextPhase: ExternalPhase): void {
    if (this.outcome !== null) {
      this.phase = "END";
      this.events.push({
        type: "GAME_OVER",
        winner: this.outcome.winner,
        reason: this.outcome.reason,
      });
    } else {
      this.phase = nextPhase;
    }
    this.events.push({ type: "PHASE", round: this.round, phase: this.phase });
  }

  // ----- guards -----

  /** Abnormal protection: the cap is a defect signal, never a draw. */
  private bump(): void {
    if (this.steps >= this.maxPhaseSteps) throw new SpecAbortError();
    this.steps += 1;
  }

  private assertPhase(expected: ExternalPhase): void {
    if (this.phase !== expected) {
      throw new SpecInputError(`阶段错误：当前 ${this.phase}，需要 ${expected}`);
    }
  }

  private assertSeat(seat: SeatId): void {
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) {
      throw new SpecInputError(`座位不存在：${seat}`);
    }
  }

  private assertAlive(seat: SeatId, message: string): void {
    if (!this.alive[seat]) throw new SpecInputError(message);
  }
}
