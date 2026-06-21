import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Site-wide login gate. Uses the edge-safe config (no DB/bcrypt) so it can run
// in the middleware runtime. The `authorized` callback in `auth.config.ts`
// decides what is public; everything else redirects to /sign-in.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on every request except API routes (they do their own auth), Next.js
  // internals, and static assets under /public.
  matcher: ["/((?!api|_next|favicon.ico|img).*)"],
};
