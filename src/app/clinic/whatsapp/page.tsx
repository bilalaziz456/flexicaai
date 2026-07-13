import { requireWorkspace } from "@/core/auth/user";
import { WhatsappQueue } from "@/app/reception/whatsapp-queue";

/** Clinic workspace: the WhatsApp queue (needs `whatsapp:view`). */
export default async function ClinicWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const user = await requireWorkspace("whatsapp");
  const sp = await searchParams;
  return (
    <WhatsappQueue
      clinicId={user.clinicId}
      basePath="/clinic/whatsapp"
      searchParams={sp}
    />
  );
}
