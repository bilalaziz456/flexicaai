import { requireRole } from "@/core/auth/user";
import { PanelPlaceholder } from "@/core/ui/panel-placeholder";

/** Super Admin panel (Klenic company staff). Built out in Step 5. */
export default async function AdminHome() {
  const user = await requireRole("super_admin");
  return (
    <PanelPlaceholder
      title="Super Admin"
      buildStep="Step 5 (create clinics, toggle modules)"
      user={user}
    />
  );
}
