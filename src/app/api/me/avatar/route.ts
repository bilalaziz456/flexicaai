import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { readFileByKey } from "@/core/integrations/storage";

/**
 * GET /api/me/avatar — serves the SIGNED-IN user's own profile picture (never
 * anyone else's, so no id in the URL). 404 when none is set, so the client can
 * fall back to initials. `no-store` because it can change at any time.
 */
const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [row] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.avatarKey) return new Response("Not found", { status: 404 });

  try {
    const data = await readFileByKey(row.avatarKey);
    const ext = row.avatarKey.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
