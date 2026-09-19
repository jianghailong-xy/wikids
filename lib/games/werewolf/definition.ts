/**
 * Quick6Definition: the production quick6-v1 rules engine, a strict
 * implementation of the frozen spec docs/quick6-v1-rules.md.
 *
 * Explicit phase state machine (§2):
 *
 *   NIGHT           — every living wolf submits one kill target; the living
 *                     seer submits one check. All submissions buffer first
 *                     (order never matters) → FINISH_NIGHT settles →
 *                     DAY_DISCUSSION or END.
 *   DAY_DISCUSSION  — living seats speak once, strictly in seat order
 *                     (explicit skip allowed) → FINISH_DISCUSSION → DAY_VOTE.
 *   DAY_VOTE        — every living seat votes for another living seat (no
 *                     self, no abstain); unique top count exiles, a tie
 *                     exiles nobody → FINISH_VOTE → next NIGHT or END.
 *   END             — terminal absorbing state: every action is rejected.
 *
 * Night settlement (§3): the seer check resolves FIRST and is retained even
 * if the seer dies this night; the wolf kill then applies — a unanimous
 * target directly, divergent targets via the versioned PRNG (purpose domain
 * night-wolf-tiebreak, one stream per round) over the sorted distinct
 * target set. Deaths are announced by seat id only, then the win table runs
 * after every elimination (§5): wolves 0 → TOWN; wolves ≥ others → WOLF;
 * otherwise continue. No draw exists.
 *
 * Every rejection throws IllegalActionError with state fully unchanged and
 * no step counted (§8). The step cap throws StepLimitError — an abnormal
 * protection that must fail tests, never fake a draw (§6).
 */
import type {
  GameDefinition,
  GameResult,
  LegalChoice,
} from "@/lib/games/core";
import {
  IllegalActionError,
  SerializationError,
  StepLimitError,
} from "@/lib/games/core";
import { assertSeedBytes, createQuick6Rng } from "./prng";
import {
  ALL_PHASES,
  ALL_SEATS,
  ROLE_MULTISET,
  SEAT_COUNT,
} from "./types";
import type {
  ExternalPhase,
  GameOutcome,
  Quick6Command,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  Role,
  SeatId,
} from "./types";
import { DEFAULT_MAX_PHASE_STEPS, QUICK6_DEFINITION_ID, QUICK6_GAME_VERSIONS, QUICK6_TITLE } from "./versions";
import {
  actors,
  choiceIdOf,
  isAlive,
  isSeatId,
  legalChoices,
  nextSpeaker,
  phaseToken,
  systemCommand,
} from "./legal";
import { aiContextFor, publicProjection, viewFor } from "./view";
import type { PublicProjection, SeatView } from "./view";

export interface Quick6DefinitionConfig {
  /** Abnormal-protection step cap; default DEFAULT_MAX_PHASE_STEPS = 200. */
  maxPhaseSteps?: number;
}

