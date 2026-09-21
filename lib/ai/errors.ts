/**
 * Stable AI-boundary domain errors (P3.3 contract, lib/ai/README.md §5).
 *
 * Every failure path of an {@link AiDecisionProvider} terminates in exactly
 * one {@link AiProviderError} with a stable `code`. Callers map on the code,
 * never on message text. `retryable` is the single source of truth for the
 * retry classification: only 429, 5xx and transient network failures are
 * retryable (limited retries), everything else fails fast — in particular
 * 400/401/402/422, timeouts, caller aborts and every malformed response.
 */

/** Stable error codes of the AI boundary. */
export type AiErrorCode =
  /** Server configuration is missing or invalid (key/model/HMAC secret/…). */
  | "CONFIG"
  /** Input violates the minimal-authorization contract (§3). */
  | "INPUT_REJECTED"
  /** HTTP 400/422: our request was malformed. Never retried. */
  | "INVALID_REQUEST"
  /** HTTP 401/403: credential rejected. Never retried. */
  | "AUTH_REQUIRED"
  /** HTTP 402: payment required. Never retried. */
  | "PAYMENT_REQUIRED"
  /** HTTP 429: rate limited. Limited retries, honoring Retry-After. */
  | "RATE_LIMITED"
  /** HTTP 5xx: upstream unavailable. Limited retries. */
  | "UPSTREAM_UNAVAILABLE"
  /** Transient transport failure (DNS/TCP/TLS). Limited retries. */
  | "NETWORK"
  /** Server-side timeout elapsed. Never retried. */
  | "TIMEOUT"
  /** The caller's AbortSignal fired. Never retried. */
  | "ABORTED"
  /** 2xx response with an empty body. Never retried. */
  | "EMPTY_RESPONSE"
  /** Body is invalid JSON, violates the schema, or the envelope is wrong. */
  | "BAD_RESPONSE"
  /** Provider marked the response incomplete/truncated. Never retried. */
  | "INCOMPLETE_RESPONSE"
  /** Provider refused the request (content_filter / refusal). Never retried. */
  | "CONTENT_FILTERED"
  /** Returned choice_id is not in the seat's authorized choice set (§4). */
  | "ILLEGAL_CHOICE"
  /** Returned utterance exceeds the length cap (§4). Never retried. */
  | "UTTERANCE_TOO_LONG"
  /**
   * The serialized prompt would exceed the frozen 24KiB budget (P6.3).
   * Never sent, never retried: the orchestration falls back deterministically.
   */
  | "PROMPT_TOO_LARGE";

/** Codes that are ever retried (with a limited retry budget). */
export const RETRYABLE_CODES: ReadonlySet<AiErrorCode> = new Set([
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "NETWORK",
]);

/**
 * Stable domain error of the AI boundary. `code` is stable; `detail` is a
 * short sanitized hint for humans only (never a key, PII, prompt content or
 * full server state — see lib/ai/README.md §8).
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly detail: string | null;

  constructor(
    code: AiErrorCode,
    message: string,
    options: {
      readonly httpStatus?: number | null;
      readonly detail?: string | null;
      readonly cause?: unknown;
      /** Override (only to mark an unexpected upstream status non-retryable). */
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AiProviderError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.detail = options.detail ?? null;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}
