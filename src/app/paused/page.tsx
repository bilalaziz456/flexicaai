import { redirect } from "next/navigation";
import { requireUser } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { isClinicUsable, unusableReason } from "@/core/clinics/status";
import { SignOutButton } from "@/core/auth/sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/card";

/**
 * Shown to clinic staff whose clinic isn't usable (suspended / past-due /
 * cancelled / trial expired). requireRole redirects here; this page uses
 * requireUser (NOT requireRole) so it never loops. super_admin and staff of a
 * usable clinic are bounced to their own home — they should never see this.
 */
export default async function PausedPage() {
  const user = await requireUser();

  // super_admin is never blocked — send them to their panel.
  if (user.role === "super_admin" || !user.clinicId) redirect("/admin");

  const clinic = await getClinic(user.clinicId);
  // If the clinic is actually usable, this page doesn't apply — go home.
  if (!clinic || isClinicUsable(clinic)) redirect("/clinic");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access paused</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{unusableReason(clinic)}</p>
          <p className="text-sm text-muted-foreground">
            Please contact FlexicaAI support to restore access to{" "}
            <span className="font-medium text-foreground">{clinic.name}</span>.
          </p>
          <div className="pt-2">
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
