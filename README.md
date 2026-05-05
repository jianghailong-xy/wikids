# Wikids

A learning website for kids. Each textbook is a folder of MDX lessons; each
lesson is a webpage. Signed-in learners get progress tracking, favorites, and
quiz history.

## Tech stack

- **Next.js 15** (App Router) + TypeScript + React 18
- **Tailwind CSS** + `@tailwindcss/typography` for lesson prose
- **MDX** rendered server-side via `next-mdx-remote/rsc`
- **Auth.js v5** (NextAuth) with credentials provider, JWT sessions
- **Drizzle ORM** + Postgres (works with local Postgres, Neon, Supabase, RDS)
- **Zod** for request validation

## Project layout

```
app/                          Next.js routes
  page.tsx                    Landing
  textbooks/                  Textbook + lesson routes
    [textbook]/
      [lesson]/page.tsx       Renders MDX for a lesson
  sign-in/, sign-up/          Auth pages
  progress/, favorites/       Signed-in dashboards
  api/                        REST endpoints (progress, favorites, quiz, auth)

components/
  site-header.tsx             Top nav (auth-aware)
  mdx/                        MDX-embeddable components (Callout, Quiz)
  learn/                      Lesson interactions (progress beacon)

content/textbooks/            Authoring root
  index.ts                    Registers all textbooks
  <textbook-slug>/
    index.ts                  Textbook metadata + ordered lesson list
    <lesson-slug>.mdx         Lesson content

lib/
  auth.ts, auth-actions.ts    Auth.js setup + sign-up server action
  content/                    Content loader (registry + MDX file reader)
  db/                         Drizzle schema and client
  utils.ts                    Tailwind class helper

drizzle/                      Generated SQL migrations (after db:generate)
types/next-auth.d.ts          Augments Session with user.id
```

## Getting started

Prerequisites: Node.js 20+ and Docker (with the Compose plugin).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# .env.local already points at the docker-compose Postgres.
# Set AUTH_SECRET: openssl rand -base64 32

# 3. Start Postgres in the background (Docker)
npm run db:up
# Equivalent to: docker compose up -d

# 4. Apply the schema to the database
npm run db:migrate     # uses the versioned SQL in drizzle/
# or, for fast iteration during early dev:
# npm run db:push

# 5. Run the dev server
npm run dev
```

Open http://localhost:3000.

To stop the database container without losing data:

```bash
npm run db:down
```

Data persists in the named Docker volume `wikids_postgres_data`. To wipe it
completely (e.g. to start over with a fresh DB):

```bash
docker compose down -v
```

## Adding a new lesson

1. Create the MDX file:
   `content/textbooks/<textbook-slug>/<lesson-slug>.mdx`
2. Register it in `content/textbooks/<textbook-slug>/index.ts` by appending to
   the `lessons` array. The order in this array is the order learners see.
3. The route `/textbooks/<textbook-slug>/<lesson-slug>` is now live.

Inside MDX you can use the built-in components:

```mdx
<Callout type="tip" title="Try this">
  Look around and count five red things.
</Callout>

<Quiz
  id="my-quiz"
  questions={[
    { id: "q1", prompt: "...", choices: ["A", "B"], answer: "A" },
  ]}
/>
```

`Quiz` automatically posts attempts to `/api/quiz` for signed-in users; the
lesson page also pings `/api/progress` on load and exposes a "Mark as complete"
button.

## Adding a new textbook

1. Create `content/textbooks/<new-slug>/index.ts` exporting a `Textbook`.
2. Add the import to `content/textbooks/index.ts`.
3. Drop in lesson MDX files as above.

## Database commands

| Command               | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `npm run db:up`       | Start the Postgres container (`docker compose up -d`)              |
| `npm run db:down`     | Stop the Postgres container (data persists in the named volume)    |
| `npm run db:logs`     | Tail Postgres container logs                                       |
| `npm run db:generate` | Generate a new SQL migration file from `lib/db/schema.ts`          |
| `npm run db:migrate`  | Apply pending migrations from `drizzle/`                           |
| `npm run db:push`     | Push schema directly without writing a migration (dev-only)        |
| `npm run db:studio`   | Open Drizzle Studio at https://local.drizzle.studio                |

After editing `lib/db/schema.ts`, run `npm run db:generate` to create a new
migration in `drizzle/`, commit it, then `npm run db:migrate` to apply.

## Architecture notes

- **Slugs are stable identifiers.** Progress / favorites / quiz rows reference
  `(textbookSlug, lessonSlug)` directly, so we don't have to sync MDX content
  into the database. If you rename a slug, update existing rows or treat it as
  a new lesson.
- **Lessons are statically generated** via `generateStaticParams`, so HTML is
  cached. User-specific state (progress, favorites, quiz state) is fetched from
  client components hitting `/api/*`.
- **Auth uses JWT sessions** for simplicity. Switch to `session: { strategy:
  "database" }` in `lib/auth.ts` if you want session rows in Postgres.
- **Quizzes save best-effort.** If the user is signed out, the POST to
  `/api/quiz` returns 401 silently — the UI still shows the score.
