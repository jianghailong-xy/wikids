import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  advanceBodySchema,
  assertSameOrigin,
  buildSessionEnvelope,
  createApiGameService,
  enforceRateLimit,
  getApiConfig,
  internalErrorResponse,
  jsonError,
  mapPersistenceError,
  notFoundResponse,
  PUBLIC_ERRORS,
  readJsonBody,
  releaseAdvance,
  requireUser,
  tryAcquireAdvance,
  uuidSchema,
} from "@/lib/games/api";

export const runtime = "nodejs";

/**
 * Bounded advance: at most one frozen batch of external AI decisions plus
 * one deterministic settlement (P4.1). When work remains the response is
 * 202 with pending/retryAfterMs — the client calls again; this handler
 * never loops until the game is over. At most one advance runs per session
 * (concurrent calls get the stable 429 advance_in_progress). Provider
 * failures are absorbed by the application fallback and never surface
 * here.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const crossOrigin = assertSameOrigin(req);
  if (crossOrigin) return crossOrigin;

  const rate = enforceRateLimit(user.userId, "action");
  if (rate) return rate;

  const { sessionId } = await params;
  if (!uuidSchema.safeParse(sessionId).success) {
    return notFoundResponse();
  }

  // The advance body is optional; an empty body is the default request.
  const body = await readJsonBody(req, getApiConfig().body.maxBytes, false);
  if (!body.ok) return jsonError(body.status, body.error);
  const parsed = advanceBodySchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, PUBLIC_ERRORS.invalidBody);
  }
  const sinceRevision = parsed.data.sinceRevision;

  const blocked = tryAcquireAdvance(sessionId);
  if (blocked) return blocked;
  try {
    const { service } = createApiGameService(db);
    const result = await service.advance(user.userId, sessionId);
    const view = await service.getPlayerView(user.userId, sessionId, { sinceRevision });
    switch (result.status) {
      case "pending": {
        const envelope = buildSessionEnvelope(view, {
          pending: true,
          retryAfterMs: result.retryAfterMs,
        });
        return NextResponse.json(envelope, {
          status: 202,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
          },
        });
      }
      case "finished":
      case "aborted":
      case "waiting_for_human":
        return NextResponse.json(buildSessionEnvelope(view));
    }
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  } finally {
    releaseAdvance(sessionId);
  }
}
