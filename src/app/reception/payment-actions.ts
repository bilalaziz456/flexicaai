"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { displayStaffName } from "@/core/types/auth";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patientPayments } from "@/core/db/schema";
import {
  recordPayment,
  applyAdvance,
  refund,
  voidPayment,
  settleOpeningBalance,
} from "@/core/billing/payments";
import { issueInvoice } from "@/core/billing/invoice";
import { sendInvoiceWhatsApp } from "@/core/notifications/billing";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import { logActivity } from "@/core/audit/log";

export type BillingActionState = { error?: string; saved?: boolean };

/**
 * Billing is front-desk work: receptionist / manager / clinic admin, gated per
 * action. `resource` is "billing" for collect/void, or "refund" for refunds —
 * refunds are a separate ACL slug so they can be granted independently.
 */
async function requireBilling(
  action: PermAction,
  resource: "billing" | "refund" = "billing",
): Promise<{ user: CurrentUser; clinicId: string } | { error: string }> {
  const user = await requireRole(["receptionist", "manager", "doctor", "clinic_admin"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, resource, action)) return { error: "You don't have permission for that." };
  return { user, clinicId: user.clinicId };
}

/** The appointment's patient (clinic-scoped) — every payment is tied to a patient. */
async function apptPatient(clinicId: string, appointmentId: string): Promise<string | null> {
  const [a] = await db
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  return a?.patientId ?? null;
}

const actorOf = (u: CurrentUser) => ({
  id: u.id,
  name: displayStaffName(u.prefix, u.fullName, u.username),
});

function revalidateAppt(appointmentId: string, patientId: string | null) {
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidatePath(`/reception/appointments/${appointmentId}`);
  revalidatePath("/clinic/appointments");
  if (patientId) revalidatePath(`/clinic/patients/${patientId}`);
  // A payment changes collected revenue → refresh the dashboard KPIs + reports.
  revalidateFinance();
}

const amountSchema = z.coerce.number().int().positive("Enter an amount greater than zero.");
const methodSchema = z.string().trim().max(40).optional();
const refSchema = z.string().trim().max(120).optional();
const noteSchema = z.string().trim().max(500).optional();

/** Collect a payment against an appointment's bill (excess becomes advance credit). */
export async function collectPayment(
  appointmentId: string,
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const guard = await requireBilling("create");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const parsed = z
    .object({ amount: amountSchema, method: methodSchema, reference: refSchema, note: noteSchema })
    .safeParse({
      amount: formData.get("amount"),
      method: formData.get("method") || undefined,
      reference: formData.get("reference") || undefined,
      note: formData.get("note") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const patientId = await apptPatient(clinicId, appointmentId);
  if (!patientId) return { error: "Appointment not found." };

  const res = await recordPayment(clinicId, {
    patientId,
    appointmentId,
    amount: parsed.data.amount,
    method: parsed.data.method ?? null,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    actor: actorOf(user),
  });
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "create",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Collected Rs ${res.paid + res.credited}${res.credited ? ` (Rs ${res.credited} to credit)` : ""}`,
  });
  revalidateAppt(appointmentId, patientId);
  return { saved: true };
}

/** Record a payment against a patient's imported OPENING balance (not a visit). */
export async function recordOpeningPayment(
  patientId: string,
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const guard = await requireBilling("create");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const parsed = z
    .object({ amount: amountSchema, method: methodSchema, reference: refSchema, note: noteSchema })
    .safeParse({
      amount: formData.get("amount"),
      method: formData.get("method") || undefined,
      reference: formData.get("reference") || undefined,
      note: formData.get("note") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const res = await settleOpeningBalance(clinicId, {
    patientId,
    amount: parsed.data.amount,
    method: parsed.data.method ?? null,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    actor: actorOf(user),
  });
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "create",
    entity: "patient",
    entityId: patientId,
    summary: `Opening balance payment Rs ${res.paid}`,
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  revalidateFinance();
  return { saved: true };
}

/** Apply the patient's advance credit to this appointment's outstanding bill. */
export async function applyAppointmentAdvance(
  appointmentId: string,
  amount: number,
): Promise<BillingActionState> {
  const guard = await requireBilling("edit");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const patientId = await apptPatient(clinicId, appointmentId);
  if (!patientId) return { error: "Appointment not found." };

  const res = await applyAdvance(clinicId, { patientId, appointmentId, amount, actor: actorOf(user) });
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Applied Rs ${res.paid} advance credit`,
  });
  revalidateAppt(appointmentId, patientId);
  return { saved: true };
}

