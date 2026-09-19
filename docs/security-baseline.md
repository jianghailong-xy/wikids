# Security baseline

This page records the production-dependency security baseline and how it is
verified. It was established as P0.0 before any werewolf-game work.

## Verification

```sh
npm run verify:security-baseline
```

Runs serially, each step must pass (any failure exits non-zero and still
cleans up):

1. `npm ci` — clean install from the lockfile.
2. `npm audit --omit=dev --audit-level=high` — exits 0; the JSON report is
   also parsed so the high and critical counts are pinned to exactly 0.
3. `npm run typecheck` — `tsc --noEmit`.
4. `npm run build` — production build with placeholder env (mirrors the
   Dockerfile; the postgres-js client is lazy, nothing connects at build time).
5. Isolated temporary Postgres (`docker run`, random local port, auto-removed):
   existing migrations applied from scratch, re-applied to prove idempotence,
   expected tables/enum asserted (`scripts/db-smoke.mjs`).
6. Auth.js smoke against the built standalone server
   (`node .next/standalone/server.js`, what the Docker image actually runs):
   - valid credentials → session cookie issued, protected page and API reachable
   - invalid credentials → redirected to sign-in, no session cookie
   - unauthenticated access → middleware redirect, API returns 401
   - misconfiguration (no `AUTH_SECRET`) → must not fail open: protected
     content is never served, no session can be read or minted
   - malformed `Authorization` headers → 401, no uncaught exception

The smoke never touches a development database (only the throwaway container)
and makes no external API calls (no DeepSeek or any other service). Containers
and server processes are removed on success and on failure.

## Upgrade record (2026-09-18)

| Package | Before | After | Why |
| --- | --- | --- | --- |
| next | 15.5.15 | **15.5.25** | critical: 2× RCE in image optimization, middleware/proxy bypasses, cache confusion, DoS |
| next-auth | 5.0.0-beta.25 | **5.0.0-beta.32** | critical: email misdelivery, config-error fail-open |
| @auth/core | 0.41.2 | **0.41.3** | critical: email normalizer validation, getToken uncaught exception, OAuth state/nonce/PKCE |
| @auth/drizzle-adapter | 1.11.2 | **1.11.3** | follows @auth/core |
| drizzle-orm | 0.36.4 | **0.45.2** | high: SQL injection via improperly validated `mode` |
| drizzle-kit | 0.28.1 | **0.31.10** | synced with drizzle-orm; no migration changes produced |
| postcss | 8.4.31 (bundled in next) / 8.5.14 | **8.5.28** (override) | high: XSS in stringify output, sourceMappingURL path traversal |
| nanoid | 3.3.12 | **3.3.19** | high: non-secure generator loops |
| sharp | 0.34.5 | **0.35.4** | high: libvips CVEs, libheif vulnerabilities |

Production audit result: **0 high, 0 critical** (`npm audit --omit=dev`).

## Remaining risks (acceptable)

After the upgrade the full tree (dev dependencies included) reports only
4 **moderate** advisories, all confined to the local dev toolchain:

- `esbuild <= 0.24.2` — a dev-server request/response disclosure issue that
  only affects `esbuild serve`, which this project never runs.
- `@esbuild-kit/core-utils` / `@esbuild-kit/esm-loader` / `drizzle-kit`
  (0.19.0–1.0.0-beta.1) — drizzle-kit's transitive esbuild-kit loader chain,
  pinned to the old esbuild. Dev-only: drizzle-kit runs as a local CLI.

Neither affects the production bundle or the runtime server. The fix for
drizzle-kit is only published on its 1.0.0-beta line; staying on stable
`drizzle-kit 0.31.10` is deliberate until 1.0 stabilizes.

## Why a postcss override

Next.js 15 pins `postcss` to exactly 8.4.31 (vulnerable, ≤ 8.5.22). The
`overrides` entry in `package.json` forces every postcss resolution — next's
bundled copy included — to ^8.5.23. postcss 8.5.x is semver-compatible with
8.4.x, and the production build in the verification above exercises it.
