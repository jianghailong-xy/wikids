# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Placeholder env so `next build` can import server modules that read
# DATABASE_URL / AUTH_SECRET at module scope. No DB connection happens at
# build time — the postgres-js client is lazy.
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
ENV AUTH_SECRET=placeholder-build-only
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server bundle (includes a minimized node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Lesson MDX is read from disk at request time
COPY --from=builder --chown=nextjs:nodejs /app/content ./content

# Migration runner + SQL files. drizzle-orm and postgres are inlined into
# the standalone route bundles, so they aren't in standalone/node_modules
# — copy the two zero-dep packages we need at runtime for migrate.mjs.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000

# Apply migrations, then start the Next.js standalone server.
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
