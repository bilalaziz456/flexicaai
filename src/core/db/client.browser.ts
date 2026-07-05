import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/core/lib/env";

/**
 * Supabase client for use in Client Components ("use client").
 *
 * Uses the public anon key and respects Row Level Security. Never use the
 * service-role key here — this runs in the browser.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
