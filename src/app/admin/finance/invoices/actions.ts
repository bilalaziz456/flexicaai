"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROVINCES } from "@/core/clinics/provinces";
import type { ProvinceTaxMap } from "@/core/admin/invoice-status";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { displayStaffName } from "@/core/types/auth";
import {
  getInvoiceClinic,
  issueClinicInvoice,
  restoreClinicInvoice,
  setCompanyInvoiceTaxSettings,
  type InvoiceTaxInput,
  updateClinicInvoice,
  voidClinicInvoice,
} from "@/core/admin/clinic-invoices";
import { getClinic } from "@/core/clinics/get-clinic";
import { logActivity } from "@/core/audit/log";

type AdminUser = Awaited<ReturnType<typeof requireAdminCapability>>;

/**
 * A full admin acts on any clinic; anyone else only on the clinics they manage — the
 * same rule as the clinic page (`/admin/clinics/[id]` is a 404 to them otherwise).
 */
function mayActOn(user: AdminUser, assignedTo: string | null): boolean {
  return canManageTeam(user) || assignedTo === user.id;
}

export type InvoiceActionState = { error?: string; saved?: boolean };

const schema = z.object({
  clinicId: z.string().uuid("Pick a clinic."),
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).optional(),
});

const editSchema = schema.omit({ clinicId: true });

const taxSchema = z.object({
  label: z.string().trim().min(1, "Name the tax, e.g. Sales tax.").max(60),
  rate: z.coerce
    .number({ message: "Enter the tax rate as a number." })
    .gt(0, "Enter a tax rate above 0%, or untick Add tax.")
    .max(100, "A tax rate cannot be above 100%."),
});

/**
 * The "Add tax" tick and its two fields. Unticked = no tax (null); ticked = the label
 * and rate as typed, validated — never filled in from the company default here, so what
 * the person saw on the form is what is stored.
 */
function parseTax(formData: FormData): { tax: InvoiceTaxInput } | { error: string } {
  if (formData.get("addTax") !== "1") return { tax: null };
  const parsed = taxSchema.safeParse({ label: formData.get("taxLabel"), rate: formData.get("taxRate") });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  return { tax: { label: parsed.data.label, rate: Math.round(parsed.data.rate * 100) / 100 } };
}

const fmtField = (v: string | number | null) => (v === null || v === "" ? "none" : String(v));

/**
 * Corrects an issued invoice (sub_invoices:edit) — amount, period, due date, note.
 * The audit line names each field that changed, old → new, because the clinic may
 * already hold the earlier printout.
 */
