import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getThemeCookie } from "@/core/theme/server";
import { PanelShell } from "@/core/ui/panel-shell";

/**
 * Receptionist panel shell. Same responsive chrome (sidebar / hamburger) as
 * every other role, via the shared PanelShell. Guards to receptionist.
 */
export default async function ReceptionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireRole("receptionist");
  const theme = await getThemeCookie();

  const [clinic] = user.clinicId
    ? await db
        .select({ featuresEnabled: clinics.featuresEnabled })
        .from(clinics)
        .where(eq(clinics.id, user.clinicId))
        .limit(1)
    : [undefined];

  return (
    <PanelShell
      panel="reception"
      identityLabel={user.username}
      theme={theme}
      salesEnabled={clinicHasFeature(clinic?.featuresEnabled, "sales")}
    >
      {children}
    </PanelShell>
  );
}
