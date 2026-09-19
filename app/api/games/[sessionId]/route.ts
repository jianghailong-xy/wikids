import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PersistenceError } from "@/lib/games/core";
import { createGameService } from "@/lib/games/orchestration/runtime";
import { SEAT_COUNT } from "@/lib/games/werewolf";

export const runtime = "nodejs";

const querySchema = z.object({
  seat: z.coerce.number().int().min(0).max(SEAT_COUNT - 1).optional(),
});

/** Resume a game: the current state projected through the single projector. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sessionId } = await params;
  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    seat: searchParams.get("seat") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const { service } = createGameService(db);
    const result = await service.resumeGame(session.user.id, sessionId, {
      viewer: parsed.data.seat !== undefined ? { seat: parsed.data.seat } : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PersistenceError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "resume_failed" }, { status: 500 });
  }
}
