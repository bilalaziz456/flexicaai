"use server";

import { revalidatePath } from "next/cache";
import { setInvoicePaper } from "@/core/clinics/settings";
import { requireWorkspace } from "@/core/auth/user";
import { logActivity } from "@/core/audit/log";
import { asCode, INVOICE_PAPER_ROWS, type InvoicePaperCode } from "@/core/db/vocabulary-seed";

export type SettingsActionState = { error?: string; saved?: boolean };

/** Valid document paper sizes — must match the print frame's FORMATS. */


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
  const code = asCode<InvoicePaperCode>(INVOICE_PAPER_ROWS, paper);
  if (!code) return { error: "Choose a valid paper size." };

  await setInvoicePaper(user.clinicId, code);

  await logActivity({
    action: "update",
    entity: "settings",
    clinicId: user.clinicId,
    summary: `Set default print paper size to ${paper.toUpperCase()}`,
  });
  revalidatePath("/clinic/settings");
  return { saved: true };
}
