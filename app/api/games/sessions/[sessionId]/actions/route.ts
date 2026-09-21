import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  actionBodySchema,
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
  requireUser,
  uuidSchema,
} from "@/lib/games/api";
import type { ActionEnvelope } from "@/lib/games/api";
import type { Quick6Command } from "@/lib/games/werewolf";

export const runtime = "nodejs";

/**
 * Submit one action for the owner's own seat. The acting seat is resolved
 * server-side (the request may never act for another seat); the command
 * carries the client idempotency key plus the expectedRevision / phaseToken
 * CAS baseline. Applied exactly once, or replayed from the stored receipt.
 * The envelope is built from a fresh player view after the apply, so the
 * revision/phaseToken are the true current CAS baseline and the increments
 * cover every event the client has not seen (interleaved settlements
 * included).
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

  const body = await readJsonBody(req, getApiConfig().body.maxBytes);
  if (!body.ok) return jsonError(body.status, body.error);

  const parsed = actionBodySchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, PUBLIC_ERRORS.invalidBody);
  }
  const { idempotencyKey, expectedRevision, phaseToken, command } = parsed.data;

  try {
    const { service } = createApiGameService(db);
    const result = await service.submitCommand(user.userId, sessionId, {
      key: idempotencyKey,
      command: command as Quick6Command,
      asOwner: true,
      expectedRevision,
      expectedPhaseToken: phaseToken,
    });
    if (result.ok) {
      const view = await service.getPlayerView(user.userId, sessionId, {
        sinceRevision: expectedRevision,
      });
      const envelope: ActionEnvelope = {
        ...buildSessionEnvelope(view),
        applied: result.applied,
      };
      return NextResponse.json(envelope);
    }
    switch (result.error) {
      case "NOT_FOUND":
        return notFoundResponse();
      case "NOT_ACTIVE":
      case "TERMINAL":
        return jsonError(409, PUBLIC_ERRORS.sessionNotActive);
      case "STALE":
        return jsonError(409, PUBLIC_ERRORS.stale, {
          code:
            result.detail === "expected_phase_token"
              ? PUBLIC_ERRORS.phaseConflict
              : PUBLIC_ERRORS.revisionConflict,
        });
      case "ILLEGAL":
        return jsonError(409, PUBLIC_ERRORS.illegalAction);
      case "FORBIDDEN":
        return jsonError(403, PUBLIC_ERRORS.forbidden);
      case "IDEMPOTENCY_CONFLICT":
        return jsonError(409, PUBLIC_ERRORS.idempotencyConflict);
    }
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  }
}
