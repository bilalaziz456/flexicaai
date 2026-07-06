import { requireRole } from "@/core/auth/user";
import { PanelPlaceholder } from "@/core/ui/panel-placeholder";

/** Doctor panel (voice scribe). Built out in Step 7. */
export default async function DoctorHome() {
  const user = await requireRole("doctor");
  return (
    <PanelPlaceholder
      title="Doctor"
      buildStep="Step 7 (voice scribe)"
      user={user}
    />
  );
}
