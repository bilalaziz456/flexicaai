import { redirect } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { can, canAccess } from "@/core/auth/permissions";
import { ScribePanel } from "@/app/clinic/scribe/scribe-panel";

/**
 * Clinic workspace: the voice scribe and clinical notes. Open to anyone holding
 * either grant — `clinical` (read, or write a note by hand) or `scribe` (record) —
 * since the clinic admin gives them separately (2026-11-14).
 */
export default async function ClinicScribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireWorkspace();
  if (!canAccess(user, "clinical") && !can(user, "scribe", "create")) redirect("/clinic");
  return <ScribePanel user={user} clinicId={user.clinicId} searchParams={await searchParams} />;
}
