import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { favorites, textbookFavorites } from "@/lib/db/schema";
import { getLesson, getTextbook } from "@/lib/content";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=/favorites");

  const userId = session.user.id;

  const [textbookRows, lessonRows] = await Promise.all([
    db
      .select()
      .from(textbookFavorites)
      .where(eq(textbookFavorites.userId, userId))
      .orderBy(desc(textbookFavorites.createdAt)),
    db
      .select()
      .from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt)),
  ]);

  const empty = textbookRows.length === 0 && lessonRows.length === 0;

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Favorites</h1>
      <p className="mb-8 text-slate-600">
        Textbooks and lessons you&apos;ve saved.
      </p>

      {empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          You haven&apos;t favorited anything yet.
        </p>
      ) : (
        <div className="space-y-10">
          {textbookRows.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Textbooks
              </h2>
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {textbookRows.map((row) => {
                  const textbook = getTextbook(row.textbookSlug);
                  const title = textbook ? textbook.title : row.textbookSlug;
                  return (
                    <li key={row.id}>
                      <Link
                        href={`/textbooks/${row.textbookSlug}`}
                        className="block p-4 font-medium text-slate-900 hover:bg-slate-50"
                      >
                        {title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {lessonRows.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Lessons
              </h2>
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {lessonRows.map((row) => {
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
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
