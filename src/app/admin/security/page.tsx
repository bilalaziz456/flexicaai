import { requireRole } from "@/core/auth/user";
import { getMyTotpState } from "@/core/users/profile";
import { SecurityPanel } from "./security-panel";

/**
 * Super-admin account security — the 2FA (TOTP) enrolment surface. Guarded to
 * super_admin by requireRole; reads only THIS user's 2FA state. CORE +
 * specialty-agnostic. See docs/super-admin-plan.md §11 Feature 1.
 */
export default async function SecurityPage() {
  const user = await requireRole("super_admin");

  const { enabled, backupCount } = await getMyTotpState(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two-factor authentication protects the super-admin panel. Once enabled, sign-in
          asks for a 6-digit code from your authenticator app.
        </p>
      </header>
      <SecurityPanel enabled={enabled} backupCount={backupCount} />
    </div>
  );
}
