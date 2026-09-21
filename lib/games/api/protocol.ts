/**
 * P5.1 player view protocol: the session envelope and the public error
 * vocabulary — the ONLY strings error bodies may ever carry.
 *
 * The envelope contains exactly the player-visible facts: the projected
 * view (the single forward projector), the own-seat legal action set, the
 * CAS revision/phaseToken, the generalized status and the visible event
 * increments. The server state, internal sub-phases, pending AI seats,
 * provider details and internal error codes never appear in any response,
 * HTML/RSC payload or error body.
 */
import type { PlayerViewResult } from "@/lib/games/orchestration/service";
import { QUICK6_DEFINITION_ID } from "@/lib/games/werewolf/versions";

export type SessionStatus = "active" | "finished" | "aborted" | "abandoned";

/**
 * The public wire id for the shipped quick6 definition. The frozen P1
 * definition keeps its internal id ("quick6") in rows, snapshots and
 * checksums; the API protocol (docs/game-api-protocol.md) only ever speaks
 * the public alias. All envelopes and list responses map outward, and the
 * lobby filter maps inward — the internal id never crosses the wire.
 */
export const PUBLIC_GAME_DEFINITION_ID = "quick6-v1" as const;

const DEFINITION_ID_ALIASES: Readonly<Record<string, string>> = {
  [QUICK6_DEFINITION_ID]: PUBLIC_GAME_DEFINITION_ID,
};

export function toPublicDefinitionId(internalId: string): string {
  return DEFINITION_ID_ALIASES[internalId] ?? internalId;
}

export function toInternalDefinitionId(publicId: string): string {
  for (const [internalId, alias] of Object.entries(DEFINITION_ID_ALIASES)) {
    if (alias === publicId) return internalId;
  }
  return publicId;
}

/** The only response shape the game API produces. */
export interface SessionEnvelope {
  readonly sessionId: string;
  readonly gameDefinitionId: string;
  /** Generalized status — never internal sub-phases or pending seats. */
  readonly status: SessionStatus;
  readonly revision: number;
  /** The phase token AFTER this response (the next CAS baseline). */
  readonly phaseToken: string;
  /** The owner's own seat view through the single forward projector. */
  readonly projectView: unknown;
  /** The own-seat legal choice set (system settlements excluded). */
  readonly legalActions: readonly { readonly id: string; readonly label: string }[];
  /** Public events with revision > the client's `since` (visible increments). */
  readonly increments: readonly unknown[];
  /** True when the advance left work running: retry after retryAfterMs. */
  readonly pending: boolean;
  readonly retryAfterMs: number;
}

export function buildSessionEnvelope(
  view: PlayerViewResult,
  opts: { readonly pending?: boolean; readonly retryAfterMs?: number } = {},
): SessionEnvelope {
  return {
    sessionId: view.sessionId,
    gameDefinitionId: toPublicDefinitionId(view.gameDefinitionId),
    status: view.status,
    revision: view.revision,
    phaseToken: view.phaseToken,
    projectView: view.view,
    legalActions: view.legalActions,
    increments: view.events,
    pending: opts.pending ?? false,
    retryAfterMs: opts.retryAfterMs ?? 0,
  };
}

/** The action response: the envelope plus the idempotency receipt flag. */
export interface ActionEnvelope extends SessionEnvelope {
  /** false when the receipt replayed the stored response (applied once). */
  readonly applied: boolean;
}

/** The public, generalized error vocabulary (see docs/game-api-protocol.md). */
export const PUBLIC_ERRORS = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  crossOriginForbidden: "cross_origin_forbidden",
  notFound: "not_found",
  invalidBody: "invalid_body",
  unsupportedMediaType: "unsupported_media_type",
  payloadTooLarge: "payload_too_large",
  rateLimited: "rate_limited",
  advanceInProgress: "advance_in_progress",
  activeSessionExists: "active_session_exists",
  /** P6.3: the owner's daily game-creation budget is exhausted (429). */
  dailyLimitExceeded: "daily_limit_exceeded",
  stale: "stale",
  revisionConflict: "revision_conflict",
  phaseConflict: "phase_conflict",
  illegalAction: "illegal_action",
  idempotencyConflict: "idempotency_conflict",
  sessionNotActive: "session_not_active",
  invalidStart: "invalid_start",
  invalidGameDefinition: "invalid_game_definition",
  internalError: "internal_error",
  serviceUnavailable: "service_unavailable",
} as const;
