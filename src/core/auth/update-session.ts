import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/core/lib/env";
import { isUserRole, type UserRole } from "@/core/types/auth";

/**
 * Refreshes the Supabase auth session on every request and returns the user so
 * middleware can make routing decisions.
 *
 * WHY the response juggling: @supabase/ssr may rotate the session cookie during
 * getUser(). We must write those cookies back onto the response we ultimately
 * return, or the refreshed session is lost. Follow this pattern exactly.
 *
 * Role is read from app_metadata (set server-side, tamper-proof — users cannot
 * edit it, unlike user_metadata). The `users` table (Step 3) stores the
 * canonical profile; role stays mirrored in app_metadata so middleware can
 * authorize from the JWT without a database round-trip on every request.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rawRole = user?.app_metadata?.role;
  const role: UserRole | null = isUserRole(rawRole) ? rawRole : null;

  return { response, user, role };
}
