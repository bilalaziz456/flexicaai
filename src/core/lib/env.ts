import { z } from "zod";

/**
 * Centralised, validated environment access.
 *
 * WHY: reading process.env directly scatters typos and missing-var bugs across
 * the codebase. We validate once here and fail fast with a clear message.
 *
 * With local Postgres there are NO public (browser) env vars — the browser
 * never talks to the database. Everything here is server-only; never import
 * this into a Client Component.
 */

const serverSchema = z.object({
  // Postgres connection string, e.g.
  // postgres://postgres:password@localhost:5432/klenic
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // AI keys — OPTIONAL so the app still boots without them. The scribe route
  // fails with a clear message if a call is attempted and its key is missing.
  ANTHROPIC_API_KEY: z.string().optional(), // Claude (note generation)
  OPENAI_API_KEY: z.string().optional(), // Whisper (transcription) — separate provider
  // Where uploaded audio is stored on disk for now (swap to S3 later). Relative
  // to the project root. Gitignored.
  STORAGE_DIR: z.string().default("./storage"),
});

export const serverEnv = serverSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  STORAGE_DIR: process.env.STORAGE_DIR,
});

export const isProduction = serverEnv.NODE_ENV === "production";
