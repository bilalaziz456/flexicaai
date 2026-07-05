import { z } from "zod";

/**
 * Centralised, validated environment access.
 *
 * WHY: reading process.env directly scatters typos and missing-var bugs across
 * the codebase. We validate once here and fail fast with a clear message.
 *
 * Public vars (NEXT_PUBLIC_*) are safe to read on the client. Server-only
 * secrets must never be imported into client components — keep them in
 * `serverEnv` and only reference it from server code / API routes.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

const serverSchema = z.object({
  // Service role bypasses RLS — server-only, never expose to the client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Server-only secrets. Call `getServerEnv()` inside server code so it is never
 * bundled for the browser. Kept lazy so the client build does not fail on a
 * missing service-role key.
 */
export function getServerEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
