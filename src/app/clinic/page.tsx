import { requireRole } from "@/core/auth/user";
import { PanelPlaceholder } from "@/core/ui/panel-placeholder";

/** Clinic Admin panel (clinic owner). Built out in Step 6. */
export default async function ClinicHome() {
  const user = await requireRole("clinic_admin");
  return (
    <PanelPlaceholder
      title="Clinic Admin"
      buildStep="Step 6 (dashboard, staff, patients)"
      user={user}
    />
  );
}
