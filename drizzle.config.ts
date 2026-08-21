import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so load .env.local ourselves.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

export default defineConfig({
  // Core tables + module-owned tables (each specialty keeps its own schema file, e.g.
  // src/modules/dental/db/schema.ts). This is drizzle-KIT codegen config only — it does
  // NOT make /core import /modules; module code imports its own tables and passes them
  // to `db.select()` (the app uses no relational `db.query`, so no client merge needed).
  schema: ["./src/core/db/schema/*.ts", "./src/modules/**/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Readable diffs in code review.
  verbose: true,
  strict: true,
});
