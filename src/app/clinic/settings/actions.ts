"use server";

import { revalidatePath } from "next/cache";
import { setInvoicePaper } from "@/core/clinics/settings";
import { requireWorkspace } from "@/core/auth/user";
import { logActivity } from "@/core/audit/log";

export type SettingsActionState = { error?: string; saved?: boolean };

/** Valid document paper sizes — must match the print frame's FORMATS. */
const PAPERS = ["thermal", "a5", "a4"];

/**
 * Set the clinic's DEFAULT print paper size (`clinics.invoice_paper`) — the size the
 * invoice / receipt / document print screens open on. Clinic-wide preference, so it's
 * clinic-admin only. Clinic-scoped (updates the caller's own clinic by id).
 */
export async function setClinicPrintPaper(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireWorkspace();
  if (user.role !== "clinic_admin" || !user.clinicId) {
    return { error: "Only the clinic admin can change the printing settings." };
  }
  const paper = String(formData.get("paper") ?? "");
  if (!PAPERS.includes(paper)) return { error: "Choose a valid paper size." };

  await setInvoicePaper(user.clinicId, paper);

  await logActivity({
    action: "update",
    entity: "settings",
    clinicId: user.clinicId,
    summary: `Set default print paper size to ${paper.toUpperCase()}`,
  });
  revalidatePath("/clinic/settings");
  return { saved: true };
}
