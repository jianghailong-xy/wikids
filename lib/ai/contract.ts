/**
 * P3.3 structured AI-turn contract (lib/ai/README.md).
 *
 * The AI boundary is a replaceable port: {@link AiDecisionProvider}. A
 * provider receives exactly the minimal authorized facts the caller chose
 * to hand it — the projected view, the public history and the legal choice
 * set — and returns exactly a `{ choiceId, utterance }` decision. The full
 * server state, seeds, hidden roles, night buffers and any identity data
 * (names, emails) are outside the contract and are never serialized into a
 * provider request; the returned choice is re-verified by the rule engine
 * before it can become a command (§2, §4).
 *
 * This module is pure TypeScript (no node/Next imports): it defines the
 * contract, validates inputs and builds the per-phase JSON schema.
 */
import { AiProviderError } from "./errors";

// ---------------------------------------------------------------------------
// Frozen constants
// ---------------------------------------------------------------------------

/** Upper bound for a returned utterance, in characters (§4). */
export const MAX_UTTERANCE_CHARS = 500;
/** Hard ceiling for max_output_tokens; every config value is clamped to it. */
export const MAX_OUTPUT_TOKENS_CAP = 2048;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Response bodies larger than this are rejected unread (BAD_RESPONSE). */
export const MAX_RESPONSE_BYTES = 1_048_576;
/** Input bounds: game id length, seats, history/choice counts. */
export const MAX_GAME_ID_CHARS = 128;
export const MAX_SEAT = 63;
export const MAX_HISTORY_ITEMS = 500;
export const MAX_LEGAL_CHOICES = 100;
export const MAX_CHOICE_ID_CHARS = 200;
export const MAX_CHOICE_LABEL_CHARS = 200;

// ---------------------------------------------------------------------------
// Input contract (§3)
// ---------------------------------------------------------------------------

/** Phases a decision may be requested in. END is not a decision phase. */
export type AiPhase = "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE";
export const AI_PHASES: ReadonlySet<string> = new Set(["NIGHT", "DAY_DISCUSSION", "DAY_VOTE"]);

/** A minimal legal-choice reference: stable id, acting seat, display label. */
export interface LegalChoiceRef {
  readonly id: string;
  /** Acting seat; `null` for system/settlement choices (never authorized). */
  readonly seat: number | null;
  readonly label: string;
}

/** Closed public-history item union; unknown kinds/fields are rejected. */
export type PublicHistoryItem =
  | { readonly kind: "phase"; readonly round: number; readonly phase: string }
  | { readonly kind: "elimination"; readonly round: number; readonly by: "NIGHT_KILL" | "DAY_EXILE"; readonly seat: number }
  | { readonly kind: "speech"; readonly round: number; readonly seat: number; readonly text: string | null }
  | { readonly kind: "vote"; readonly round: number; readonly seat: number; readonly target: number }
  | { readonly kind: "outcome"; readonly winner: string; readonly reason: string };

/** View scopes a provider may receive. SYSTEM is rejected outright (§3). */
export type AuthorizedViewScope = "PUBLIC" | "POST_GAME" | "PLAYER" | "TEAM_WOLVES";
export const AUTHORIZED_VIEW_SCOPES: ReadonlySet<string> = new Set([
  "PUBLIC",
  "POST_GAME",
  "PLAYER",
  "TEAM_WOLVES",
]);

/**
 * The minimal authorized projection a provider may receive. All fields are
 * optional duck-types: the provider validates what is present and serializes
 * ONLY the fields listed here — anything else on the object (state, seed,
 * roles, names, emails, …) is rejected or dropped and can never reach the
 * provider payload (§3).
 */
export interface AuthorizedView {
  readonly scope: AuthorizedViewScope;
  // Public facts.
  readonly phase?: string;
  readonly round?: number;
  readonly seats?: readonly number[];
  readonly aliveSeats?: readonly number[];
  readonly humanSeat?: number;
  readonly eliminations?: readonly unknown[];
  readonly speeches?: readonly unknown[];
  readonly votes?: readonly unknown[];
  readonly outcome?: { readonly winner: string; readonly reason: string } | null;
  readonly rolesRevealed?: readonly string[] | null;
  // Seat-scoped facts; legal only for scope PLAYER / TEAM_WOLVES, and the
  // seat must equal the requesting seat.
  readonly seat?: number;
  readonly ownRole?: string;
  readonly wolfTeammates?: readonly number[];
  readonly seerChecks?: readonly unknown[];
  readonly ownNightSubmission?: { readonly target: number } | null;
}

