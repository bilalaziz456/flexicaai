import { getCurrentUser } from "@/core/auth/user";
import { getMyAvatarKey } from "@/core/users/profile";
import { readFileByKey } from "@/core/integrations/storage";
import { report } from "@/core/observability";

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
  // Deliberately NOT apiRequireWorkspace: this serves the caller their OWN avatar,
  // never tenant data. It must also work for a super_admin (no clinic) and on
  // /paused and /change-password, where the shell still renders the user's face.
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const avatarKey = await getMyAvatarKey(user.id);
  if (!avatarKey) return new Response("Not found", { status: 404 });

  try {
    const data = await readFileByKey(avatarKey);
    const ext = avatarKey.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // The row says this file exists but the bytes could not be read, so the DB and
    // the file store disagree. Returning 404 is right for the caller, but it makes a
    // MISSING FILE look identical to a missing record — the exact shape data loss on
    // an ephemeral filesystem would take. Warn: the request is handled, the estate
    // is not.
    report(e, { op: "storage.serveAvatar", severity: "warn", userId: user.id });
    return new Response("Not found", { status: 404 });
  }
}
