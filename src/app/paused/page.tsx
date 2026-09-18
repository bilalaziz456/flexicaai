import { redirect } from "next/navigation";
import { requireUser } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { isClinicUsable, unusableReason } from "@/core/clinics/status";
import { SignOutButton } from "@/core/auth/sign-out-button";
import { PauseCircle } from "lucide-react";
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
    <main className="app-root relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* The same quiet brand wash as the credentials screens — this is the other
          moment you are outside the product looking in. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-[var(--brand-teal)] opacity-[0.06] blur-[110px]" />
        <div className="absolute -bottom-40 right-[12%] size-[28rem] rounded-full bg-[var(--brand-navy)] opacity-[0.05] blur-[120px]" />
      </div>
      <Card className="w-full max-w-md p-1.5">
        <CardHeader>
          <div className="mb-1 flex size-11 items-center justify-center rounded-full border border-dashed border-warning/40 bg-warning/[0.08] text-warning-text">
            <PauseCircle className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Access paused</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{unusableReason(clinic)}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Contact FlexicaAI support to restore access to{" "}
            <span className="font-medium text-foreground">{clinic.name}</span>. Nothing has
            been deleted — your records are exactly as you left them.
          </p>
          <div className="pt-1">
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
