import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { registerUser } from "@/lib/auth-actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/textbooks");

  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-3xl font-bold text-slate-900">
        Create your account
      </h1>
      <p className="mb-6 text-sm text-slate-600">
        Set up an account to save progress, favorites, and quiz results.
      </p>

      {error ? (
        <p className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error === "exists"
            ? "An account with that email already exists."
            : "Could not create the account. Please try again."}
        </p>
      ) : null}

      <form
        action={registerUser}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            type="text"
            name="name"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            type="email"
            name="email"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            At least 8 characters.
          </span>
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Create account
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-brand-600">
          Sign in
        </Link>
      </p>
    </div>
  );
}
