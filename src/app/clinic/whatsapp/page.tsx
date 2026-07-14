import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { WhatsappQueue } from "@/app/reception/whatsapp-queue";
import { WhatsappSettingsForm } from "./whatsapp-settings-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/** Clinic workspace: the WhatsApp queue (needs `whatsapp:view`), plus — on the
 * Cloud API provider and for users with `settings:edit` — a message
 * personalization card (signature + per-event notes). */
export default async function ClinicWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const user = await requireWorkspace("whatsapp");
  const sp = await searchParams;

  // Shown to users who can edit settings. The values only take effect once the
  // clinic is sending via the Cloud API (a provisioned number); the card says so.
  const showSettings = can(user, "settings", "edit");
  const [clinic] = showSettings
    ? await db
        .select({
          displayNumber: clinics.whatsappDisplayNumber,
          signature: clinics.whatsappSignature,
        })
        .from(clinics)
        .where(eq(clinics.id, user.clinicId))
        .limit(1)
    : [null];

  return (
    <div className="space-y-6">
      {showSettings && clinic ? (
        <Card>
          <CardHeader>
            <CardTitle>WhatsApp message personalization</CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsappSettingsForm
              displayNumber={clinic.displayNumber}
              signature={clinic.signature}
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
