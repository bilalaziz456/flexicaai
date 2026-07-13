import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { WhatsappQueue } from "../whatsapp-queue";

/** Receptionist / manager: the WhatsApp queue (shared component). */
export default async function ReceptionWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "whatsapp", "view")) redirect("/reception");
  const sp = await searchParams;
  return (
    <WhatsappQueue
      clinicId={user.clinicId}
      basePath="/reception/whatsapp"
      searchParams={sp}
    />
  );
}
