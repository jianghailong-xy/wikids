/**
 * The game application service (P4.1): create, resume, submit commands and
 * the bounded advance.
 *
 * Invariants enforced here (and verified by tests/orchestration):
 * - AI seats obtain their independent authorized observation through the
 *   single forward projector (definition.viewFor → projectView) and submit
 *   through the SAME submitCommand path as the human. A model can never
 *   write the database or decide rules: it only returns a choice id plus an
 *   utterance, the choice is re-verified against the rule engine's legal
 *   set, and the command is validated again by the definition's transition
 *   inside the idempotent executeAction.
 * - Bounded advance: one advance starts at most ONE external AI decision
 *   (DAY_DISCUSSION, strictly in seat order so later speakers see already
 *   public earlier speeches) or ONE frozen batch of mutually independent
 *   submissions (NIGHT wolves + seer, simultaneous DAY_VOTE votes). When
 *   work remains, advance returns an explicit pending/retryAfter status —
 *   it never loops inside a single call.
 * - Short transactions, database-time claim leases: every provider attempt
 *   goes claim → provider call (strictly outside any transaction) → complete
 *   under (claimToken, generation); expired or reclaimed leases reject the
 *   result (STALE_LEASE). After a request disconnect or timeout the lease is
 *   reclaimable (database time) and the late response is discarded.
 * - Every decision gets at most `provider.maxRetries` transient retries
 *   (default 1) plus a single per-attempt timeout; timeouts and non-
 *   transient failures (malformed, illegal choice, content filter, …) are
 *   never retried and fall back deterministically. Failed attempts are
 *   charged by the claim itself (attempts + ai_budget_consumed).
 * - Per-game budgets (logical calls / HTTP attempts / tokens / rounds) and
 *   the per-user concurrent-games budget come from the versioned config;
 *   exhaustion never stalls a game — it forces the deterministic fallback
 *   (or, for the round cap, a loud abort — never a forged draw).
 * - The fallback derives purely from (seed, phaseToken, seat, purpose) over
 *   the legal choice ids, so it is reproducible and independent of
 *   concurrent completion order.
 * - The first version runs on the existing persistent Node runtime (Next.js
 *   route handlers over a persistent Postgres); it makes no claim of
 *   support for short-lived, background-less serverless runtimes.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  AiDecision,
  AiPhase,
  AiTurnInput,
  LegalChoiceRef,
  PublicHistoryItem,
} from "@/lib/ai/contract";
import { MAX_HISTORY_ITEMS } from "@/lib/ai/contract";
import { AiProviderError, RETRYABLE_CODES } from "@/lib/ai/errors";
import type * as schema from "@/lib/db/schema";
import {
  GameEngine,
  GameRepository,
  IllegalActionError,
  PersistenceError,
  ProviderTimeoutError,
  assertNoOpenTransaction,
  computeSnapshotChecksum,
  deriveFallbackChoice,
  isTimeoutError,
  sha256Hex,
} from "@/lib/games/core";
import type { GameEvent, PersistedEvent } from "@/lib/games/core";
import {
  QUICK6_DEFINITION_ID,
  QUICK6_GAME_VERSIONS,
  Quick6Definition,
  choiceIdOf,
  createQuick6Rng,
  generateSeedBytes,
  legalChoices,
  nextSpeaker,
  parseChoiceId,
  pendingNightSeats,
  pendingVoters,
  phaseToken,
  projectView,
  replayQuick6,
} from "@/lib/games/werewolf";
import type {
  ExternalPhase,
  Quick6Command,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  SeatId,
} from "@/lib/games/werewolf";
import type { PublicProjection, SeatView } from "@/lib/games/werewolf";
import type { OrchestrationConfig, OrchestrationConfigInput } from "./config";
import { normalizeOrchestrationConfig } from "./config";
import type { DecisionEngine } from "./engine";
import { decisionEngineOrDisabled } from "./engine";
import { OrchestrationStore } from "./store";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  /** Fixed seed bytes (tests); production derives crypto-random bytes. */
  readonly seedBytes?: Uint8Array;
  /** Role table / human seat (defaults to a seeded deal, human at seat 0). */
  readonly start?: Quick6StartOptions;
}

export interface CreateGameResult {
  readonly sessionId: string;
  readonly revision: number;
  readonly phaseToken: string;
  readonly publicView: PublicProjection;
  /** Exactly the human seat's own authorized view (the single projector). */
  readonly ownView: SeatView;
}

