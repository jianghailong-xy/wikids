import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createGameService } from "@/lib/games/orchestration/runtime";
import { SEAT_COUNT } from "@/lib/games/werewolf";
import type { Quick6Command } from "@/lib/games/werewolf";

export const runtime = "nodejs";

const seatSchema = z.number().int().min(0).max(SEAT_COUNT - 1);

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SUBMIT_WOLF_KILL"), seat: seatSchema, target: seatSchema }),
  z.object({ type: z.literal("SUBMIT_SEER_CHECK"), seat: seatSchema, target: seatSchema }),
  z.object({ type: z.literal("SUBMIT_SPEECH"), seat: seatSchema, text: z.string().max(500).nullable() }),
  z.object({ type: z.literal("SUBMIT_DAY_VOTE"), seat: seatSchema, target: seatSchema }),
  // Settlement commands are system-only: the server never accepts them from
  // a client request, so they are not part of the public schema.
]);

const bodySchema = z.object({
  key: z.string().min(1).max(200),
  seat: seatSchema,
  command: commandSchema,
});

const STATUS: Record<string, number> = {
  STALE: 409,
  TERMINAL: 409,
  FORBIDDEN: 403,
  ILLEGAL: 409,
  IDEMPOTENCY_CONFLICT: 409,
  NOT_FOUND: 404,
};

/**
 * Submit one command for the authenticated user's own seat. This is the
 * single command path: AI decisions from the bounded advance flow through
 * the exact same service method (with internal idempotency keys), so human
 * and AI submissions are validated and applied identically by the rule
 * engine under revision/phase-token CAS.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sessionId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { key, seat, command } = parsed.data;

  const { service } = createGameService(db);
  const result = await service.submitCommand(session.user.id, sessionId, {
    key,
    command: command as Quick6Command,
    actorSeat: seat,
  });
  if (result.ok) {
    return NextResponse.json(result);
  }
  const status = STATUS[result.error] ?? 400;
  return NextResponse.json(result, { status });
}
