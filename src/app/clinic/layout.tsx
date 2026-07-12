import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { getThemeCookie } from "@/core/theme/server";
import { PanelShell } from "@/core/ui/panel-shell";

/**
 * Clinic Admin panel shell. Guards to clinic_admin (with a guaranteed clinicId)
 * and shows the clinic's own name. Every child page/action is scoped to this
 * clinic — the admin never sees another clinic's data. The responsive chrome
 * (sidebar / hamburger) is the shared PanelShell.
 */
export default async function ClinicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireClinicAdmin();
  const [clinic] = await db
    .select({ name: clinics.name, logAccess: clinics.logAccess })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const theme = await getThemeCookie();

  return (
    <PanelShell
      panel="clinic"
      identityLabel={clinic?.name ?? user.username}
      theme={theme}
      logsEnabled={(clinic?.logAccess?.length ?? 0) > 0}
    >
      {children}
    </PanelShell>
  );
}