export interface ResumeGameInput {
  /** The requesting human's seat, for a seat-scoped view. */
  readonly viewer?: { readonly seat?: number };
}

export interface ResumeGameResult {
  readonly sessionId: string;
  readonly status: "active" | "finished" | "aborted";
  readonly revision: number;
  readonly phase: ExternalPhase;
  readonly round: number;
  /** projectView-scoped: seat view, public view, or the post-game reveal. */
  readonly view: unknown;
}

export interface SubmitCommandInput {
  /** Client-supplied idempotency key; one application per key per session. */
  readonly key: string;
  readonly command: Quick6Command;
  /**
   * The seat this request acts for (human requests). Requests carrying an
   * actor seat may only act for that seat and may never settle a phase.
   * AI-internal submissions (from advance) omit it.
   */
  readonly actorSeat?: number;
}

export type SubmitCommandErrorCode =
  | "NOT_FOUND"
  | "STALE"
  | "ILLEGAL"
  | "FORBIDDEN"
  | "TERMINAL"
  | "IDEMPOTENCY_CONFLICT";

export type SubmitCommandResult =
  | {
      readonly ok: true;
      /** false when the receipt replayed the stored response (applied once). */
      readonly applied: boolean;
      readonly revision: number;
      readonly events: readonly Quick6EventPayload[];
      readonly publicView: PublicProjection;
    }
  | {
      readonly ok: false;
      readonly error: SubmitCommandErrorCode;
      /** Granular IllegalActionError code when error === "ILLEGAL". */
      readonly code?: string;
      readonly detail?: string;
    };

export type AdvanceResult =
  | {
      readonly status: "finished";
      readonly winner: string;
      readonly reason: string;
      readonly publicView: PublicProjection;
    }
  | {
      readonly status: "aborted";
      readonly reason: "round_budget_exceeded";
      readonly round: number;
      readonly maxRounds: number;
    }
  | {
      readonly status: "waiting_for_human";
      readonly seat: SeatId;
      readonly phase: ExternalPhase;
      readonly round: number;
      readonly publicView: PublicProjection;
    }
  | {
      readonly status: "pending";
      /** Client should call advance again after this many milliseconds. */
      readonly retryAfterMs: number;
      readonly phase: ExternalPhase;
      readonly round: number;
      readonly publicView: PublicProjection;
    };

export interface GameApplicationServiceOptions {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly definition?: Quick6Definition;
  /** Versioned thresholds; defaults + overrides (see config.ts). */
  readonly config?: OrchestrationConfigInput;
  /** The decision engine; null/undefined = no provider (pure fallback). */
  readonly engine?: DecisionEngine | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** One independent decision the advance may start for an AI seat. */
interface DecisionTarget {
  readonly seat: SeatId;
  readonly purpose: "wolf-kill" | "seer-check" | "speech" | "vote";
}

type DecisionOutcome =
  /** The decision was applied (or replayed / already applied) to the game. */
  | { readonly kind: "applied"; readonly source: "provider" | "fallback" }
  | { readonly kind: "already-applied" }
  /** Another live worker holds this seat's lease: try again later. */
  | { readonly kind: "deferred" }
  /** The command could not be applied (state moved on); nothing to do. */
  | { readonly kind: "discarded" };

type ExecuteOutcome =
  | { readonly kind: "applied" | "replayed"; readonly revision: number; readonly response: unknown }
  | { readonly kind: "stale" }
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly message: string;
    };

type ProviderOutcome =
  | { readonly kind: "deferred" }
  | { readonly kind: "decision"; readonly decision: AiDecision; readonly tokens: number }
  | { readonly kind: "failed"; readonly tokens: number; readonly error: unknown };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The acting seat of a command, or null for settlement commands. */
function commandSeat(command: Quick6Command): number | null {
  switch (command.type) {
    case "SUBMIT_WOLF_KILL":
    case "SUBMIT_SEER_CHECK":
    case "SUBMIT_SPEECH":
    case "SUBMIT_DAY_VOTE":
      return command.seat;
    case "FINISH_NIGHT":
    case "FINISH_DISCUSSION":
    case "FINISH_VOTE":
      return null;
  }
}

/** The stable idempotency key of one AI decision. */
function aiDecisionKey(phaseToken: string, seat: SeatId, purpose: string): string {
  return `ai:${phaseToken}:${seat}:${purpose}`;
}

