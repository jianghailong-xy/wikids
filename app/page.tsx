import Link from "next/link";
import { getAllTextbooks } from "@/lib/content";
import { auth } from "@/lib/auth";
import { getStudyStats } from "@/lib/study-stats";
import { getFavoriteTextbookSlugs } from "@/lib/textbook-favorites";
import { StudyStatsOverview } from "@/components/study-stats-overview";
import { TextbookFavoriteButton } from "@/components/textbook-favorite-button";

export default async function HomePage() {
  const textbooks = getAllTextbooks();

  const session = await auth();
  const authenticated = Boolean(session?.user?.id);
  const stats = session?.user?.id
    ? await getStudyStats(session.user.id)
    : null;
  const favoriteSlugs = session?.user?.id
    ? await getFavoriteTextbookSlugs(session.user.id)
    : new Set<string>();

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Welcome to Wikids
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
          Bite-sized lessons for curious kids.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Pick a textbook, work through the lessons at your own pace, and keep
          track of what you&apos;ve mastered.
        </p>
        <div className="mt-6">
          <Link
            href="/textbooks"
            className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Browse textbooks
          </Link>
        </div>
      </section>

      {stats && <StudyStatsOverview stats={stats} />}

      <section>
        <h2 className="mb-4 text-2xl font-semibold text-slate-900">
          Featured textbooks
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {textbooks.slice(0, 4).map((t) => (
            <div
              key={t.slug}
              className="relative rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-brand-400 hover:shadow"
            >
              <Link href={`/textbooks/${t.slug}`} className="block p-5">
                <p className="pr-9 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t.subject} · {t.gradeLevel}
                </p>
                <h3 className="mt-1 pr-9 text-lg font-semibold text-slate-900">
                  {t.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{t.description}</p>
                <p className="mt-3 text-xs text-slate-500">
                  {t.lessons.length} lesson{t.lessons.length === 1 ? "" : "s"}
                </p>
              </Link>
              <TextbookFavoriteButton
                textbookSlug={t.slug}
                title={t.title}
                initialFavorited={favoriteSlugs.has(t.slug)}
                authenticated={authenticated}
                className="absolute right-3 top-3"
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