/** Refund from an appointment's collected amount. Needs `refund:create`. */
export async function refundAppointmentPayment(
  appointmentId: string,
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const guard = await requireBilling("create", "refund");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const parsed = z
    .object({ amount: amountSchema, method: methodSchema, reference: refSchema, note: noteSchema })
    .safeParse({
      amount: formData.get("amount"),
      method: formData.get("method") || undefined,
      reference: formData.get("reference") || undefined,
      note: formData.get("note") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const patientId = await apptPatient(clinicId, appointmentId);
  if (!patientId) return { error: "Appointment not found." };

  const res = await refund(clinicId, {
    patientId,
    appointmentId,
    amount: parsed.data.amount,
    method: parsed.data.method ?? null,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    actor: actorOf(user),
  });
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "delete",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Refunded Rs ${parsed.data.amount}`,
  });
  revalidateAppt(appointmentId, patientId);
  return { saved: true };
}

/**
 * Void (soft-delete) a ledger entry. Reversing a REFUND row needs `refund:delete`;
 * reversing any other entry (payment/advance) needs `billing:delete` — so the two
 * powers can be granted independently. We read the row's kind first to pick the gate.
 */
export async function voidAppointmentPayment(
  appointmentId: string,
  paymentId: string,
): Promise<BillingActionState> {
  const user = await requireRole(["receptionist", "manager", "doctor", "clinic_admin"]);
  if (!user.clinicId) return { error: "No clinic access." };
  const clinicId = user.clinicId;

  const [row] = await db
    .select({ kind: patientPayments.kind })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        eq(patientPayments.id, paymentId),
      ),
    )
    .limit(1);
  if (!row) return { error: "Payment not found." };

  const resource = row.kind === "refund" ? "refund" : "billing";
  if (!can(user, resource, "delete")) return { error: "You don't have permission for that." };

  const res = await voidPayment(clinicId, paymentId, actorOf(user));
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "delete",
    entity: "appointment",
    entityId: appointmentId,
    summary: row.kind === "refund" ? "Reversed a refund" : "Voided a payment",
  });
  revalidateAppt(appointmentId, await apptPatient(clinicId, appointmentId));
  return { saved: true };
}

/** Issue (or re-fetch) the invoice for an appointment. */
export async function issueAppointmentInvoice(
  appointmentId: string,
): Promise<BillingActionState> {
  const guard = await requireBilling("create");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const res = await issueInvoice(clinicId, appointmentId, actorOf(user));
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "create",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Issued invoice ${res.label}`,
  });
  revalidateAppt(appointmentId, await apptPatient(clinicId, appointmentId));
  return { saved: true };
}

/**
 * Send the appointment's invoice / bill summary to the patient on WhatsApp. Two
 * gates: `billing:view` (may see the bill) AND `whatsapp:create` (may send a
 * message) — so delivery is separate from collecting money.
 */
export async function sendInvoiceWhatsAppAction(
  appointmentId: string,
): Promise<BillingActionState> {
  const user = await requireRole(["receptionist", "manager", "doctor", "clinic_admin"]);
  if (!user.clinicId) return { error: "No clinic access." };
  const clinicId = user.clinicId;
  if (!can(user, "billing", "view") || !can(user, "whatsapp", "create")) {
    return { error: "You don't have permission for that." };
  }

  const res = await sendInvoiceWhatsApp(clinicId, appointmentId);
  if (!res.ok) return { error: res.error ?? "Could not send." };

  await logActivity({
    action: "create",
    entity: "appointment",
    entityId: appointmentId,
    summary: "Sent invoice on WhatsApp",
  });
  revalidateAppt(appointmentId, await apptPatient(clinicId, appointmentId));
  return { saved: true };
}
