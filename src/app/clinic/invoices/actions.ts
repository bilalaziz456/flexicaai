"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/user";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { displayStaffName } from "@/core/types/auth";
import { deleteInvoice } from "@/core/billing/invoice-delete";
import { logActivity } from "@/core/audit/log";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";

/**
 * Deletes an invoice (voids it with who/when/why, and cancels its visit — see
 * `core/billing/invoice-delete.ts`). Needs `billing:delete` AND the person's own
 * password, re-checked here: a session left open at the front desk must not be
 * enough to remove a numbered money document.
 */
export async function deleteInvoiceAction(
  appointmentId: string,
  password: string,
  reason: string,
): Promise<{ error?: string }> {
  const user = await requireWorkspace("billing", "delete");
  if (!(await verifyCurrentUserPassword(password))) return { error: "Incorrect password." };

  const res = await deleteInvoice(
    user.clinicId,
    appointmentId,
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
    reason || null,
  );
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "delete",
    entity: "invoice",
    entityId: appointmentId,
    summary: `Deleted invoice ${res.label}${reason.trim() ? ` (${reason.trim().slice(0, 120)})` : ""}`,
  });
  revalidatePath("/clinic/invoices");
  revalidatePath(`/clinic/invoices/${appointmentId}`);
  revalidatePath("/clinic/appointments");
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidateFinance();
  return {};
}
