import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

export async function SiteHeader() {
  const session = await auth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-xl font-bold text-brand-600">
          Wikids
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
          <Link href="/textbooks" className="hover:text-slate-900">
            Textbooks
          </Link>
          {session?.user ? (
            <>
              <Link href="/progress" className="hover:text-slate-900">
                Progress
              </Link>
              <Link href="/favorites" className="hover:text-slate-900">
                Favorites
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="text-slate-600 hover:text-slate-900"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-700"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
