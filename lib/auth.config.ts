import type { NextAuthConfig } from "next-auth";

// Edge-safe pieces of the auth config. This file must NOT import the database
// client, bcrypt, or any Node-only code so it can run in the middleware (Edge
// runtime). The full config in `lib/auth.ts` spreads this and adds the adapter
// plus the Credentials provider.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [],
  callbacks: {
    // Used by the middleware to gate the whole site behind a login. Returning
    // false makes Auth.js redirect to `pages.signIn` with a callbackUrl.
    authorized: ({ auth, request }) => {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      // The sign-in page itself must stay reachable while logged out.
      if (pathname === "/sign-in") return true;
      return isLoggedIn;
    },
    jwt: async ({ token, user }) => {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
