/**
 * Shared Route Handler plumbing for the game API (P5.1): Auth.js session
 * checks, the same-origin guard for cookie-authenticated writes, strict
 * JSON body reading (Content-Type + size), user-level rate limiting and
 * the generalized error mapping.
 *
 * Invariants:
 * - Every handler explicitly checks session.user.id; nothing is trusted
 *   from the request beyond it (the acting seat is resolved server-side).
 * - Non-owner and non-existent sessions are indistinguishable: every
 *   handler maps both to the same 404 body.
 * - Error bodies carry ONLY the public vocabulary (protocol.ts) — internal
 *   persistence codes, provider names and stack details never leave the
 *   server (they are logged, not sent).
 * - 429 is used only for user-level create/action frequency limits and the
 *   per-session advance concurrency limit. 502 is reserved for genuinely
 *   unrecoverable infrastructure failures (database connectivity).
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PersistenceError } from "@/lib/games/core";
import { getApiConfig } from "./config";
import { getAdvanceGuard, getRateLimiter } from "./limits";
import { PUBLIC_ERRORS } from "./protocol";

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A generalized JSON error; `extra` carries only public protocol fields. */
export function jsonError(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers });
}

/** The uniform 404 — identical for non-owner and non-existent sessions. */
export function notFoundResponse(): NextResponse {
  return jsonError(404, PUBLIC_ERRORS.notFound);
}

/** Persistence errors → HTTP, without leaking internal codes into bodies. */
export function mapPersistenceError(error: unknown): NextResponse | null {
  if (!(error instanceof PersistenceError)) return null;
  switch (error.code) {
    case "NOT_FOUND":
    case "VERSION_MISMATCH":
      // An unreadable session (absent, foreign, or served by a different
      // version) is the same 404 to the client — no enumeration signal.
      return notFoundResponse();
    case "NOT_ACTIVE":
      return jsonError(409, PUBLIC_ERRORS.sessionNotActive);
    default:
      return internalErrorResponse(error);
  }
}

/** The unexpected-error fallback: log server-side, generalize the body. */
export function internalErrorResponse(error: unknown): NextResponse {
  // Server-side log only — the message never reaches the client body.
  console.error("[games-api] internal error:", error);
  if (isInfrastructureError(error)) {
    return jsonError(502, PUBLIC_ERRORS.serviceUnavailable);
  }
  return jsonError(500, PUBLIC_ERRORS.internalError);
}

/**
 * Genuinely unrecoverable infrastructure failures (database connectivity):
 * connection-refused/reset, broken pipes and terminated connections. This
 * is the ONLY thing 502 is reserved for — provider failures are absorbed
 * by the application fallback long before this layer.
 *
 * postgres.js wraps the underlying socket error as `Error: Failed query:
 * …` with the real code on `.cause` (and batches into AggregateError for
 * multi-host connects), so the check walks the whole cause/errors chain
 * instead of trusting the top-level message.
 */
const INFRASTRUCTURE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ESHUTDOWN",
]);

const INFRASTRUCTURE_MESSAGE =
  /connection (terminated|refused|reset|closed)|connect econ|socket hang up/i;

function isInfrastructureError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (node: unknown): boolean => {
    if (node === null || node === undefined || typeof node !== "object" || seen.has(node)) {
      return false;
    }
    seen.add(node);
    const record = node as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (record.code !== undefined && INFRASTRUCTURE_CODES.has(String(record.code))) {
      return true;
    }
    if (record.message !== undefined && INFRASTRUCTURE_MESSAGE.test(String(record.message))) {
      return true;
    }
    if (record.cause !== undefined && record.cause !== node && visit(record.cause)) {
      return true;
    }
    if (Array.isArray(record.errors)) {
      for (const item of record.errors) {
        if (visit(item)) return true;
      }
    }
    return false;
  };
  return visit(error);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthenticatedUser {
  readonly userId: string;
}

/** session.user.id must exist — every handler checks it explicitly. */
export async function requireUser(): Promise<AuthenticatedUser | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, PUBLIC_ERRORS.unauthorized);
  }
  return { userId: session.user.id };
}

// ---------------------------------------------------------------------------
// Same-origin guard (cookie-authenticated writes)
// ---------------------------------------------------------------------------

