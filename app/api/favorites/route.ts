import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { favorites } from "@/lib/db/schema";
import { getLesson } from "@/lib/content";

const bodySchema = z.object({
  textbookSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
});

// Toggles a favorite. Returns { favorited: boolean } reflecting the new state.
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
  const { textbookSlug, lessonSlug } = parsed.data;

  if (!getLesson(textbookSlug, lessonSlug)) {
    return NextResponse.json({ error: "unknown_lesson" }, { status: 404 });
  }

  const userId = session.user.id;

  const [existing] = await db
    .select()
    .from(favorites)
    .where(
      and(
        eq(favorites.userId, userId),
        eq(favorites.textbookSlug, textbookSlug),
        eq(favorites.lessonSlug, lessonSlug),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(favorites).where(eq(favorites.id, existing.id));
    return NextResponse.json({ favorited: false });
  }

  await db.insert(favorites).values({ userId, textbookSlug, lessonSlug });
  return NextResponse.json({ favorited: true });
}
