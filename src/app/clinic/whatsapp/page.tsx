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
  const [clinic] = canEditSignature
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
      {canEditSignature && clinic ? (
        <Card>
          <CardHeader>
            <CardTitle>WhatsApp signature</CardTitle>
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
