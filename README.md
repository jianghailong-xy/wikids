# Wikids

A learning website for kids. Each textbook is a folder of MDX lessons; each
lesson is a webpage. Signed-in learners get progress tracking, favorites, and
quiz history.

## Tech stack

- **Next.js 15** (App Router, standalone output) + TypeScript + React 18
- **Tailwind CSS** + `@tailwindcss/typography` for lesson prose
- **MDX** compiled at build time via `@next/mdx` — each lesson is a `page.mdx`
- **Auth.js v5** (NextAuth) with credentials provider, JWT sessions
- **Drizzle ORM** + Postgres (works with local Postgres, Neon, Supabase, RDS)
- **Zod** for request validation
- **Docker Compose** for local Postgres and a production-like web container

## Project layout

```
app/                                    Next.js routes
  page.tsx                              Landing
  textbooks/
    page.tsx                            All textbooks list
    [textbook]/page.tsx                 Textbook overview (lesson list)
    <textbook-slug>/
      <lesson-slug>/page.mdx            ← one file per lesson
  sign-in/, sign-up/                    Auth pages
  progress/, favorites/                 Signed-in dashboards
  api/                                  REST endpoints (progress, favorites, quiz, auth)

mdx-components.tsx                      Global MDX components (Callout, Quiz, Lesson)

components/
  site-header.tsx                       Top nav (auth-aware)
  mdx/                                  MDX-embeddable: Callout, Quiz
  learn/                                Lesson chrome: <Lesson> shell + progress beacon

content/textbooks/                      Lesson metadata only (no .mdx here)
  index.ts                              Registers all textbooks
  <textbook-slug>/index.ts              Textbook metadata + ordered lesson list

lib/
  auth.ts, auth-actions.ts              Auth.js setup + sign-up server action
  content/                              Registry helpers (getTextbook, getLesson, ...)
  db/                                   Drizzle schema and client
  utils.ts                              Tailwind class helper

drizzle/                                Generated SQL migrations
scripts/migrate.mjs                     Runs migrations on container start
Dockerfile, docker-compose.yml          Web + Postgres services
```

## Getting started

Prerequisites: Docker (with the Compose plugin). Node.js 20+ if you want to
run the dev server on the host instead of in a container.

Pick one of the workflows below. Both use the same `.env` file:

```bash
cp .env.example .env
# edit .env: set AUTH_SECRET (run: openssl rand -base64 32)
```

### Workflow A — everything in Docker (production-like)

Builds the Next.js app into a container, brings up Postgres, runs migrations
on startup, and serves the app on http://localhost:3000.

```bash
npm run docker:up      # docker compose up -d --build
npm run docker:logs    # tail the web container
npm run docker:down    # stop everything (data persists in the named volume)
```

### Workflow B — DB in Docker, app on the host (fast inner loop)

Best for editing lessons and components — you keep Next.js' hot reload.

```bash
npm install
npm run db:up          # postgres only
npm run db:migrate     # apply drizzle/ migrations
npm run dev            # http://localhost:3000
```

### Wiping the database

Data persists in the named Docker volume `wikids_postgres_data`. To start
over with a fresh DB:

```bash
docker compose down -v
```

## Adding a new lesson

1. Create `app/textbooks/<textbook-slug>/<lesson-slug>/page.mdx`. Wrap the
   content with the `<Lesson>` shell so it gets the title, breadcrumb, prev/
   next nav, and the progress beacon:

   ```mdx
   <Lesson textbook="math-grade-1" slug="03-adding-numbers">

   We can put numbers together to make a bigger number.

   <Callout type="tip" title="Try this">
     Use your fingers to count `2 + 3`.
   </Callout>

   <Quiz
     textbookSlug="math-grade-1"
     lessonSlug="03-adding-numbers"
     id="adding-quiz-1"
     questions={[
       { id: "q1", prompt: "2 + 3 = ?", choices: ["4", "5", "6"], answer: "5" },
     ]}
   />

   </Lesson>
   ```

