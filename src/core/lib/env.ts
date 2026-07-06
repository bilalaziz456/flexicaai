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
});

export const serverEnv = serverSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
});

export const isProduction = serverEnv.NODE_ENV === "production";
