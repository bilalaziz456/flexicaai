import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/core/lib/env";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Bound to the request's cookies so the user's session (and therefore RLS) is
 * respected on every query. In Next.js 15+/16 `cookies()` is async, so this
 * function must be awaited.
 *
 * Note: writing cookies from a Server Component throws; that is expected — the
 * try/catch swallows it and session refresh happens in middleware instead.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session cookie on each request.
          }
        },
      },
    },
  );
}