2. Register the lesson in `content/textbooks/<textbook-slug>/index.ts` by
   appending to the `lessons` array. The order there is the order learners
   see and drives prev/next navigation.

3. The route `/textbooks/<textbook-slug>/<lesson-slug>` is now live.

### Built-in MDX components

All of these are globally available in any `.mdx` under `app/` — no imports
needed (declared in `mdx-components.tsx`).

| Component         | Use it for                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| `<Lesson>`        | Required wrapper. Adds title, breadcrumb, prev/next nav, progress beacon.      |
| `<Callout>`       | Highlighted tip / info / warning box.                                          |
| `<Quiz>`          | Multiple-choice quiz. Saves attempts to `/api/quiz`.                           |
| `<Match>`         | Drag-and-drop matching pairs (mouse + touch). Saves to `/api/quiz`.            |
| `<Flashcard>`     | Single flip card (front / back).                                               |
| `<FlashcardDeck>` | Multiple flashcards with prev/next navigation.                                 |
| `<SayIt>`         | Inline button that pronounces a word using the browser's speech synthesis.     |
| `<Audio>`         | HTML5 audio with a kid-friendly play/pause button.                             |
| `<Gallery>`       | Image carousel with prev/next, captions, dot indicators, keyboard arrows.      |

Quizzes and matching games post attempts to `/api/quiz` for signed-in users.
The lesson page also pings `/api/progress` on load and exposes a
"Mark as complete" button via the embedded `<LessonProgressBeacon>`.

## Adding a new textbook

1. Create `content/textbooks/<new-slug>/index.ts` exporting a `Textbook`.
2. Add the import to `content/textbooks/index.ts`.
3. Create lesson `page.mdx` files under `app/textbooks/<new-slug>/<lesson>/`.

## Commands

| Command                | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run docker:up`    | Build and start db + web (`docker compose up -d --build`)         |
| `npm run docker:logs`  | Tail the web container                                            |
| `npm run docker:down`  | Stop everything (volume persists)                                 |
| `npm run db:up`        | Start only the Postgres container                                 |
| `npm run db:down`      | Stop the Postgres container                                       |
| `npm run db:logs`      | Tail Postgres container logs                                      |
| `npm run db:generate`  | Generate a new SQL migration file from `lib/db/schema.ts`         |
| `npm run db:migrate`   | Apply pending migrations from `drizzle/` (against host's `.env`)  |
| `npm run db:push`      | Push schema directly without writing a migration (dev-only)       |
| `npm run db:studio`    | Open Drizzle Studio at https://local.drizzle.studio               |
| `npm run dev`          | Start Next.js in dev mode on the host (needs db running)          |
| `npm run build`        | Build the production bundle on the host                           |
| `npm run typecheck`    | `tsc --noEmit`                                                    |

After editing `lib/db/schema.ts`, run `npm run db:generate` to create a new
migration in `drizzle/`, commit it. The next `docker:up` will apply it on
container start; or run `npm run db:migrate` against a host-mode database.

## Architecture notes

- **Each lesson is a real Next.js page** (`page.mdx`), not a runtime-loaded
  document. MDX is compiled at build time by `@next/mdx`, so there's no
  React/JSX runtime mismatch and the static HTML is fully cached.
- **Slugs are stable identifiers.** Progress / favorites / quiz rows reference
  `(textbookSlug, lessonSlug)` directly, so we don't have to sync MDX content
  into the database. If you rename a slug, update existing rows or treat it as
  a new lesson.
- **The web container applies migrations on start.** `scripts/migrate.mjs` is
  invoked before `node server.js`, so any new SQL files in `drizzle/` are
  applied automatically when you `docker compose up`.
- **Auth uses JWT sessions** for simplicity. Switch to `session: { strategy:
  "database" }` in `lib/auth.ts` if you want session rows in Postgres.
- **Quizzes save best-effort.** If the user is signed out, the POST to
  `/api/quiz` returns 401 silently — the UI still shows the score.