export class Quick6Definition
  implements
    GameDefinition<Quick6State, Quick6Command, SeatView, PublicProjection, Quick6EventPayload>
{
  readonly id = QUICK6_DEFINITION_ID;
  readonly title = QUICK6_TITLE;
  readonly versions = QUICK6_GAME_VERSIONS;
  readonly maxPhaseSteps: number;

  constructor(config: Quick6DefinitionConfig = {}) {
    this.maxPhaseSteps = config.maxPhaseSteps ?? DEFAULT_MAX_PHASE_STEPS;
    if (this.maxPhaseSteps < 1) {
      throw new Error("maxPhaseSteps must be >= 1");
    }
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  initialState(seedBytes: Uint8Array, options?: unknown): Quick6State {
    assertSeedBytes(seedBytes);
    const opts = (options ?? {}) as Quick6StartOptions;
    const humanSeat = opts.humanSeat ?? 0;
    if (!isSeatId(humanSeat)) {
      throw new IllegalActionError("INVALID_SEAT", `human seat out of range: ${humanSeat}`);
    }
    const roles = opts.roles ? [...opts.roles] : this.dealRoles(seedBytes);
    const sorted = [...roles].sort().join(",");
    const expected = [...ROLE_MULTISET].sort().join(",");
    if (sorted !== expected) {
      throw new IllegalActionError(
        "INVALID_ARGUMENT",
        "roles must be exactly 2 wolves / 1 seer / 3 villagers",
      );
    }
    return {
      definitionId: QUICK6_DEFINITION_ID,
      // Private copy: the engine snapshot must not alias caller-held bytes.
      seedBytes: new Uint8Array(seedBytes),
      humanSeat,
      roles,
      alive: Array<boolean>(SEAT_COUNT).fill(true),
      steps: 0,
      round: 1,
      phase: "NIGHT",
      outcome: null,
      eliminations: [],
      speeches: [],
      votes: [],
      seerChecks: [],
      nightWolfKills: Array<SeatId | null>(SEAT_COUNT).fill(null),
      seerSubmitted: false,
      nightSeerTarget: null,
      revision: 0,
      events: [
        { index: 0, revision: 0, payload: { type: "PHASE", round: 1, phase: "NIGHT" } },
      ],
    };
  }

  /** §1 dealing: 无放回洗牌 of the frozen role multiset (deal domain). */
  private dealRoles(seedBytes: Uint8Array): Role[] {
    const rng = createQuick6Rng(seedBytes).stream("deal");
    const deck = [...ROLE_MULTISET];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // -------------------------------------------------------------------------
  // Choice vocabulary (single source of truth: ./legal.ts)
  // -------------------------------------------------------------------------

  choiceId(command: Quick6Command): string | null {
    return choiceIdOf(command);
  }

  legalChoices(state: Quick6State): readonly LegalChoice[] {
    return legalChoices(state);
  }

  actors(state: Quick6State): readonly number[] {
    return actors(state);
  }

  systemCommand(state: Quick6State): Quick6Command | null {
    return systemCommand(state);
  }

  phaseToken(state: Quick6State): string {
    return phaseToken(state);
  }

  stepsOf(state: Quick6State): number {
    return state.steps;
  }

  roundOf(state: Quick6State): number | null {
    return state.round;
  }

  // -------------------------------------------------------------------------
  // Transition: the explicit state machine
  // -------------------------------------------------------------------------

  transition(
    state: Quick6State,
    command: Quick6Command,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    switch (command.type) {
      case "SUBMIT_WOLF_KILL":
        return this.submitWolfKill(state, command.seat, command.target);
      case "SUBMIT_SEER_CHECK":
        return this.submitSeerCheck(state, command.seat, command.target);
      case "FINISH_NIGHT":
        return this.finishNight(state);
      case "SUBMIT_SPEECH":
        return this.submitSpeech(state, command.seat, command.text);
      case "FINISH_DISCUSSION":
        return this.finishDiscussion(state);
      case "SUBMIT_DAY_VOTE":
        return this.submitDayVote(state, command.seat, command.target);
      case "FINISH_VOTE":
        return this.finishVote(state);
    }
  }

  // ----- night -----

  private submitWolfKill(
    state: Quick6State,
    seat: number,
    target: number,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "NIGHT");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(state, seat, "行动者已死亡");
    if (state.roles[seat] !== "WOLF") {
      throw new IllegalActionError("UNAUTHORIZED_ROLE", "只有狼人能提交夜间目标");
    }
    if (state.nightWolfKills[seat] !== null) {
      throw new IllegalActionError("DUPLICATE_ACTION", "该狼人已提交夜间目标");
    }
    this.assertAliveTarget(state, target, "目标已死亡");
    if (target === seat) throw new IllegalActionError("SELF_TARGET", "目标不能是自己");
    if (state.roles[target] === "WOLF") {
      throw new IllegalActionError("ILLEGAL_TARGET", "狼人目标必须是存活非狼");
    }
    const nightWolfKills = [...state.nightWolfKills];
    nightWolfKills[seat] = target;
    return { state: { ...state, steps: this.bump(state), nightWolfKills }, events: [] };
  }

  private submitSeerCheck(
    state: Quick6State,
    seat: number,
    target: number,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "NIGHT");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(state, seat, "行动者已死亡");
    if (state.roles[seat] !== "SEER") {
      throw new IllegalActionError("UNAUTHORIZED_ROLE", "只有预言家能提交查验");
    }
    if (state.seerSubmitted) {
      throw new IllegalActionError("DUPLICATE_ACTION", "预言家本夜已提交查验");
    }
    this.assertAliveTarget(state, target, "查验目标已死亡");
    if (target === seat) throw new IllegalActionError("SELF_TARGET", "查验目标不能是自己");
    return {
      state: {
        ...state,
        steps: this.bump(state),
        seerSubmitted: true,
        nightSeerTarget: target,
      },
      events: [],
    };
  }

  /**
   * Simultaneous night settlement (§3): the seer check resolves FIRST and is
   * retained even if the seer dies this night; the wolf kill victim is then
   * picked (unanimous target, or the versioned per-round PRNG over the
   * sorted distinct targets — submission order never matters); the death is
   * applied and announced by seat id only; then the win table runs.
   */
  private finishNight(
    state: Quick6State,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "NIGHT");
    for (const w of ALL_SEATS) {
      if (isAlive(state, w) && state.roles[w] === "WOLF" && state.nightWolfKills[w] === null) {
        throw new IllegalActionError("INCOMPLETE_SUBMISSIONS", "仍有存活狼人未提交夜间目标");
      }
    }
    const seer = ALL_SEATS.find((s) => isAlive(state, s) && state.roles[s] === "SEER");
    if (seer !== undefined && !state.seerSubmitted) {
      throw new IllegalActionError("INCOMPLETE_SUBMISSIONS", "存活预言家未提交查验");
    }
    const steps = this.bump(state);

    const events: Quick6EventPayload[] = [];
    let seerChecks = state.seerChecks;
    if (state.seerSubmitted && seer !== undefined && state.nightSeerTarget !== null) {
      const target = state.nightSeerTarget;
      seerChecks = [
        ...state.seerChecks,
        { round: state.round, target, isWolf: state.roles[target] === "WOLF" },
      ];
    }

    const distinct = [
      ...new Set(
        ALL_SEATS.filter(
          (s) => isAlive(state, s) && state.roles[s] === "WOLF",
        ).map((s) => state.nightWolfKills[s] as SeatId),
      ),
    ].sort((a, b) => a - b);
    let victim: SeatId | undefined;
    if (distinct.length === 1) {
      victim = distinct[0];
    } else if (distinct.length > 1) {
      const rng = createQuick6Rng(state.seedBytes).stream(
        "night-wolf-tiebreak",
        `round:${state.round}`,
      );
      victim = distinct[Math.floor(rng.next() * distinct.length)];
    }

    let alive = state.alive;
    let eliminations = state.eliminations;
    if (victim !== undefined) {
      const nextAlive = [...state.alive];
      nextAlive[victim] = false;
      alive = nextAlive;
      const record = { round: state.round, kind: "NIGHT_KILL" as const, seat: victim };
      eliminations = [...state.eliminations, record];
      events.push({ type: "ELIMINATION", record });
    }

    let outcome = state.outcome;
    let phase: ExternalPhase = "DAY_DISCUSSION";
    const win = this.checkWin(state.roles, alive);
    if (win !== null) {
      outcome = win;
      phase = "END";
      events.push({ type: "GAME_OVER", winner: win.winner, reason: win.reason });
    }
    events.push({ type: "PHASE", round: state.round, phase });

    return {
      state: {
        ...state,
        steps,
        alive,
        eliminations,
        seerChecks,
        outcome,
        phase,
        nightWolfKills: Array<SeatId | null>(SEAT_COUNT).fill(null),
        seerSubmitted: false,
        nightSeerTarget: null,
      },
      events,
    };
  }

  // ----- day -----

  private submitSpeech(
    state: Quick6State,
    seat: number,
    text: string | null,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "DAY_DISCUSSION");
    this.assertSeat(seat);
    this.assertAlive(state, seat, "行动者已死亡");
    if (text !== null && typeof text !== "string") {
      throw new IllegalActionError("INVALID_ARGUMENT", "发言必须是字符串或显式跳过(null)");
    }
    const next = nextSpeaker(state);
    if (seat !== next) {
      throw new IllegalActionError(
        "OUT_OF_ORDER",
        `发言必须按座位顺序：当前轮到座位 ${next}`,
      );
    }
    const record = { round: state.round, seat, text };
    return {
      state: {
        ...state,
        steps: this.bump(state),
        speeches: [...state.speeches, record],
      },
      events: [{ type: "SPEECH", record }],
    };
  }

  private finishDiscussion(
    state: Quick6State,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "DAY_DISCUSSION");
    if (nextSpeaker(state) !== null) {
      throw new IllegalActionError("INCOMPLETE_SUBMISSIONS", "仍有存活玩家未发言");
    }
    return {
      state: { ...state, steps: this.bump(state), phase: "DAY_VOTE" },
      events: [{ type: "PHASE", round: state.round, phase: "DAY_VOTE" }],
    };
  }

  private submitDayVote(
    state: Quick6State,
    seat: number,
    target: number,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "DAY_VOTE");
    this.assertSeat(seat);
    this.assertSeat(target);
    this.assertAlive(state, seat, "行动者已死亡");
    if (state.votes.some((v) => v.round === state.round && v.seat === seat)) {
      throw new IllegalActionError("DUPLICATE_ACTION", "该玩家本轮已投票");
    }
    this.assertAliveTarget(state, target, "投票目标已死亡");
    if (target === seat) throw new IllegalActionError("SELF_TARGET", "不得自投");
    const record = { round: state.round, seat, target };
    return {
      state: {
        ...state,
        steps: this.bump(state),
        votes: [...state.votes, record],
      },
      events: [{ type: "VOTE", record }],
    };
  }

  /**
   * Day vote settlement (§4): the unique top count exiles exactly that seat;
   * a tie exiles nobody (no re-vote, no RNG). Exiles are announced by seat id
   * only; the win table runs after every exile (even on a tie day, where it
   * cannot change anything); otherwise the next round starts at NIGHT.
   */
  private finishVote(
    state: Quick6State,
  ): { state: Quick6State; events: readonly Quick6EventPayload[] } {
    this.assertPhase(state, "DAY_VOTE");
    const voted = new Set(
      state.votes.filter((v) => v.round === state.round).map((v) => v.seat),
    );
    if (ALL_SEATS.some((s) => isAlive(state, s) && !voted.has(s))) {
      throw new IllegalActionError("ABSTAIN_FORBIDDEN", "每名存活玩家必须投票（不得弃票）");
    }
    const steps = this.bump(state);

    const events: Quick6EventPayload[] = [];
    const tally = new Map<SeatId, number>();
    for (const v of state.votes) {
      if (v.round === state.round) tally.set(v.target, (tally.get(v.target) ?? 0) + 1);
    }
    const counts = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const uniqueTop = counts.length > 0 && (counts.length === 1 || counts[1][1] < counts[0][1]);

    let alive = state.alive;
    let eliminations = state.eliminations;
    if (uniqueTop) {
      const exiled = counts[0][0];
      const nextAlive = [...state.alive];
      nextAlive[exiled] = false;
      alive = nextAlive;
      const record = { round: state.round, kind: "DAY_EXILE" as const, seat: exiled };
      eliminations = [...state.eliminations, record];
      events.push({ type: "ELIMINATION", record });
    }

    let outcome = state.outcome;
    let phase: ExternalPhase = "NIGHT";
    let round = state.round;
    const win = this.checkWin(state.roles, alive);
    if (win !== null) {
      outcome = win;
      phase = "END";
      events.push({ type: "GAME_OVER", winner: win.winner, reason: win.reason });
    } else {
      round = state.round + 1;
    }
    events.push({ type: "PHASE", round, phase });

    return {
      state: { ...state, steps, alive, eliminations, outcome, phase, round },
      events,
    };
  }

  // ----- win table (§5) -----

  /** Runs after every night kill and every day exile (even a tie day). */
  private checkWin(roles: readonly Role[], alive: readonly boolean[]): GameOutcome | null {
    let livingWolves = 0;
    let livingOthers = 0;
    for (const s of ALL_SEATS) {
      if (!alive[s]) continue;
      if (roles[s] === "WOLF") livingWolves += 1;
      else livingOthers += 1;
    }
    if (livingWolves === 0) {
      return { winner: "TOWN", reason: "WOLVES_EXTERMINATED" };
    }
    if (livingWolves >= livingOthers) {
      return { winner: "WOLF", reason: "WOLVES_MAJORITY" };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Terminal / result / views / serialization
  // -------------------------------------------------------------------------

  isTerminal(state: Quick6State): boolean {
    return state.phase === "END";
  }

  result(state: Quick6State): GameResult | null {
    return state.outcome;
  }

  publicView(state: Quick6State): PublicProjection {
    return publicProjection(state);
  }

  viewFor(state: Quick6State, seat: number): SeatView {
    return viewFor(state, seat);
  }

  aiContextFor(state: Quick6State, seat: number): SeatView {
    return aiContextFor(state, seat);
  }

  serializeState(state: Quick6State): string {
    return JSON.stringify({
      kind: "quick6-state",
      schemaVersion: this.versions.definition,
      state: {
        ...state,
        seedBytes: [...state.seedBytes],
      },
    });
  }

  deserializeState(json: string): Quick6State {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new SerializationError("payload is not valid JSON");
    }
    const envelope = parsed as { kind?: unknown; schemaVersion?: unknown; state?: unknown };
    if (envelope?.kind !== "quick6-state") {
      throw new SerializationError("unknown payload kind");
    }
    if (envelope.schemaVersion !== this.versions.definition) {
      throw new SerializationError(
        `schema version mismatch: expected ${this.versions.definition}, got ${String(envelope.schemaVersion)}`,
      );
    }
    const raw = envelope.state as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) {
      throw new SerializationError("missing state object");
    }
    const seedList = raw.seedBytes as unknown[];
    if (!Array.isArray(seedList) || seedList.length < 16) {
      throw new SerializationError("seedBytes must be an array of at least 16 bytes");
    }
    const seedBytes = Uint8Array.from(seedList as number[]);
    assertSeedBytes(seedBytes);

    const state: Quick6State = {
      definitionId: QUICK6_DEFINITION_ID,
      seedBytes,
      humanSeat: raw.humanSeat as number,
      roles: raw.roles as Role[],
      alive: raw.alive as boolean[],
      steps: raw.steps as number,
      round: raw.round as number,
      phase: raw.phase as ExternalPhase,
      outcome: raw.outcome as GameOutcome | null,
      eliminations: raw.eliminations as Quick6State["eliminations"],
      speeches: raw.speeches as Quick6State["speeches"],
      votes: raw.votes as Quick6State["votes"],
      seerChecks: raw.seerChecks as Quick6State["seerChecks"],
      nightWolfKills: raw.nightWolfKills as Quick6State["nightWolfKills"],
      seerSubmitted: raw.seerSubmitted as boolean,
      nightSeerTarget: raw.nightSeerTarget as SeatId | null,
      revision: raw.revision as number,
      events: raw.events as Quick6State["events"],
    };
    this.assertDeserializedState(state);
    return state;
  }

  /** Structural validation of a deserialized state (throws SerializationError). */
  private assertDeserializedState(state: Quick6State): void {
    const fail = (message: string): never => {
      throw new SerializationError(message);
    };
    if (!isSeatId(state.humanSeat)) fail(`humanSeat out of range: ${state.humanSeat}`);
    if (state.roles.length !== SEAT_COUNT) fail("roles must have 6 entries");
    const sorted = [...state.roles].sort().join(",");
    if (sorted !== [...ROLE_MULTISET].sort().join(",")) fail("roles multiset mismatch");
    if (state.alive.length !== SEAT_COUNT) fail("alive must have 6 entries");
    if (!ALL_PHASES.includes(state.phase)) fail(`unknown phase: ${String(state.phase)}`);
    if (!Number.isInteger(state.round) || state.round < 1) fail("round must be an integer >= 1");
    if (!Number.isInteger(state.steps) || state.steps < 0) fail("steps must be an integer >= 0");
    if (!Number.isInteger(state.revision) || state.revision < 0) {
      fail("revision must be an integer >= 0");
    }
    if (state.phase === "END" ? state.outcome === null : state.outcome !== null) {
      fail("phase END requires an outcome and vice versa");
    }
    if (state.outcome !== null) {
      const ok =
        (state.outcome.winner === "TOWN" && state.outcome.reason === "WOLVES_EXTERMINATED") ||
        (state.outcome.winner === "WOLF" && state.outcome.reason === "WOLVES_MAJORITY");
      if (!ok) fail("unknown outcome");
    }
    if (!Array.isArray(state.events)) fail("events must be an array");
    state.events.forEach((event, i) => {
      if (event.index !== i) fail(`event ${i} has non-contiguous index ${event.index}`);
      if (!Number.isInteger(event.revision) || event.revision < 0 || event.revision > state.revision) {
        fail(`event ${i} has invalid revision`);
      }
    });
    if (state.nightWolfKills.length !== SEAT_COUNT) fail("nightWolfKills must have 6 entries");
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  /** Abnormal protection (§6): the cap is a defect signal, never a draw. */
  private bump(state: Quick6State): number {
    if (state.steps >= this.maxPhaseSteps) throw new StepLimitError();
    return state.steps + 1;
  }

  private assertPhase(state: Quick6State, expected: ExternalPhase): void {
    if (state.phase !== expected) {
      throw new IllegalActionError(
        "WRONG_PHASE",
        `阶段错误：当前 ${state.phase}，需要 ${expected}`,
      );
    }
  }

  private assertSeat(seat: number): void {
    if (!isSeatId(seat)) {
      throw new IllegalActionError("INVALID_SEAT", `座位不存在：${seat}`);
    }
  }

  private assertAlive(state: Quick6State, seat: SeatId, message: string): void {
    if (!isAlive(state, seat)) {
      throw new IllegalActionError("DEAD_ACTOR", message);
    }
  }

  private assertAliveTarget(state: Quick6State, seat: SeatId, message: string): void {
    if (!isAlive(state, seat)) {
      throw new IllegalActionError("DEAD_TARGET", message);
    }
  }
}
