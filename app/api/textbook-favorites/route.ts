import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { textbookFavorites } from "@/lib/db/schema";
import { getTextbook } from "@/lib/content";

const bodySchema = z.object({
  textbookSlug: z.string().min(1),
});

// Toggles a whole-textbook favorite. Returns { favorited: boolean } reflecting
// the new state.
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
  const { textbookSlug } = parsed.data;

  if (!getTextbook(textbookSlug)) {
    return NextResponse.json({ error: "unknown_textbook" }, { status: 404 });
  }

  const userId = session.user.id;

  const [existing] = await db
    .select()
    .from(textbookFavorites)
    .where(
      and(
        eq(textbookFavorites.userId, userId),
        eq(textbookFavorites.textbookSlug, textbookSlug),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .delete(textbookFavorites)
      .where(eq(textbookFavorites.id, existing.id));
    return NextResponse.json({ favorited: false });
  }

  await db.insert(textbookFavorites).values({ userId, textbookSlug });
  return NextResponse.json({ favorited: true });
}
