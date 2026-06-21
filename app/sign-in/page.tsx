import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/textbooks");

  const { error, callbackUrl } = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-3xl font-bold text-slate-900">Sign in</h1>
      <p className="mb-6 text-sm text-slate-600">
        Welcome back. Sign in to keep track of your progress.
      </p>

      {error ? (
        <p className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          Invalid email or password.
        </p>
      ) : null}

      <form
        action={async (formData) => {
          "use server";
          try {
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: callbackUrl ?? "/textbooks",
            });
          } catch (err) {
            // A successful sign-in throws a NEXT_REDIRECT we must re-throw so
            // Next.js performs the redirect. A failed login throws an AuthError
            // (e.g. CredentialsSignin); without this catch it would surface as
            // an unhandled server-side exception (500) instead of the inline
            // "Invalid email or password." message. Redirect back to the
            // sign-in page with the error flag the page already renders.
            if (err instanceof AuthError) {
              const params = new URLSearchParams({ error: err.type });
              if (callbackUrl) params.set("callbackUrl", callbackUrl);
              redirect(`/sign-in?${params.toString()}`);
            }
            throw err;
          }
        }}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            type="email"
            name="email"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Sign in
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        Accounts are created by an administrator. Contact your administrator if
        you need access.
      </p>
    </div>
  );
}
