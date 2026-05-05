import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonProgress } from "@/lib/db/schema";
import { getLesson } from "@/lib/content";

export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=/progress");

  const rows = await db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, session.user.id))
    .orderBy(desc(lessonProgress.lastViewedAt));

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Your progress</h1>
      <p className="mb-8 text-slate-600">
        Lessons you&apos;ve started or completed.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nothing here yet — open a lesson to get started.
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
                  className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{title}</span>
                  <span
                    className={
                      row.status === "completed"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                    }
                  >
                    {row.status === "completed" ? "Completed" : "In progress"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
