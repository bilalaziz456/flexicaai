import { requireRole } from "@/core/auth/user";
import { getMyTotpState } from "@/core/users/profile";
import { SecurityPanel } from "./security-panel";
import { SessionPolicy } from "./session-policy";
import { getSessionIdleMinutes } from "@/core/admin/company-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";

/**
 * Super-admin account security — the 2FA (TOTP) enrolment surface. Guarded to
 * super_admin by requireRole; reads only THIS user's 2FA state. CORE +
 * specialty-agnostic. See docs/super-admin-plan.md §11 Feature 1.
 */
export default async function SecurityPage() {
  const user = await requireRole("super_admin");

  const [{ enabled, backupCount }, idleMinutes] = await Promise.all([
    getMyTotpState(user.id),
    getSessionIdleMinutes(),
  ]);

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

      <Card>
        <CardHeader>
          <CardTitle>Idle session timeout</CardTitle>
          <CardDescription>
            How long a signed-in browser may sit untouched before it is signed out. Off
            by default — a shared reception counter and a doctor&rsquo;s own laptop do
            not want the same answer, so this is yours to set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionPolicy current={idleMinutes} />
        </CardContent>
      </Card>
    </div>
  );
}
