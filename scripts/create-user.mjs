// Creates (or, with --force, updates) a Wikids user account directly in the
// database. Accounts are admin-provisioned — there is no public sign-up.
//
//   npm run user:create -- --email alice@example.com --password 'secret123' --name 'Alice'
//
// DATABASE_URL is read from .env automatically (values already set in the
// environment win, so this also works inside the Docker container via
//   docker compose exec web node scripts/create-user.mjs --email ... --password ...)

import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import postgres from "postgres";

// --- load .env if present, without overriding the ambient environment ---
try {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
} catch {
  // no .env file — fall back to the ambient environment
}

// --- parse args ---
const argv = process.argv.slice(2);
const opts = { force: false, help: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--force") opts.force = true;
  else if (a === "--help" || a === "-h") opts.help = true;
  else if (a === "--email") opts.email = argv[++i];
  else if (a === "--password") opts.password = argv[++i];
  else if (a === "--name") opts.name = argv[++i];
}

const usage = `Usage: npm run user:create -- --email <email> --password <password> [--name <name>] [--force]

  --email     account email (required, must be unique)
  --password  password, at least 8 characters (required)
  --name      display name (optional)
  --force     if the email already exists, update its password/name instead of failing`;

if (opts.help || !opts.email || !opts.password) {
  console.log(usage);
  process.exit(opts.help ? 0 : 1);
}

const email = opts.email.trim().toLowerCase();
const { password, name } = opts;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`Invalid email: ${email}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required (set it in .env or the environment).");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await sql`select id from users where email = ${email} limit 1`;

  if (existing.length > 0) {
    if (!opts.force) {
      console.error(
        `A user with email ${email} already exists. Use --force to update it.`,
      );
      process.exitCode = 1;
    } else {
      await sql`
        update users
        set password_hash = ${passwordHash}${name ? sql`, name = ${name}` : sql``}
        where email = ${email}
      `;
      console.log(`Updated user ${email}.`);
    }
  } else {
    const [row] = await sql`
      insert into users (email, name, password_hash)
      values (${email}, ${name ?? null}, ${passwordHash})
      returning id
    `;
    console.log(`Created user ${email} (id ${row.id}).`);
  }
} catch (err) {
  console.error("Failed to create user:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