/**
 * Cookie-authenticated write requests must be same-origin: an `Origin`
 * header that does not match the request's own origin, or an explicit
 * `Sec-Fetch-Site: cross-site`, is refused. Requests without an Origin
 * (non-browser clients) pass — the cookie itself is the bearer there.
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site === "cross-site") {
    return jsonError(403, PUBLIC_ERRORS.crossOriginForbidden);
  }
  const origin = req.headers.get("origin");
  if (origin === null || origin === "") return null;
  if (origin === "null") {
    // Sandboxed/opaque origin: never a normal same-origin request.
    return jsonError(403, PUBLIC_ERRORS.crossOriginForbidden);
  }
  return origin === requestOrigin(req)
    ? null
    : jsonError(403, PUBLIC_ERRORS.crossOriginForbidden);
}

function requestOrigin(req: Request): string {
  // The route-handler Request normally carries the absolute URL. The
  // standalone production server, however, constructs it against a dummy
  // base ("http://n/...") because no initURL metadata is attached — the
  // Host header is the true request target there, so fall back to it when
  // the URL's authority is not a real host.
  try {
    const url = new URL(req.url);
    if (url.host !== "n" && url.host !== "") {
      return `${url.protocol}//${url.host}`;
    }
  } catch {
    // Relative URL: no authority to compare — use the Host header.
  }
  const host = req.headers.get("host");
  if (host === null || host === "") return "";
  const protocol = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// JSON bodies: Content-Type + size + parse
// ---------------------------------------------------------------------------

export type JsonBodyResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * Read and parse a JSON body under the P5.1 rules: Content-Type must be
 * application/json (or a +json media type) when required, the body must fit
 * the byte cap, and the payload must parse. An empty body is `{}` (the
 * advance endpoint allows it; the Zod schemas then reject what must carry
 * fields).
 */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
  requireContentType = true,
): Promise<JsonBodyResult> {
  const contentType = req.headers.get("content-type");
  if (contentType !== null) {
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (mime !== "application/json" && !mime.endsWith("+json")) {
      return { ok: false, status: 415, error: PUBLIC_ERRORS.unsupportedMediaType };
    }
  } else if (requireContentType) {
    return { ok: false, status: 415, error: PUBLIC_ERRORS.unsupportedMediaType };
  }

  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, status: 413, error: PUBLIC_ERRORS.payloadTooLarge };
    }
  }

  const text = await req.text().catch(() => null);
  if (text === null) {
    return { ok: false, status: 400, error: PUBLIC_ERRORS.invalidBody };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, status: 413, error: PUBLIC_ERRORS.payloadTooLarge };
  }
  if (text.trim() === "") {
    return { ok: true, data: {} };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: PUBLIC_ERRORS.invalidBody };
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (the only sanctioned 429s)
// ---------------------------------------------------------------------------

/**
 * User-level frequency limit. Counts every authenticated request that
 * passed parsing — the limiter runs BEFORE business logic so the boundary
 * is observable regardless of the outcome (409, 404, …).
 */
export function enforceRateLimit(
  userId: string,
  kind: "create" | "action",
): NextResponse | null {
  const config = getApiConfig();
  const limit = kind === "create" ? config.rate.createPerMinute : config.rate.actionPerMinute;
  const limiter = getRateLimiter();
  const key = `${kind}:${userId}`;
  if (limiter.allow(key, limit)) return null;
  const retryAfterMs = limiter.retryAfterMs(key);
  return jsonError(
    429,
    PUBLIC_ERRORS.rateLimited,
    { retryAfterMs },
    { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
  );
}

/** Per-session advance concurrency: one in flight, the rest 429. */
export function tryAcquireAdvance(sessionId: string): NextResponse | null {
  const guard = getAdvanceGuard(getApiConfig().advanceConcurrency);
  if (guard.tryAcquire(sessionId)) return null;
  return jsonError(
    429,
    PUBLIC_ERRORS.advanceInProgress,
    { retryAfterMs: 250 },
    { "Retry-After": "1" },
  );
}

/** Release a held advance slot (always paired with tryAcquireAdvance). */
export function releaseAdvance(sessionId: string): void {
  getAdvanceGuard(getApiConfig().advanceConcurrency).release(sessionId);
}
