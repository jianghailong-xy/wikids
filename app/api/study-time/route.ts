import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { studyTimeDaily } from "@/lib/db/schema";
import { dayKey } from "@/lib/study-stats";

// The lesson tracker flushes at most every ~30s, so any single call reporting
// more than a few minutes is suspect. Cap each flush to keep a buggy or hostile
// client from ballooning the totals.
const MAX_SECONDS_PER_FLUSH = 15 * 60;

const bodySchema = z.object({
  seconds: z.number().int().positive().max(MAX_SECONDS_PER_FLUSH),
});

// Adds the reported active seconds to today's per-user bucket.
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

  const { seconds } = parsed.data;
  const userId = session.user.id;
  const day = dayKey();

  await db
    .insert(studyTimeDaily)
    .values({ userId, day, seconds })
    .onConflictDoUpdate({
      target: [studyTimeDaily.userId, studyTimeDaily.day],
      set: {
        seconds: sql`${studyTimeDaily.seconds} + ${seconds}`,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
