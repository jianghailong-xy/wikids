import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildSessionEnvelope,
  createApiGameService,
  internalErrorResponse,
  jsonError,
  mapPersistenceError,
  notFoundResponse,
  PUBLIC_ERRORS,
  resumeQuerySchema,
  requireUser,
  uuidSchema,
} from "@/lib/games/api";

export const runtime = "nodejs";

/**
 * Resume one of the owner's sessions (the lobby restore path): the full
 * player envelope at the current revision, with the visible increments
 * after `since`. Non-owner and non-existent sessions are the same 404.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { sessionId } = await params;
  if (!uuidSchema.safeParse(sessionId).success) {
    return notFoundResponse();
  }

  const { searchParams } = new URL(req.url);
  const parsed = resumeQuerySchema.safeParse({
    since: searchParams.get("since") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, PUBLIC_ERRORS.invalidBody);
  }

  try {
    const { service } = createApiGameService(db);
    const view = await service.getPlayerView(user.userId, sessionId, {
      sinceRevision: parsed.data.since,
    });
    return NextResponse.json(buildSessionEnvelope(view));
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  }
}
