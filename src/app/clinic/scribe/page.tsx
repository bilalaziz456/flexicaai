import { requireWorkspace } from "@/core/auth/user";
import { ScribePanel } from "@/app/clinic/scribe/scribe-panel";

/** Clinic workspace: the voice scribe (needs `clinical`). */
export default async function ClinicScribePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const user = await requireWorkspace("clinical");
  return <ScribePanel user={user} clinicId={user.clinicId} searchParams={await searchParams} />;
}
