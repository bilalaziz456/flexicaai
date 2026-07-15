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
import { appointments } from "@/core/db/schema";
import {
  recordPayment,
  applyAdvance,
  refund,
  voidPayment,
} from "@/core/billing/payments";
import { issueInvoice } from "@/core/billing/invoice";
import { logActivity } from "@/core/audit/log";

export type BillingActionState = { error?: string; saved?: boolean };

/** Billing is front-desk work: receptionist / manager / clinic admin, gated per action. */
async function requireBilling(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string } | { error: string }> {
  const user = await requireRole(["receptionist", "manager", "doctor", "clinic_admin"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "billing", action)) return { error: "You don't have permission for that." };
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

/** Refund from an appointment's collected amount. Stricter (billing:delete). */
export async function refundAppointmentPayment(
  appointmentId: string,
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const guard = await requireBilling("delete");
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

/** Void (soft-delete) a ledger entry. Stricter (billing:delete). */
export async function voidAppointmentPayment(
  appointmentId: string,
  paymentId: string,
): Promise<BillingActionState> {
  const guard = await requireBilling("delete");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const res = await voidPayment(clinicId, paymentId, actorOf(user));
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "delete",
    entity: "appointment",
    entityId: appointmentId,
    summary: "Voided a payment",
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
