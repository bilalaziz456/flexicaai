import { getClinic } from "@/core/clinics/get-clinic";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { WhatsappQueue } from "@/app/clinic/whatsapp/whatsapp-queue";
import { WhatsappSettingsForm } from "./whatsapp-settings-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/**
 * Clinic workspace: the WhatsApp queue (needs `whatsapp:view`), plus — for users
 * who can edit settings — a card to set the clinic's WhatsApp message signature.
 * (Per-user profile lives on /clinic/settings.)
 */
export default async function ClinicWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const user = await requireWorkspace("whatsapp");
  const sp = await searchParams;

  const canEditSignature = can(user, "settings", "edit");
  const clinic = canEditSignature ? await getClinic(user.clinicId) : null;

  return (
    <div className="space-y-6">
      {canEditSignature && clinic ? (
        <Card>
          <CardHeader>
            <CardTitle>WhatsApp signature</CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsappSettingsForm
              displayNumber={clinic.whatsappDisplayNumber}
              signature={clinic.whatsappSignature}
            />
          </CardContent>
        </Card>
      ) : null}

      <WhatsappQueue
        clinicId={user.clinicId}
        basePath="/clinic/whatsapp"
        searchParams={sp}
      />
    </div>
  );
}