/** The exact top-level input keys a provider accepts (§3). */
export const INPUT_KEYS: ReadonlySet<string> = new Set([
  "gameId",
  "seat",
  "phase",
  "view",
  "history",
  "legalChoices",
]);

export interface AiTurnInput {
  /** Opaque server game id; used only to derive the anonymous user id (§6). */
  readonly gameId: string;
  /** The deciding seat; only choices with `seat === this` are authorized. */
  readonly seat: number;
  /** Decision phase; selects the per-phase JSON schema (§4). */
  readonly phase: AiPhase;
  /** Minimal authorized projection (never a SYSTEM view / full state). */
  readonly view: AuthorizedView;
  /** Public history (closed union; unknown items are rejected). */
  readonly history: readonly PublicHistoryItem[];
  /** The engine's legal choice set; the provider forwards it and re-checks. */
  readonly legalChoices: readonly LegalChoiceRef[];
}

// ---------------------------------------------------------------------------
// Output contract (§4)
// ---------------------------------------------------------------------------

/** The only thing a provider returns: a choice id plus a bounded utterance. */
export interface AiDecision {
  readonly choiceId: string;
  readonly utterance: string;
}

/**
 * The replaceable provider port. Implementations are server-only and
 * swappable (the DeepSeek implementation is one; tests and scripted bots
 * substitute others). The domain layer depends only on this interface.
 */
export interface AiDecisionProvider {
  decide(input: AiTurnInput, signal?: AbortSignal): Promise<AiDecision>;
}

// ---------------------------------------------------------------------------
// Observability contract (§7)
// ---------------------------------------------------------------------------

/**
 * Exactly the dimensions a provider logs per attempt. Field values come
 * from the provider response envelope only — never the prompt, the key,
 * PII or any reasoning content. `systemFingerprint` is the literal
 * "unavailable" when the response carries none.
 */
export interface AiLogRecord {
  readonly requestedModel: string;
  readonly responseModel: string | null;
  readonly responseId: string | null;
  readonly httpStatus: number | null;
  readonly apiStatus: string | null;
  readonly systemFingerprint: string;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reasoningTokens: number | null;
}

/** Sink for {@link AiLogRecord}s. Implementations must not log anything else. */
export interface AiLogger {
  log(record: AiLogRecord): void;
}

/** The exact field set an {@link AiLogRecord} may carry. */
export const LOG_RECORD_KEYS: ReadonlySet<string> = new Set([
  "requestedModel",
  "responseModel",
  "responseId",
  "httpStatus",
  "apiStatus",
  "systemFingerprint",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
]);

// ---------------------------------------------------------------------------
// Input validation (§3)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(detail: string): never {
  throw new AiProviderError("INPUT_REJECTED", `AI input rejected: ${detail}`, { detail });
}

function assertSeat(value: unknown, what: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_SEAT) {
    reject(`${what} must be an integer in 0..${MAX_SEAT}, got ${JSON.stringify(value)}`);
  }
}

/**
 * Validates a caller-supplied turn input against the minimal-authorization
 * contract. Throws {@link AiProviderError} with code INPUT_REJECTED — with
 * the input fully unused — on the first violation.
 */