/** The stable idempotency key of a phase settlement. */
function settlementKey(phaseToken: string): string {
  return `sys:${phaseToken}:settle`;
}

/**
 * The batch of independent decisions an advance may start for one state,
 * plus the human seat when only the human is pending. The cap bounds the
 * batch size (the "frozen batch" of the bounded advance); DAY_DISCUSSION
 * always yields at most one target because speeches are strictly ordered.
 */
function computeBatch(
  state: Quick6State,
  humanSeat: SeatId,
  cap: number,
): { readonly batch: readonly DecisionTarget[]; readonly waitingHuman: SeatId | null } {
  switch (state.phase) {
    case "NIGHT": {
      const pending = pendingNightSeats(state);
      const ai = pending.filter((seat) => seat !== humanSeat);
      const batch = ai.slice(0, cap).map((seat) => ({
        seat,
        purpose: (state.roles[seat] === "WOLF" ? "wolf-kill" : "seer-check") as DecisionTarget["purpose"],
      }));
      const waitingHuman = ai.length === 0 && pending.length > 0 ? pending[0] : null;
      return { batch, waitingHuman };
    }
    case "DAY_DISCUSSION": {
      const speaker = nextSpeaker(state);
      if (speaker === null) return { batch: [], waitingHuman: null };
      if (speaker === humanSeat) return { batch: [], waitingHuman: speaker };
      return { batch: [{ seat: speaker, purpose: "speech" }], waitingHuman: null };
    }
    case "DAY_VOTE": {
      const pending = pendingVoters(state);
      const ai = pending.filter((seat) => seat !== humanSeat);
      const batch = ai.slice(0, cap).map((seat) => ({ seat, purpose: "vote" as const }));
      const waitingHuman = ai.length === 0 && pending.length > 0 ? pending[0] : null;
      return { batch, waitingHuman };
    }
    case "END":
      return { batch: [], waitingHuman: null };
  }
}

/** Public history for a provider turn, bounded to the contract cap. */
export function publicHistoryOf(state: Quick6State): PublicHistoryItem[] {
  const items: PublicHistoryItem[] = [];
  for (const event of state.events) {
    const payload = event.payload;
    switch (payload.type) {
      case "PHASE":
        items.push({ kind: "phase", round: payload.round, phase: payload.phase });
        break;
      case "ELIMINATION":
        items.push({
          kind: "elimination",
          round: payload.record.round,
          by: payload.record.kind,
          seat: payload.record.seat,
        });
        break;
      case "SPEECH":
        items.push({
          kind: "speech",
          round: payload.record.round,
          seat: payload.record.seat,
          text: payload.record.text,
        });
        break;
      case "VOTE":
        items.push({
          kind: "vote",
          round: payload.record.round,
          seat: payload.record.seat,
          target: payload.record.target,
        });
        break;
      case "GAME_OVER":
        items.push({ kind: "outcome", winner: payload.winner, reason: payload.reason });
        break;
    }
  }
  return items.slice(-MAX_HISTORY_ITEMS);
}

/**
 * Provider decision → command, re-verified against the rule engine: the
 * choice id must be inside the seat's legal set AND round-trip through the
 * canonical choiceId mapping. Anything else yields null → fallback.
 */
function decisionToCommand(
  decision: AiDecision,
  seat: SeatId,
  choiceIds: readonly string[],
): Quick6Command | null {
  const id = decision.choiceId;
  if (!choiceIds.includes(id)) return null;
  const parsed = parseChoiceId(id);
  if (parsed === null) return null;
  let command: Quick6Command = parsed;
  if (parsed.type === "SUBMIT_SPEECH") {
    command = {
      type: "SUBMIT_SPEECH",
      seat: parsed.seat,
      text: id.startsWith("skip@") ? null : decision.utterance,
    };
  }
  if (choiceIdOf(command) !== id) return null;
  if (commandSeat(command) !== seat) return null;
  return command;
}

/** Deterministic fallback command from a derived choice id + its label. */
function fallbackToCommand(choiceId: string, label: string | null): Quick6Command | null {
  const parsed = parseChoiceId(choiceId);
  if (parsed === null) return null;
  if (parsed.type === "SUBMIT_SPEECH") {
    return {
      type: "SUBMIT_SPEECH",
      seat: parsed.seat,
      text: choiceId.startsWith("skip@") ? null : (label ?? ""),
    };
  }
  return parsed;
}

