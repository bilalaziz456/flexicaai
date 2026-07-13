import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { getThemeCookie } from "@/core/theme/server";
import { clinicHasFeature } from "@/core/lib/features";
import { accessibleResourceIds } from "@/core/auth/permissions";
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
  const user = await requireWorkspace();
  const [clinic] = await db
    .select({
      name: clinics.name,
      logAccess: clinics.logAccess,
      featuresEnabled: clinics.featuresEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const theme = await getThemeCookie();
  // A clinic admin only sees the activity log if the super admin granted it; the
  // log nav is otherwise gated by the per-user `logs`… (kept as log_access).
  const logsEnabled =
    user.role === "clinic_admin" && (clinic?.logAccess?.length ?? 0) > 0;

  return (
    <PanelShell
      panel="clinic"
      identityLabel={clinic?.name ?? user.username}
      theme={theme}
      logsEnabled={logsEnabled}
      salesEnabled={clinicHasFeature(clinic?.featuresEnabled, "sales")}
      accessibleResources={accessibleResourceIds(user)}
    >
      {children}
    </PanelShell>
  );
}