export function assertAiTurnInput(input: unknown): asserts input is AiTurnInput {
  if (!isPlainObject(input)) reject("input must be a plain object");
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) reject(`unexpected input field: ${key}`);
  }
  const { gameId, seat, phase, view, history, legalChoices } = input;
  if (typeof gameId !== "string" || gameId.length === 0 || gameId.length > MAX_GAME_ID_CHARS) {
    reject("gameId must be a non-empty string of at most " + MAX_GAME_ID_CHARS + " chars");
  }
  assertSeat(seat, "seat");
  if (typeof phase !== "string" || !AI_PHASES.has(phase)) {
    reject(`phase must be one of ${[...AI_PHASES].join("/")} (END is not a decision phase)`);
  }
  if (!isPlainObject(view)) reject("view must be a plain object");
  if (typeof view.scope !== "string" || !AUTHORIZED_VIEW_SCOPES.has(view.scope)) {
    reject("view.scope must be PUBLIC/POST_GAME/PLAYER/TEAM_WOLVES (SYSTEM is never accepted)");
  }
  if ("state" in view) reject("view must not carry the full server state");
  const seatScoped = view.scope === "PLAYER" || view.scope === "TEAM_WOLVES";
  if (seatScoped && view.seat !== seat) {
    reject("view.seat must equal the requesting seat for seat-scoped views");
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY_ITEMS) {
    reject(`history must be an array of at most ${MAX_HISTORY_ITEMS} items`);
  }
  for (const item of history) {
    if (!isPlainObject(item) || typeof item.kind !== "string") reject("each history item needs a kind");
    switch (item.kind) {
      case "phase":
        if (typeof item.round !== "number" || typeof item.phase !== "string") reject("bad history item: phase");
        break;
      case "elimination":
        if (
          typeof item.round !== "number" ||
          (item.by !== "NIGHT_KILL" && item.by !== "DAY_EXILE") ||
          typeof item.seat !== "number"
        ) {
          reject("bad history item: elimination");
        }
        break;
      case "speech":
        if (
          typeof item.round !== "number" ||
          typeof item.seat !== "number" ||
          (item.text !== null && typeof item.text !== "string")
        ) {
          reject("bad history item: speech");
        }
        break;
      case "vote":
        if (
          typeof item.round !== "number" ||
          typeof item.seat !== "number" ||
          typeof item.target !== "number"
        ) {
          reject("bad history item: vote");
        }
        break;
      case "outcome":
        if (typeof item.winner !== "string" || typeof item.reason !== "string") {
          reject("bad history item: outcome");
        }
        break;
      default:
        reject(`unknown history item kind: ${item.kind}`);
    }
  }
  if (!Array.isArray(legalChoices) || legalChoices.length === 0 || legalChoices.length > MAX_LEGAL_CHOICES) {
    reject("legalChoices must be a non-empty array of at most " + MAX_LEGAL_CHOICES + " items");
  }
  for (const choice of legalChoices) {
    if (!isPlainObject(choice)) reject("each legal choice must be a plain object");
    if (typeof choice.id !== "string" || choice.id.length === 0 || choice.id.length > MAX_CHOICE_ID_CHARS) {
      reject("each legal choice needs a non-empty id string");
    }
    if (choice.seat !== null) assertSeat(choice.seat, "choice.seat");
    if (typeof choice.label !== "string" || choice.label.length > MAX_CHOICE_LABEL_CHARS) {
      reject("each legal choice needs a label string");
    }
  }
}

/**
 * The subset of `legalChoices` the requesting seat may take: exactly the
 * choices with `seat === input.seat`. Settlement choices (seat === null)
 * and every other seat's choices are never authorized for a provider turn.
 * Throws INPUT_REJECTED when the seat has nothing it may take.
 */
export function authorizedChoices(input: AiTurnInput): readonly LegalChoiceRef[] {
  const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
  if (own.length === 0) {
    reject(`no legal choice is authorized for seat ${input.seat}`);
  }
  return own;
}

// ---------------------------------------------------------------------------
// View whitelist serialization (§3 — zero leak by construction)
// ---------------------------------------------------------------------------

const PUBLIC_VIEW_KEYS: ReadonlySet<string> = new Set([
  "phase",
  "round",
  "seats",
  "aliveSeats",
  "humanSeat",
  "eliminations",
  "speeches",
  "votes",
  "outcome",
  "rolesRevealed",
]);

const SEAT_VIEW_KEYS: ReadonlySet<string> = new Set([
  "seat",
  "ownRole",
  "wolfTeammates",
  "seerChecks",
  "ownNightSubmission",
]);

/** View fields a provider may receive, per scope. `scope` itself is re-emitted. */
export const ALLOWED_VIEW_KEYS: ReadonlySet<string> = new Set([
  "scope",
  ...PUBLIC_VIEW_KEYS,
  ...SEAT_VIEW_KEYS,
]);

/**
 * Picks exactly the whitelisted view facts for the requesting seat. Field
 * names outside the whitelist — `state`, `seedBytes`, `roles`, `alive`,
 * night buffers, names, emails, anything — are rejected (top-level unknown
 * fields) and can therefore never be serialized into a provider request.
 * Seat-scoped fields are only honored when the view seat matches.
 */
