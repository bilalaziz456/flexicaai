/**
 * Seeds the first Super Admin. Run with: npm run db:seed
 *
 * Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env.local. There is no
 * public signup, so this is how the very first account is created. Idempotent:
 * running it again for an existing email does nothing.
 *
 * Standalone Node script — it creates its own pool and does NOT import the app's
 * "server-only" modules (which are meant for the Next runtime only).
 */
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../src/core/db/schema";

config({ path: ".env.local" });

async function main() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? "admin")
    .toLowerCase()
    .trim();
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";

  if (!username || !password) {
    throw new Error(
      "Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD in .env.local first.",
    );
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const passwordHash = await bcrypt.hash(password, 12);

  const inserted = await db
    .insert(users)
    .values({
      username,
      email: email || null,
      passwordHash,
      role: "super_admin",
      fullName: "Super Admin",
      clinicId: null,
    })
    .onConflictDoNothing({ target: users.username })
    .returning({ id: users.id });

  if (inserted.length > 0) {
    console.log(`✓ Created super admin: ${username}`);
  } else {
    console.log(`• Super admin already exists: ${username} (no change)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
