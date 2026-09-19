import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PersistenceError } from "@/lib/games/core";
import { createGameService } from "@/lib/games/orchestration/runtime";

export const runtime = "nodejs";

/**
 * Bounded advance: starts at most one frozen batch of external AI decisions
 * (or the single ordered speaker in DAY_DISCUSSION) and at most one
 * deterministic settlement, then reports. When work remains the response is
 * `pending` with retryAfterMs — the client calls again; this handler never
 * loops until the game is over. Runs on the persistent Node runtime (a
 * single request may wait on at most one provider batch).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sessionId } = await params;

  try {
    const { service } = createGameService(db);
    const result = await service.advance(session.user.id, sessionId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PersistenceError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "advance_failed" }, { status: 500 });
  }
}
