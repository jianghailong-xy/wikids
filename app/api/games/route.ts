import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PersistenceError } from "@/lib/games/core";
import { createGameService } from "@/lib/games/orchestration/runtime";
import type { Quick6StartOptions } from "@/lib/games/werewolf";
import { SEAT_COUNT } from "@/lib/games/werewolf";

export const runtime = "nodejs";

const seatSchema = z.number().int().min(0).max(SEAT_COUNT - 1);
const roleSchema = z.enum(["WOLF", "SEER", "VILLAGER"]);

const bodySchema = z.object({
  // Optional explicit start: a fixed role table (must be the §1 multiset)
  // and the human seat. Both default to a seeded deal with the human at 0.
  start: z
    .object({
      roles: z.array(roleSchema).length(SEAT_COUNT).optional(),
      humanSeat: seatSchema.optional(),
    })
    .optional(),
});

/** Create a quick6 game for the authenticated user. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const start: Quick6StartOptions = {
    ...(parsed.data.start?.roles ? { roles: parsed.data.start.roles } : {}),
    humanSeat: parsed.data.start?.humanSeat ?? 0,
  };

  try {
    const { service } = createGameService(db);
    const result = await service.createGame(session.user.id, { start });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceError) {
      if (error.code === "USER_BUDGET_EXHAUSTED") {
        return NextResponse.json({ error: "user_budget_exhausted" }, { status: 429 });
      }
      return NextResponse.json({ error: "create_failed", detail: error.code }, { status: 500 });
    }
    return NextResponse.json({ error: "invalid_start" }, { status: 400 });
  }
}

/** List the user's games, newest first. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { service } = createGameService(db);
  const games = await service.listGames(session.user.id);
  return NextResponse.json({ games });
}
