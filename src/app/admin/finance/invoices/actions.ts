"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminCapability } from "@/core/auth/user";
import { displayStaffName } from "@/core/types/auth";
import {
  issueClinicInvoice,
  restoreClinicInvoice,
  voidClinicInvoice,
} from "@/core/admin/clinic-invoices";
import { logActivity } from "@/core/audit/log";

export type InvoiceActionState = { error?: string; saved?: boolean };

const schema = z.object({
  clinicId: z.string().uuid("Pick a clinic."),
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).optional(),
});

/** Issue a subscription invoice to a clinic (finance:create). */
export async function issueClinicInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("finance:create");
  const parsed = schema.safeParse({
    clinicId: formData.get("clinicId"),
    amount: formData.get("amount"),
    periodStart: formData.get("periodStart") || undefined,
    periodEnd: formData.get("periodEnd") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const res = await issueClinicInvoice(
    {
      clinicId: parsed.data.clinicId,
      periodStart: parsed.data.periodStart ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
    },
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  );
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "create",
    entity: "settings",
    entityId: res.id,
    clinicId: parsed.data.clinicId,
    summary: `Issued subscription invoice ${res.label} (Rs ${parsed.data.amount})`,
  });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}

export async function voidClinicInvoiceAction(id: string): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("finance:delete");
  const ok = await voidClinicInvoice(id, user.id);
  if (!ok) return { error: "Invoice not found." };
  await logActivity({ action: "delete", entity: "settings", entityId: id, clinicId: null, summary: "Voided a subscription invoice" });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}

export async function restoreClinicInvoiceAction(id: string): Promise<InvoiceActionState> {
  await requireAdminCapability("finance:delete");
  const ok = await restoreClinicInvoice(id);
  if (!ok) return { error: "Invoice not found." };
  await logActivity({ action: "update", entity: "settings", entityId: id, clinicId: null, summary: "Restored a subscription invoice" });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}