export async function editClinicInvoiceAction(
  id: string,
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("sub_invoices:edit");
  const owner = await getInvoiceClinic(id);
  if (!owner || !mayActOn(user, owner.assignedTo)) return { error: "Invoice not found." };
  const parsed = editSchema.safeParse({
    amount: formData.get("amount"),
    periodStart: formData.get("periodStart") || undefined,
    periodEnd: formData.get("periodEnd") || undefined,
    dueOn: formData.get("dueOn") || undefined,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const d = parsed.data;
  if (d.periodStart && d.periodEnd && d.periodEnd < d.periodStart) {
    return { error: "The period ends before it starts." };
  }
  const tax = parseTax(formData);
  if ("error" in tax) return { error: tax.error };

  const res = await updateClinicInvoice(
    id,
    {
      amount: d.amount,
      tax: tax.tax,
      periodStart: d.periodStart ?? null,
      periodEnd: d.periodEnd ?? null,
      dueOn: d.dueOn ?? null,
      note: d.note ?? null,
    },
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  );
  if ("error" in res) return { error: res.error };

  const labels = { amount: "amount", tax: "tax", taxAmount: "tax amount", periodStart: "period start", periodEnd: "period end", dueOn: "due date", note: "note" } as const;
  const changes = (Object.keys(labels) as (keyof typeof labels)[])
    .filter((k) => res.before[k] !== res.after[k])
    // The note is free text the clinic wrote nothing in; say THAT it changed, not what.
    .map((k) => (k === "note" ? "note" : `${labels[k]} ${fmtField(res.before[k])} → ${fmtField(res.after[k])}`));
  if (changes.length === 0) return { saved: true };

  await logActivity({
    action: "update",
    entity: "settings",
    entityId: id,
    clinicId: res.clinicId,
    summary: `Edited subscription invoice ${res.label}: ${changes.join(", ")}`,
  });
  revalidatePath("/admin/finance/invoices");
  revalidatePath(`/admin/clinics/${res.clinicId}`);
  return { saved: true };
}

/** Issue a subscription invoice to a clinic (sub_invoices:create). */
export async function issueClinicInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("sub_invoices:create");
  const parsed = schema.safeParse({
    clinicId: formData.get("clinicId"),
    amount: formData.get("amount"),
    periodStart: formData.get("periodStart") || undefined,
    periodEnd: formData.get("periodEnd") || undefined,
    dueOn: formData.get("dueOn") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const clinic = await getClinic(parsed.data.clinicId);
  if (!clinic || !mayActOn(user, clinic.assignedTo)) return { error: "Clinic not found." };
  if (parsed.data.periodStart && parsed.data.periodEnd && parsed.data.periodEnd < parsed.data.periodStart) {
    return { error: "The period ends before it starts." };
  }
  const tax = parseTax(formData);
  if ("error" in tax) return { error: tax.error };

  const res = await issueClinicInvoice(
    {
      clinicId: parsed.data.clinicId,
      tax: tax.tax,
      periodStart: parsed.data.periodStart ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      dueOn: parsed.data.dueOn ?? null,
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
    summary: `Issued subscription invoice ${res.label} (Rs ${parsed.data.amount}${
      tax.tax ? ` + ${tax.tax.label} ${tax.tax.rate}%` : ""
    })`,
  });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}

const taxSettingsSchema = z.object({
  taxLabel: z.string().trim().min(1, "Name the tax, e.g. Sales tax.").max(60),
  taxRate: z.coerce.number({ message: "Enter the tax rate as a number." }).min(0).max(100, "A tax rate cannot be above 100%."),
  ntn: z.string().trim().max(30).optional(),
  strn: z.string().trim().max(30).optional(),
});

/**
 * The per-province rows of the tax settings form (`prov_<code>_label` / `_rate`). A
 * blank rate means "no rate for this province" — its clinics then start from the
 * company default — so it is left out, not stored as 0.
 */
function parseProvinceTaxFields(formData: FormData): { provinceTax: ProvinceTaxMap } | { error: string } {
  const provinceTax: ProvinceTaxMap = {};
  for (const p of PROVINCES) {
    const rawRate = String(formData.get(`prov_${p.code}_rate`) ?? "").trim();
    if (rawRate === "") continue;
    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      return { error: `${p.label}: enter a rate above 0% and up to 100%, or leave it empty.` };
    }
    const label = String(formData.get(`prov_${p.code}_label`) ?? "").trim().slice(0, 60);
    provinceTax[p.code] = { label: label || "Sales tax", rate: Math.round(rate * 100) / 100 };
  }
  return { provinceTax };
}

/**
 * The company's invoice-tax defaults (what "Add tax" starts from) and its NTN / STRN,
 * printed on every invoice. Company-wide, so full admins only — the same people who
 * manage the team. Changing them never touches an invoice already issued.
 */
export async function saveInvoiceTaxSettingsAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("sub_invoices:edit");
  if (!canManageTeam(user)) return { error: "Only a full admin can change the company's tax details." };
  const parsed = taxSettingsSchema.safeParse({
    taxLabel: formData.get("taxLabel"),
    taxRate: formData.get("taxRate"),
    ntn: formData.get("ntn") ?? undefined,
    strn: formData.get("strn") ?? undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const prov = parseProvinceTaxFields(formData);
  if ("error" in prov) return { error: prov.error };
  await setCompanyInvoiceTaxSettings({
    taxLabel: parsed.data.taxLabel,
    taxRate: Math.round(parsed.data.taxRate * 100) / 100,
    ntn: parsed.data.ntn ?? null,
    strn: parsed.data.strn ?? null,
    provinceTax: prov.provinceTax,
  });
  const provSummary = PROVINCES.filter((p) => prov.provinceTax[p.code])
    .map((p) => `${p.label} ${prov.provinceTax[p.code]!.rate}%`)
    .join(", ");
  await logActivity({
    action: "update",
    entity: "settings",
    entityId: null,
    clinicId: null,
    summary: `Invoice tax settings: default ${parsed.data.taxLabel} ${parsed.data.taxRate}%; by province: ${provSummary || "none"}; NTN ${parsed.data.ntn || "none"}, STRN ${parsed.data.strn || "none"}`,
  });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}

export async function voidClinicInvoiceAction(id: string): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("sub_invoices:delete");
  const owner = await getInvoiceClinic(id);
  if (!owner || !mayActOn(user, owner.assignedTo)) return { error: "Invoice not found." };
  const ok = await voidClinicInvoice(id, user.id);
  if (!ok) return { error: "Invoice not found." };
  await logActivity({ action: "delete", entity: "settings", entityId: id, clinicId: owner.clinicId, summary: "Voided a subscription invoice" });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}

export async function restoreClinicInvoiceAction(id: string): Promise<InvoiceActionState> {
  const user = await requireAdminCapability("sub_invoices:delete");
  const owner = await getInvoiceClinic(id);
  if (!owner || !mayActOn(user, owner.assignedTo)) return { error: "Invoice not found." };
  const ok = await restoreClinicInvoice(id);
  if (!ok) return { error: "Invoice not found." };
  await logActivity({ action: "update", entity: "settings", entityId: id, clinicId: owner.clinicId, summary: "Restored a subscription invoice" });
  revalidatePath("/admin/finance/invoices");
  return { saved: true };
}
