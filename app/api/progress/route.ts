import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonProgress } from "@/lib/db/schema";
import { getLesson } from "@/lib/content";

const bodySchema = z.object({
  textbookSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  status: z.enum(["in_progress", "completed"]),
});

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
  const { textbookSlug, lessonSlug, status } = parsed.data;

  // Reject slugs that don't exist in the registry — this keeps stale data
  // out of the database when content is renamed or removed.
  if (!getLesson(textbookSlug, lessonSlug)) {
    return NextResponse.json({ error: "unknown_lesson" }, { status: 404 });
  }

  const userId = session.user.id;
  const now = new Date();

  const [existing] = await db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.textbookSlug, textbookSlug),
        eq(lessonProgress.lessonSlug, lessonSlug),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(lessonProgress)
      .set({
        status,
        lastViewedAt: now,
        completedAt:
          status === "completed" ? (existing.completedAt ?? now) : null,
      })
      .where(eq(lessonProgress.id, existing.id));
  } else {
    await db.insert(lessonProgress).values({
      userId,
      textbookSlug,
      lessonSlug,
      status,
      lastViewedAt: now,
      completedAt: status === "completed" ? now : null,
    });
  }

  return NextResponse.json({ ok: true });
}