/** Only transient failures (429 / 5xx / network) are ever retried. */
function isTransient(error: unknown): boolean {
  return error instanceof AiProviderError && RETRYABLE_CODES.has(error.code);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GameApplicationService {
  readonly definition: Quick6Definition;
  readonly config: OrchestrationConfig;
  private readonly repo: GameRepository;
  private readonly store: OrchestrationStore;
  private readonly engine: DecisionEngine;

  constructor(options: GameApplicationServiceOptions) {
    this.definition = options.definition ?? new Quick6Definition();
    this.config = normalizeOrchestrationConfig(options.config);
    this.repo = new GameRepository(options.db);
    this.store = new OrchestrationStore(options.db);
    this.engine = decisionEngineOrDisabled(options.engine);
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a session under the per-user concurrent-games budget, enforced
   * ATOMICALLY inside the repository transaction via an owner-scoped
   * advisory lock (concurrent creates of one owner cannot both pass).
   * Throws PersistenceError USER_BUDGET_EXHAUSTED when the user is at the
   * cap; nothing is written.
   */
  async createGame(
    ownerId: string,
    options: CreateGameOptions = {},
  ): Promise<CreateGameResult> {
    const seedBytes = options.seedBytes ?? generateSeedBytes();
    const start = options.start;
    const { sessionId, revision, phaseToken: phaseTokenOut } = await this.repo.createSession(
      ownerId,
      this.definition,
      seedBytes,
      start,
      { limit: this.config.game.maxHttpAttempts },
      { maxActiveGames: this.config.user.maxConcurrentGames },
    );
    const state = this.definition.initialState(seedBytes, start);
    return {
      sessionId,
      revision,
      phaseToken: phaseTokenOut,
      publicView: this.definition.publicView(state),
      ownView: this.definition.viewFor(state, start?.humanSeat ?? 0),
    };
  }

  /** Owner-scoped session list (newest first). */
  async listGames(ownerId: string) {
    return this.repo.listSessions(ownerId);
  }

  // -------------------------------------------------------------------------
  // Resume
  // -------------------------------------------------------------------------

  /** Load the current state and project exactly the requested view. */
  async resumeGame(ownerId: string, sessionId: string, input: ResumeGameInput = {}): Promise<ResumeGameResult> {
    const session = await this.repo.getSession(ownerId, sessionId);
    if (!session) {
      throw new PersistenceError("NOT_FOUND", `session ${sessionId}`);
    }
    const { state } = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
    const quick6 = state as Quick6State;
    const terminal = this.definition.isTerminal(quick6);
    const view: unknown = terminal
      ? projectView(quick6, { scope: "POST_GAME" })
      : input.viewer?.seat !== undefined
        ? this.definition.viewFor(quick6, input.viewer.seat)
        : this.definition.publicView(quick6);
    return {
      sessionId,
      status:
        session.status === "finished"
          ? "finished"
          : session.status === "aborted"
            ? "aborted"
            : "active",
      revision: quick6.revision,
      phase: quick6.phase,
      round: quick6.round,
      view,
    };
  }

  // -------------------------------------------------------------------------
  // Submit command — the single path for human AND AI submissions
  // -------------------------------------------------------------------------

  /**
   * Submit one command. Human requests pass an actor seat and a client
   * idempotency key; the advance passes AI-decision keys through the exact
   * same code path. The command is validated by the rule engine
   * (definition.transition) inside the idempotent executeAction: applied
   * exactly once under revision/phase-token CAS, or replayed from the
   * stored stable response.
   */
  async submitCommand(
    ownerId: string,
    sessionId: string,
    input: SubmitCommandInput,
  ): Promise<SubmitCommandResult> {
    const session = await this.repo.getSession(ownerId, sessionId);
    if (!session) {
      return { ok: false, error: "NOT_FOUND" };
    }
    const outcome = await this.executeCommand(
      ownerId,
      sessionId,
      input.key,
      input.command,
      input.actorSeat ?? null,
    );
    switch (outcome.kind) {
      case "applied":
      case "replayed": {
        const { state } = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
        const response = outcome.response as { events?: Quick6EventPayload[] } | null;
        return {
          ok: true,
          applied: outcome.kind === "applied",
          revision: outcome.revision,
          events: response?.events ?? [],
          publicView: this.definition.publicView(state as Quick6State),
        };
      }
      case "stale":
        return { ok: false, error: "STALE", detail: "the session advanced past this command" };
      case "rejected":
        return this.mapRejection(outcome);
    }
  }

  private mapRejection(outcome: Extract<ExecuteOutcome, { kind: "rejected" }>): SubmitCommandResult {
    switch (outcome.code) {
      case "TERMINAL_STATE":
        return { ok: false, error: "TERMINAL", detail: outcome.message };
      case "FORBIDDEN":
        return { ok: false, error: "FORBIDDEN", detail: outcome.message };
      case "IDEMPOTENCY_CONFLICT":
        return { ok: false, error: "IDEMPOTENCY_CONFLICT", detail: outcome.message };
      default:
        return { ok: false, error: "ILLEGAL", code: outcome.code, detail: outcome.message };
    }
  }

  /**
   * The shared executor: receipt fast path → fresh load → actor
   * authorization → rule-engine dispatch → idempotent append under CAS.
   */
  private async executeCommand(
    ownerId: string,
    sessionId: string,
    key: string,
    command: Quick6Command,
    actorSeat: number | null,
  ): Promise<ExecuteOutcome> {
    const requestHash = sha256Hex(JSON.stringify(command));
    const existing = await this.repo.getActionReceipt(ownerId, sessionId, key);
    if (existing && existing.requestHash === requestHash) {
      return { kind: "replayed", revision: existing.revision, response: existing.responseJson };
    }

    const { state, dispatchable } = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
    // A replayed state whose event stream cannot account for the session's
    // revision (zero-event transitions, e.g. buffered night submissions) is
    // a read-only projection: dispatching from it would mis-settle the
    // game. Report stale so the caller retries against a consistent read.
    if (!dispatchable) {
      return { kind: "stale" };
    }
    const engine = GameEngine.restore(this.definition, state as Quick6State);
    if (engine.isTerminal()) {
      return {
        kind: "rejected",
        code: "TERMINAL_STATE",
        message: "the game is over: the terminal state absorbs every action",
      };
    }

    // Actor authorization: requests naming a seat may only act for that seat
    // and may never settle a phase (settlement is the system's alone).
    if (actorSeat !== null) {
      const seat = commandSeat(command);
      if (seat === null || seat !== actorSeat) {
        return {
          kind: "rejected",
          code: "FORBIDDEN",
          message: `the requesting seat may not submit this command`,
        };
      }
    }

    const beforeRevision = engine.revision;
    const beforePhaseToken = engine.phaseToken();
    let events: readonly GameEvent<Quick6EventPayload>[];
    try {
      events = engine.dispatch(command);
    } catch (error) {
      if (error instanceof IllegalActionError) {
        return { kind: "rejected", code: error.code, message: error.message };
      }
      throw error;
    }

    const stateJson = engine.serializeState();
    const lastSeq = state.events.length - 1 + events.length;
    const checksum = computeSnapshotChecksum({
      definitionId: QUICK6_DEFINITION_ID,
      versions: QUICK6_GAME_VERSIONS,
      lastEventSeq: lastSeq,
      revision: beforeRevision + 1,
      stateJson,
    });
    const responseJson = {
      applied: true,
      revision: beforeRevision + 1,
      events: events.map((event) => event.payload),
    };

    try {
      const result = await this.repo.executeAction(ownerId, sessionId, {
        key,
        requestHash,
        expectedRevision: beforeRevision,
        expectedPhaseToken: beforePhaseToken,
        newPhaseToken: engine.phaseToken(),
        events: events.map((event) => event.payload),
        stateJson,
        checksum,
        definitionId: QUICK6_DEFINITION_ID,
        versions: QUICK6_GAME_VERSIONS,
        responseJson,
      });
      if (result.applied && engine.isTerminal()) {
        await this.store.markFinished(ownerId, sessionId);
      }
      return { kind: "applied", revision: result.revision, response: result.response };
    } catch (error) {
      if (error instanceof PersistenceError) {
        if (error.code === "STALE_REVISION" || error.code === "STALE_PHASE_TOKEN") {
          return { kind: "stale" };
        }
        if (error.code === "IDEMPOTENCY_CONFLICT") {
          return { kind: "rejected", code: "IDEMPOTENCY_CONFLICT", message: error.message };
        }
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Bounded advance
  // -------------------------------------------------------------------------

  /**
   * Advance the game by at most one frozen batch of external AI decisions
   * (or the single ordered speaker in DAY_DISCUSSION), then at most one
   * deterministic settlement. When work remains — another batch, a human
   * submission, or a lease held by a live worker — the result is an
   * explicit pending / waiting_for_human status with retryAfterMs; this
   * method never loops until the game is over.
   */
  async advance(ownerId: string, sessionId: string): Promise<AdvanceResult> {
    const session = await this.repo.getSession(ownerId, sessionId);
    if (!session) {
      throw new PersistenceError("NOT_FOUND", `session ${sessionId}`);
    }

    const { state, dispatchable } = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
    const initial = state as Quick6State;

    // A non-dispatchable load (replayed state that cannot account for
    // zero-event transitions) must not drive decisions: report pending
    // without starting any work; a later consistent read either serves the
    // snapshot or rebuilds it.
    if (!dispatchable && !this.definition.isTerminal(initial)) {
      return {
        status: "pending",
        retryAfterMs: this.config.advance.pendingRetryAfterMs,
        phase: initial.phase,
        round: initial.round,
        publicView: this.definition.publicView(initial),
      };
    }

    // Round budget (abnormal protection): a game that would keep playing
    // past the configured round cap is refused loudly — never a draw — and
    // stops counting against the per-user budget (it is never played again).
    if (!this.definition.isTerminal(initial) && initial.round > this.config.game.maxRounds) {
      await this.store.markAborted(ownerId, sessionId);
      return {
        status: "aborted",
        reason: "round_budget_exceeded",
        round: initial.round,
        maxRounds: this.config.game.maxRounds,
      };
    }

    let deferred = false;

    // Phase 1: the frozen batch of independent AI decisions. The batch is
    // computed once from the loaded state; each decision claims its own
    // database-time lease and runs outside any transaction.
    if (!this.definition.isTerminal(initial)) {
      const { batch } = computeBatch(initial, initial.humanSeat, this.config.advance.maxProviderCallsPerAdvance);
      if (batch.length > 0) {
        const concurrency = this.config.advance.maxConcurrentProviderCalls;
        const outcomes: DecisionOutcome[] = [];
        for (let i = 0; i < batch.length; i += concurrency) {
          const group = batch.slice(i, i + concurrency);
          outcomes.push(
            ...(await Promise.all(
              group.map((target) => this.runDecision(ownerId, sessionId, initial, target)),
            )),
          );
        }
        deferred = outcomes.some((outcome) => outcome.kind === "deferred");
      }
    }

    // Phase 2: at most one settlement dispatch. Settlement is pure domain
    // work (no provider calls); a stale dispatch means a concurrent worker
    // settled first, which is benign.
    if (!deferred) {
      const after = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
      const afterState = after.state as Quick6State;
      const engine = GameEngine.restore(this.definition, afterState);
      if (!engine.isTerminal()) {
        const settle = engine.systemCommand();
        if (settle !== null) {
          await this.executeCommand(
            ownerId,
            sessionId,
            settlementKey(engine.phaseToken()),
            settle,
            null,
          );
        }
      }
    }

    // Phase 3: report where the game stands now. No further work is started
    // in this call.
    const final = await this.repo.loadState(ownerId, sessionId, this.definition, this.replay);
    const finalState = final.state as Quick6State;
    if (this.definition.isTerminal(finalState)) {
      const outcome = this.definition.result(finalState);
      if (outcome === null) {
        throw new Error("terminal state carries no outcome (rules defect)");
      }
      return {
        status: "finished",
        winner: outcome.winner,
        reason: outcome.reason,
        publicView: this.definition.publicView(finalState),
      };
    }

    const { waitingHuman } = computeBatch(finalState, finalState.humanSeat, this.config.advance.maxProviderCallsPerAdvance);
    if (waitingHuman !== null) {
      return {
        status: "waiting_for_human",
        seat: waitingHuman,
        phase: finalState.phase,
        round: finalState.round,
        publicView: this.definition.publicView(finalState),
      };
    }

    // Work remains: another batch, or the current batch was deferred to a
    // live worker. Either way the client should call advance again.
    return {
      status: "pending",
      retryAfterMs: this.config.advance.pendingRetryAfterMs,
      phase: finalState.phase,
      round: finalState.round,
      publicView: this.definition.publicView(finalState),
    };
  }

  // -------------------------------------------------------------------------
  // One AI decision: lease → provider (outside tx) → re-verify → shared submit
  // -------------------------------------------------------------------------

  /**
   * Produce and submit one AI decision for (phaseToken, seat, purpose).
   * Receipt fast path first (an applied decision is never re-decided), then
   * budget pre-checks, then provider attempts under database-time leases
   * with at most maxRetries transient retries, then the deterministic
   * fallback, then submission through the shared command path.
   */
  private async runDecision(
    ownerId: string,
    sessionId: string,
    snapshot: Quick6State,
    target: DecisionTarget,
  ): Promise<DecisionOutcome> {
    const phase = phaseToken(snapshot);
    const key = aiDecisionKey(phase, target.seat, target.purpose);

    // Receipt fast path: this decision was already applied in a previous
    // attempt of the same phase — replay, never re-decide.
    const existing = await this.repo.getActionReceipt(ownerId, sessionId, key);
    if (existing) {
      return { kind: "already-applied" };
    }

    const choices = legalChoices(snapshot).filter((choice) => choice.seat === target.seat);
    if (choices.length === 0) {
      return { kind: "discarded" };
    }
    const choiceIds = choices.map((choice) => choice.id);

    // Budget checks. The per-game budgets gate the provider strictly:
    // - HTTP attempts: pre-check plus the claim's own atomic check (a claim
    //   that would exceed the limit throws BUDGET_EXHAUSTED);
    // - logical calls: an atomic guarded reservation charged up front (a
    //   provider attempt that later fails still counts — failed attempts
    //   are charged), refunded only when the decision defers to a live
    //   worker that already holds the lease;
    // - tokens: pre-checked per decision start; the response usage is added
    //   afterwards.
    const providerConfigured = this.config.provider.enabled && this.engine.enabled;
    const budget = providerConfigured
      ? await this.store.getBudgetState(ownerId, sessionId)
      : null;
    const attemptsLeft =
      budget !== null &&
      budget.aiBudgetConsumed < Math.min(budget.aiBudgetLimit, this.config.game.maxHttpAttempts);
    const tokensLeft = budget !== null && budget.aiTokensConsumed < this.config.game.maxTokens;

    let command: Quick6Command | null = null;
    let source: "provider" | "fallback" = "fallback";

    if (providerConfigured && budget !== null && attemptsLeft && tokensLeft) {
      const reserved = await this.store.tryReserveLogicalCall(
        ownerId,
        sessionId,
        this.config.game.maxLogicalCalls,
      );
      if (reserved) {
        const turn = this.buildTurnInput(sessionId, snapshot, target);
        const outcome = await this.tryProviderDecision(ownerId, sessionId, target, phase, turn);
        if (outcome.kind === "deferred") {
          await this.store.refundLogicalCall(ownerId, sessionId);
          return { kind: "deferred" };
        }
        await this.store.addTokens(ownerId, sessionId, outcome.tokens);
        if (outcome.kind === "decision") {
          const candidate = decisionToCommand(outcome.decision, target.seat, choiceIds);
          if (candidate !== null) {
            command = candidate;
            source = "provider";
          }
        }
      }
    }

    if (command === null) {
      // Deterministic fallback: pure function of (seed, phaseToken, seat,
      // purpose) over the legal choice ids — reproducible and independent of
      // concurrent completion order. The seed comes only from the
      // SYSTEM-private store.
      const { seedBytes } = await this.repo.getSystemPrivate(ownerId, sessionId);
      const choiceId = deriveFallbackChoice(
        createQuick6Rng(seedBytes),
        phase,
        target.seat,
        target.purpose,
        choiceIds,
      );
      const label = choices.find((choice) => choice.id === choiceId)?.label ?? null;
      const candidate = fallbackToCommand(choiceId, label);
      if (candidate === null) {
        // Cannot happen for choice ids derived from the legal set.
        return { kind: "discarded" };
      }
      command = candidate;
    }

    // Submit through the shared command path. Sibling decisions of the same
    // batch append concurrently: a stale revision/phase token means another
    // submission landed between our load and our append, so retry the SAME
    // command against the fresh state (bounded — at most a few siblings can
    // interleave). A rejection means the phase moved on and the decision is
    // discarded, never applied.
    for (let attempt = 0; attempt < 8; attempt++) {
      const outcome = await this.executeCommand(ownerId, sessionId, key, command, null);
      switch (outcome.kind) {
        case "applied":
        case "replayed":
          return { kind: "applied", source };
        case "stale":
          continue; // fresh state next iteration; the command stays legal within the phase
        case "rejected":
          // Legal in the snapshot but rejected on the live state: the phase
          // moved under us. Discard — the next advance decides afresh.
          return { kind: "discarded" };
      }
    }
    return { kind: "discarded" };
  }

  /**
   * Provider attempts for one decision: claim (database-time lease) →
   * engine call strictly outside any transaction → complete under
   * (claimToken, generation). At most maxRetries transient retries; every
   * attempt (success, failure, timeout) is charged by the claim.
   */
  private async tryProviderDecision(
    ownerId: string,
    sessionId: string,
    target: DecisionTarget,
    phase: string,
    turn: AiTurnInput,
  ): Promise<ProviderOutcome> {
    const { maxRetries, timeoutMs, leaseTtlSeconds } = this.config.provider;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let lease;
      try {
        lease = await this.repo.claimAiLease(ownerId, sessionId, {
          seat: target.seat,
          phaseToken: phase,
          purpose: target.purpose,
          ttlSeconds: leaseTtlSeconds,
        });
      } catch (error) {
        if (error instanceof PersistenceError && error.code === "BUDGET_EXHAUSTED") {
          return { kind: "failed", tokens: 0, error };
        }
        throw error;
      }
      if (lease === null) {
        // A live lease is held by another worker: do not wait out the TTL
        // inside this call — the bounded advance defers and the client
        // retries later.
        return { kind: "deferred" };
      }

      let tokens = 0;
      try {
        const decision = await this.invokeWithTimeout(turn, (usage) => {
          tokens += usage.totalTokens;
        });
        await this.repo.completeAiRun(ownerId, sessionId, {
          seat: target.seat,
          phaseToken: phase,
          purpose: target.purpose,
          claimToken: lease.claimToken,
          generation: lease.generation,
          status: "succeeded",
          result: { output: decision },
        });
        return { kind: "decision", decision, tokens };
      } catch (error) {
        const timedOut = isTimeoutError(error);
        const message = error instanceof Error ? error.message : String(error);
        try {
          await this.repo.completeAiRun(ownerId, sessionId, {
            seat: target.seat,
            phaseToken: phase,
            purpose: target.purpose,
            claimToken: lease.claimToken,
            generation: lease.generation,
            status: timedOut ? "timeout" : "failed",
            error: message,
          });
        } catch (stale) {
          if (!(stale instanceof PersistenceError && stale.code === "STALE_LEASE")) {
            throw stale;
          }
          // The lease expired or was reclaimed mid-call: the result is
          // discarded (never applied). Treated as a failed attempt.
        }
        // Only transient failures (429 / 5xx / network) are retried, at
        // most maxRetries times; timeouts and every malformed/illegal/
        // filtered response fall back immediately.
        if (isTransient(error) && attempt < maxRetries) {
          continue;
        }
        return { kind: "failed", tokens, error };
      }
    }
    return { kind: "failed", tokens: 0, error: new AiProviderError("NETWORK", "provider gave up") };
  }

  /** The engine call with the single per-attempt timeout, outside any tx. */
  private async invokeWithTimeout(
    turn: AiTurnInput,
    onUsage: (usage: { readonly totalTokens: number }) => void,
  ): Promise<AiDecision> {
    assertNoOpenTransaction("decision engine call");
    const timeoutMs = this.config.provider.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([
        this.engine.decide(turn, AbortSignal.timeout(timeoutMs), onUsage),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The minimal authorized provider turn: exactly viewFor(seat) (the single
   * forward projector — never the full state), the bounded public history
   * and the engine's legal choice set.
   */
  private buildTurnInput(sessionId: string, state: Quick6State, target: DecisionTarget): AiTurnInput {
    const phase = state.phase as AiPhase;
    const view = this.definition.viewFor(state, target.seat);
    const choices: LegalChoiceRef[] = legalChoices(state).map((choice) => ({
      id: choice.id,
      seat: choice.seat,
      label: choice.label,
    }));
    return {
      gameId: sessionId,
      seat: target.seat,
      phase,
      view,
      history: publicHistoryOf(state),
      legalChoices: choices,
    };
  }

  /** Event-stream replay for the repository (contiguous seq enforced). */
  private readonly replay = (
    seedBytes: Uint8Array,
    options: unknown,
    events: readonly PersistedEvent[],
  ): Quick6State =>
    replayQuick6(
      seedBytes,
      events.map((event, index) => {
        if (event.seq !== index) {
          throw new Error(`non-contiguous persisted event seq ${event.seq} at position ${index}`);
        }
        return {
          index: event.seq,
          revision: event.revision,
          payload: event.payload as Quick6EventPayload,
        };
      }),
      options as Quick6StartOptions | undefined,
    );
}
