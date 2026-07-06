import { requireUser } from "@/core/auth/user";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Change-password screen. Uses requireUser (not requireRole) so a user forced
 * here by the must-change flag doesn't bounce in a loop. Signed-out users are
 * sent to /login by requireUser.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Klenic</h1>
        </div>
        <ChangePasswordForm forced={user.mustChangePassword} />
      </div>
    </div>
  );
}
