import { requireUser } from "@/core/auth/user";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Change-password screen. Uses requireUser (not requireRole) so a user forced
 * here by the must-change flag doesn't bounce in a loop. Signed-out users are
 * sent to /login by requireUser.
 *
 * Lives in the `(auth)` group so it inherits that shell — the gradient background,
 * the centred card width, and the LOGO. It previously sat outside the group and
 * hand-copied the wrapper markup, which is how it ended up showing a plain
 * "FlexicaAI" heading where every other auth screen shows the mark: two copies of
 * one shell, and only one of them was ever updated. A route group adds no URL
 * segment, so this is still `/change-password`.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser();
  return <ChangePasswordForm forced={user.mustChangePassword} />;
}
