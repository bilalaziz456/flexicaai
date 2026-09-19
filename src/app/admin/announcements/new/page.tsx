import { BackLink } from "@/core/ui/back-link";
import { requireAdminCapability } from "@/core/auth/user";
import { listClinicOptions } from "@/core/clinics/options";
import { AnnouncementForm } from "../announcement-form";

/** Super Admin: post a notice — to all clinics, one, or several; to chosen roles. */
export default async function NewAnnouncementPage() {
  await requireAdminCapability("announcements:create");
  const clinics = await listClinicOptions();
  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/admin/announcements">
          Back to announcements
        </BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">New announcement</h1>
        <p className="text-sm text-muted-foreground">
          Defaults to every clinic and every staff member; narrow either below.
        </p>
      </div>
      <AnnouncementForm clinics={clinics} />
    </div>
  );
}
