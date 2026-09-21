import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SUPPORTED_GAME_DEFINITIONS,
  assertSameOrigin,
  buildSessionEnvelope,
  createApiGameService,
  createBodySchema,
  enforceRateLimit,
  getApiConfig,
  internalErrorResponse,
  jsonError,
  listQuerySchema,
  mapPersistenceError,
  PUBLIC_ERRORS,
  readJsonBody,
  requireUser,
  toInternalDefinitionId,
  toPublicDefinitionId,
} from "@/lib/games/api";
import { IllegalActionError, PersistenceError } from "@/lib/games/core";
import type { Quick6StartOptions } from "@/lib/games/werewolf";

export const runtime = "nodejs";

/**
 * Create a game for the authenticated user. At most one active quick6 game
 * per user: a conflicting create returns the stable active_session_exists
 * (409). The response is the full player envelope (201).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const crossOrigin = assertSameOrigin(req);
  if (crossOrigin) return crossOrigin;

  const rate = enforceRateLimit(user.userId, "create");
  if (rate) return rate;

  const body = await readJsonBody(req, getApiConfig().body.maxBytes);
  if (!body.ok) return jsonError(body.status, body.error);

  const parsed = createBodySchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, PUBLIC_ERRORS.invalidBody);
  }
  const { gameDefinitionId, start: startInput } = parsed.data;
  if (gameDefinitionId !== undefined && !SUPPORTED_GAME_DEFINITIONS.includes(gameDefinitionId)) {
    return jsonError(400, PUBLIC_ERRORS.invalidGameDefinition);
  }

  const start: Quick6StartOptions | undefined = startInput
    ? {
        ...(startInput.roles ? { roles: startInput.roles } : {}),
        humanSeat: startInput.humanSeat ?? 0,
      }
    : undefined;

  try {
    const { service } = createApiGameService(db);
    const created = await service.createGame(user.userId, { start });
    const view = await service.getPlayerView(user.userId, created.sessionId, {});
    return NextResponse.json(buildSessionEnvelope(view), { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceError && error.code === "USER_BUDGET_EXHAUSTED") {
      return jsonError(409, PUBLIC_ERRORS.activeSessionExists);
    }
    if (error instanceof IllegalActionError) {
      return jsonError(400, PUBLIC_ERRORS.invalidStart);
    }
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  }
}

/**
 * List the user's sessions (newest first), optionally filtered by
 * gameDefinitionId and status — the lobby query.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    gameDefinitionId: searchParams.get("gameDefinitionId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, PUBLIC_ERRORS.invalidBody);
  }

  try {
    const { service } = createApiGameService(db);
    const sessions = await service.listGames(user.userId, {
      // The lobby speaks the public definition id; rows store the internal
      // one (protocol.ts maps both ways so neither crosses the wire).
      definitionId:
        parsed.data.gameDefinitionId === undefined
          ? undefined
          : toInternalDefinitionId(parsed.data.gameDefinitionId),
      status: parsed.data.status,
    });
    return NextResponse.json({
      sessions: sessions.map((session) => ({
        sessionId: session.id,
        gameDefinitionId: toPublicDefinitionId(session.definitionId),
        title: session.title,
        status: session.status,
        revision: session.revision,
        phaseToken: session.phaseToken,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })),
    });
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) return mapped;
    return internalErrorResponse(error);
  }
}
