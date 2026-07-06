import { requireRole } from "@/core/auth/user";
import { PanelPlaceholder } from "@/core/ui/panel-placeholder";

/** Receptionist panel. Built out in Step 11. */
export default async function ReceptionHome() {
  const user = await requireRole("receptionist");
  return (
    <PanelPlaceholder
      title="Reception"
      buildStep="Step 11 (appointments, WhatsApp queue)"
      user={user}
    />
  );
}
