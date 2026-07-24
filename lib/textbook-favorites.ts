import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { textbookFavorites } from "@/lib/db/schema";

/**
 * Returns the set of textbook slugs the given user has favorited, used to
 * render the filled/empty heart on textbook cards without an extra round trip.
 */
export async function getFavoriteTextbookSlugs(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ textbookSlug: textbookFavorites.textbookSlug })
    .from(textbookFavorites)
    .where(eq(textbookFavorites.userId, userId));
  return new Set(rows.map((r) => r.textbookSlug));
}
