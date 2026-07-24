import Link from "next/link";
import { getTextbookGroups } from "@/lib/content";
import { auth } from "@/lib/auth";
import { getFavoriteTextbookSlugs } from "@/lib/textbook-favorites";
import { TextbookFavoriteButton } from "@/components/textbook-favorite-button";

export default async function TextbooksPage() {
  const groups = getTextbookGroups();

  const session = await auth();
  const authenticated = Boolean(session?.user?.id);
  const favoriteSlugs = session?.user?.id
    ? await getFavoriteTextbookSlugs(session.user.id)
    : new Set<string>();

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Textbooks</h1>
      <p className="mb-8 text-slate-600">
        Choose a textbook to start learning.
      </p>

      <div className="space-y-10">
        {groups.map((group) => (
          <section key={group.series ?? group.textbooks[0].slug}>
            {group.series ? (
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.series}
                </h2>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {group.textbooks.length} book
                  {group.textbooks.length === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {group.textbooks.map((t) => (
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
                    <p className="mt-2 text-sm text-slate-600">
                      {t.description}
                    </p>
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
        ))}
      </div>
    </div>
  );
}