export function pickViewFacts(view: AuthorizedView, seat: number): Record<string, unknown> {
  const source = view as unknown as Record<string, unknown>;
  const scope = view.scope;
  for (const key of Object.keys(source)) {
    if (!ALLOWED_VIEW_KEYS.has(key)) reject(`view carries an unauthorized field: ${key}`);
    if (!seatScopedScope(scope) && SEAT_VIEW_KEYS.has(key)) {
      reject(`view field ${key} requires a seat-scoped view`);
    }
  }
  const facts: Record<string, unknown> = { scope };
  for (const key of PUBLIC_VIEW_KEYS) {
    if (key in source) facts[key] = source[key];
  }
  if (seatScopedScope(scope)) {
    facts.seat = seat;
    for (const key of SEAT_VIEW_KEYS) {
      if (key in source) facts[key] = source[key];
    }
  }
  return facts;
}

function seatScopedScope(scope: AuthorizedViewScope): boolean {
  return scope === "PLAYER" || scope === "TEAM_WOLVES";
}

// ---------------------------------------------------------------------------
// Per-phase JSON schema (§4)
// ---------------------------------------------------------------------------

/**
 * Frozen per-phase schema name for `text.format.json_schema` (§4). The
 * schema name is part of the contract: bump the suffix on shape changes.
 */
export function decisionSchemaName(phase: AiPhase): string {
  switch (phase) {
    case "NIGHT":
      return "decision_night_v1";
    case "DAY_DISCUSSION":
      return "decision_day_discussion_v1";
    case "DAY_VOTE":
      return "decision_day_vote_v1";
  }
}

/**
 * The per-phase decision schema handed to the provider in
 * `text.format = { type: "json_schema", strict: true, … }`. The `choice_id`
 * enum is exactly the requesting seat's authorized choice ids, so a choice
 * outside the set is structurally impossible and — should it still appear —
 * is rejected at parse time (ILLEGAL_CHOICE, §4). `additionalProperties:
 * false` pins the object to exactly `{ choice_id, utterance }`.
 */
export function buildDecisionSchema(
  phase: AiPhase,
  choiceIds: readonly string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      choice_id: { type: "string", enum: [...choiceIds] },
      utterance: { type: "string", maxLength: MAX_UTTERANCE_CHARS },
    },
    required: ["choice_id", "utterance"],
    additionalProperties: false,
  };
}

/**
 * The two-and-only-two decision fields. Any other field on the parsed
 * object — a memory patch or anything else — is rejected (§4).
 */
export const DECISION_KEYS: ReadonlySet<string> = new Set(["choice_id", "utterance"]);

/**
 * Parses and strictly validates a provider decision object. Throws
 * {@link AiProviderError} with code BAD_RESPONSE (shape), ILLEGAL_CHOICE
 * (id outside the authorized set — it can never become a command) or
 * UTTERANCE_TOO_LONG. Returns the decision only when it is exactly
 * `{ choice_id, utterance }` with a legal choice id.
 */
export function parseDecision(
  raw: unknown,
  authorizedIds: ReadonlySet<string>,
): AiDecision {
  if (!isPlainObject(raw)) {
    throw new AiProviderError("BAD_RESPONSE", "decision is not a JSON object");
  }
  for (const key of Object.keys(raw)) {
    if (!DECISION_KEYS.has(key)) {
      throw new AiProviderError("BAD_RESPONSE", `decision carries an unexpected field: ${key}`, {
        detail: `unexpected field: ${key}`,
      });
    }
  }
  const { choice_id, utterance } = raw;
  if (typeof choice_id !== "string") {
    throw new AiProviderError("BAD_RESPONSE", "decision choice_id is not a string");
  }
  if (typeof utterance !== "string") {
    throw new AiProviderError("BAD_RESPONSE", "decision utterance is not a string");
  }
  if (!authorizedIds.has(choice_id)) {
    throw new AiProviderError("ILLEGAL_CHOICE", `choice_id is not authorized: ${choice_id}`, {
      detail: `unauthorized choice_id: ${choice_id}`,
    });
  }
  if (utterance.length > MAX_UTTERANCE_CHARS) {
    throw new AiProviderError("UTTERANCE_TOO_LONG", `utterance exceeds ${MAX_UTTERANCE_CHARS} chars`);
  }
  return { choiceId: choice_id, utterance };
}
