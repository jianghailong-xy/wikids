import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiGameService,
  enforceRateLimit,
  internalErrorResponse,
  jsonError,
  mapPersistenceError,
  notFoundResponse,
  PUBLIC_ERRORS,
  requireUser,
  uuidSchema,
} from "@/lib/games/api";

export const runtime = "nodejs";

/**
 * The owner explicitly abandons their active game: it leaves the per-user
 * active-games budget (the next create succeeds) and can no longer be
 * advanced or acted on. Idempotent for an already-abandoned session.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const crossOrigin = assertSameOrigin(_req);
  if (crossOrigin) return crossOrigin;

  const rate = enforceRateLimit(user.userId, "action");
  if (rate) return rate;

  const { sessionId } = await params;
  if (!uuidSchema.safeParse(sessionId).success) {
    return notFoundResponse();
  }

  try {
    const { service } = createApiGameService(db);
    const result = await service.abandon(user.userId, sessionId);
    if (!result.ok) {
      return result.error === "NOT_FOUND"
        ? notFoundResponse()
        : jsonError(409, PUBLIC_ERRORS.sessionNotActive);
    }
    return NextResponse.json({ sessionId, status: "abandoned" });
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  }
}
