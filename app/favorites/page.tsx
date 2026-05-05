import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { favorites } from "@/lib/db/schema";
import { getLesson } from "@/lib/content";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=/favorites");

  const rows = await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, session.user.id))
    .orderBy(desc(favorites.createdAt));

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Favorites</h1>
      <p className="mb-8 text-slate-600">Lessons you&apos;ve saved.</p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          You haven&apos;t favorited any lessons yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {rows.map((row) => {
            const located = getLesson(row.textbookSlug, row.lessonSlug);
            const title = located
              ? `${located.textbook.title} — ${located.lesson.title}`
              : `${row.textbookSlug} / ${row.lessonSlug}`;
            return (
              <li key={row.id}>
                <Link
                  href={`/textbooks/${row.textbookSlug}/${row.lessonSlug}`}
                  className="block p-4 font-medium text-slate-900 hover:bg-slate-50"
                >
                  {title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
