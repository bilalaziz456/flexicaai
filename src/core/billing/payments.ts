import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { appointments, clinics, patientPayments, patients } from "@/core/db/schema";
import { getAppointmentBill } from "@/core/billing/bill";
import { recordSaleForAppointment } from "@/core/sales/ledger";

/**
 * Patient payments — CORE (Finance). An amount-based subledger on the patient's
 * account: `payment` (against a visit bill), `advance` (prepaid credit),
 * `advance_applied` (credit consumed by a bill), `refund`. All amounts positive;
 * `appointments.amount_collected` is recomputed from the ledger after every change,
 * so it can never drift. A void is a soft-delete. All clinic-scoped, atomic.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; name: string };
type PayResult = { error: string } | { ok: true; paid: number; credited: number };

/**
 * Allocate a per-visit payment-receipt number (RCP series) the FIRST time money is
 * received on an appointment — idempotent (skips if it already has one). Resets to 1
 * each new year, allocated under a clinic-row lock so concurrent receptionists never
 * collide (mirrors invoice numbering). Never cleared once set (like an invoice #).
 */
async function ensureReceiptNumber(tx: Tx, clinicId: string, appointmentId: string): Promise<void> {
  const [a] = await tx
    .select({ receiptNo: appointments.receiptNo })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  if (!a || a.receiptNo != null) return;

  const [c] = await tx
    .select({ next: clinics.nextReceiptNo, year: clinics.receiptYear })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .for("update")
    .limit(1);
  if (!c) return;
  const currentYear = new Date().getFullYear();
  const allocated = c.year === currentYear ? c.next : 1;
  await tx
    .update(clinics)
    .set({ nextReceiptNo: allocated + 1, receiptYear: currentYear, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
  await tx
    .update(appointments)
    .set({ receiptNo: allocated, receiptYear: currentYear })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));
}

/** Recompute an appointment's collected cache from its live ledger rows. */
async function recomputeCollected(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  const [row] = await tx
    .select({
      c: sql<number>`coalesce(sum(case when ${patientPayments.kind} = 'refund' then -${patientPayments.amount} else ${patientPayments.amount} end), 0)::int`,
    })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        and(
          eq(patientPayments.appointmentId, appointmentId),
          inArray(patientPayments.kind, ["payment", "advance_applied", "refund"]),
        ),
      ),
    );
  const collected = Math.max(0, Number(row?.c ?? 0));
  await tx
    .update(appointments)
    .set({ amountCollected: collected, updatedAt: new Date() })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));
  // Stamp the receipt number on the first money-in for this visit.
  if (collected > 0) await ensureReceiptNumber(tx, clinicId, appointmentId);
}

/** A patient's unallocated advance credit = Σadvance − Σadvance_applied − Σrefund(unallocated). */
export async function getPatientCredit(
  clinicId: string,
  patientId: string,
): Promise<number> {
  const [row] = await db
    .select({
      credit: sql<number>`coalesce(sum(case
        when ${patientPayments.kind} = 'advance' then ${patientPayments.amount}
        when ${patientPayments.kind} = 'advance_applied' then -${patientPayments.amount}
        when ${patientPayments.kind} = 'refund' and ${patientPayments.appointmentId} is null then -${patientPayments.amount}
        else 0 end), 0)::int`,
    })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        eq(patientPayments.patientId, patientId),
      ),
    );
  return Math.max(0, Number(row?.credit ?? 0));
}

/** Net imported opening balance a patient still owes (opening_balance − Σ 'opening' payments). */
export async function getOpeningBalanceOwed(clinicId: string, patientId: string): Promise<number> {
  const [p] = await db
    .select({ opening: patients.openingBalance })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  if (!p) return 0;
  const [paid] = await db
    .select({ v: sql<number>`coalesce(sum(${patientPayments.amount}), 0)::int` })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        and(eq(patientPayments.patientId, patientId), eq(patientPayments.kind, "opening")),
      ),
    );
  return Math.max(0, p.opening - Number(paid?.v ?? 0));
}

/**
 * Settle (part of) a patient's imported OPENING balance — a standalone money-in row
 * (kind `opening`, no appointment), validated `0 < amount ≤ owed`. Not tied to a
 * visit, so no `amount_collected`/sales recompute. Clinic-scoped.
 */
export async function settleOpeningBalance(
  clinicId: string,
  input: { patientId: string; amount: number; method: string | null; reference: string | null; note: string | null; actor: Actor },
): Promise<PayResult> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!(await patientInClinic(clinicId, input.patientId))) return { error: "Patient not found." };
  const owed = await getOpeningBalanceOwed(clinicId, input.patientId);
  if (owed <= 0) return { error: "No opening balance outstanding." };
  if (amount > owed) return { error: `Can't pay more than the opening balance (Rs ${owed}).` };

  await db.insert(patientPayments).values({
    clinicId,
    patientId: input.patientId,
    appointmentId: null,
    kind: "opening",
    amount,
    method: input.method?.slice(0, 40) || null,
    reference: input.reference?.slice(0, 120) || null,
    note: input.note?.slice(0, 500) ?? null,
    createdBy: input.actor.id,
    createdByName: input.actor.name,
  });
  return { ok: true, paid: amount, credited: 0 };
}

export type LedgerEntry = {
  id: string;
  kind: string;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  createdByName: string | null;
  occurredAt: Date;
};

/** An appointment's live payment ledger rows, newest first (for the detail panel). */
export async function listAppointmentPayments(
  clinicId: string,
  appointmentId: string,
): Promise<LedgerEntry[]> {
  return db
    .select({
      id: patientPayments.id,
      kind: patientPayments.kind,
      amount: patientPayments.amount,
      method: patientPayments.method,
      reference: patientPayments.reference,
      note: patientPayments.note,
      createdByName: patientPayments.createdByName,
      occurredAt: patientPayments.occurredAt,
    })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        eq(patientPayments.appointmentId, appointmentId),
      ),
    )
    .orderBy(sql`${patientPayments.occurredAt} desc`);
}

async function patientInClinic(clinicId: string, patientId: string): Promise<boolean> {
  const [p] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  return Boolean(p);
}

/**
 * Record a payment. Tied to an appointment → pays that bill; any amount beyond the
 * outstanding becomes an **advance** (credit). With no appointment → a pure advance
 * (deposit). Returns how much went to the bill vs credit.
 */
export async function recordPayment(
  clinicId: string,
  input: {
    patientId: string;
    appointmentId?: string | null;
    amount: number;
    method: string | null;
    reference: string | null;
    note: string | null;
    actor: Actor;
  },
): Promise<PayResult> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!(await patientInClinic(clinicId, input.patientId))) return { error: "Patient not found." };

  const base = {
    clinicId,
    patientId: input.patientId,
    method: input.method?.slice(0, 40) || null,
    reference: input.reference?.slice(0, 120) || null,
    note: input.note?.slice(0, 500) ?? null,
    createdBy: input.actor.id,
    createdByName: input.actor.name,
  };

  // Pure advance (deposit) — not tied to a visit.
  if (!input.appointmentId) {
    await db.insert(patientPayments).values({ ...base, appointmentId: null, kind: "advance", amount });
    return { ok: true, paid: 0, credited: amount };
  }

  const bill = await getAppointmentBill(clinicId, input.appointmentId);
  if (!bill.found) return { error: "Appointment not found." };

  const toBill = Math.min(amount, bill.outstanding);
  const excess = amount - toBill;

  await db.transaction(async (tx) => {
    if (toBill > 0) {
      await tx
        .insert(patientPayments)
        .values({ ...base, appointmentId: input.appointmentId, kind: "payment", amount: toBill });
    }
    if (excess > 0) {
      await tx.insert(patientPayments).values({ ...base, appointmentId: null, kind: "advance", amount: excess });
    }
    await recomputeCollected(tx, clinicId, input.appointmentId!);
  });
  // Re-recognise revenue/shares on the new collected amount (collected basis).
  await recordSaleForAppointment(clinicId, input.appointmentId);
  return { ok: true, paid: toBill, credited: excess };
}

/** Apply a patient's advance credit to an appointment's outstanding bill. */
export async function applyAdvance(
  clinicId: string,
  input: { patientId: string; appointmentId: string; amount: number; actor: Actor },
): Promise<PayResult> {
  if (!(await patientInClinic(clinicId, input.patientId))) return { error: "Patient not found." };
  const bill = await getAppointmentBill(clinicId, input.appointmentId);
  if (!bill.found) return { error: "Appointment not found." };
  const credit = await getPatientCredit(clinicId, input.patientId);
  const applyAmt = Math.min(Math.round(input.amount), bill.outstanding, credit);
  if (applyAmt <= 0) {
    return { error: credit <= 0 ? "No advance credit available." : "Nothing outstanding on this visit." };
  }

  await db.transaction(async (tx) => {
    await tx.insert(patientPayments).values({
      clinicId,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      kind: "advance_applied",
      amount: applyAmt,
      method: "advance",
      createdBy: input.actor.id,
      createdByName: input.actor.name,
    });
    await recomputeCollected(tx, clinicId, input.appointmentId);
  });
  await recordSaleForAppointment(clinicId, input.appointmentId);
  return { ok: true, paid: applyAmt, credited: 0 };
}

/**
 * Refund — either unallocated advance credit (no appointment; reduces credit,
 * P&L-neutral) or a collected payment on a visit (reduces that visit's collected).
 */
export async function refund(
  clinicId: string,
  input: {
    patientId: string;
    appointmentId?: string | null;
    amount: number;
    method: string | null;
    reference: string | null;
    note: string | null;
    actor: Actor;
  },
): Promise<PayResult> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!(await patientInClinic(clinicId, input.patientId))) return { error: "Patient not found." };

  if (input.appointmentId) {
    const bill = await getAppointmentBill(clinicId, input.appointmentId);
    if (!bill.found) return { error: "Appointment not found." };
    if (amount > bill.collected) return { error: `Can't refund more than collected (Rs ${bill.collected}).` };
  } else {
    const credit = await getPatientCredit(clinicId, input.patientId);
    if (amount > credit) return { error: `Can't refund more than the credit (Rs ${credit}).` };
  }

  await db.transaction(async (tx) => {
    await tx.insert(patientPayments).values({
      clinicId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      kind: "refund",
      amount,
      method: input.method?.slice(0, 40) || null,
      reference: input.reference?.slice(0, 120) || null,
      note: input.note?.slice(0, 500) ?? null,
      createdBy: input.actor.id,
      createdByName: input.actor.name,
    });
    if (input.appointmentId) await recomputeCollected(tx, clinicId, input.appointmentId);
  });
  if (input.appointmentId) await recordSaleForAppointment(clinicId, input.appointmentId);
  return { ok: true, paid: 0, credited: 0 };
}

/** Void (soft-delete) a ledger entry — a correction. Recomputes the visit's collected. */
export async function voidPayment(
  clinicId: string,
  paymentId: string,
  actor: Actor,
): Promise<{ error: string } | { ok: true }> {
  const [row] = await db
    .select({ appointmentId: patientPayments.appointmentId })
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

  await db.transaction(async (tx) => {
    await tx
      .update(patientPayments)
      .set(softDeleteValues(actor.id, newDeleteGroup()))
      .where(byClinic(patientPayments.clinicId, clinicId, eq(patientPayments.id, paymentId)));
    if (row.appointmentId) await recomputeCollected(tx, clinicId, row.appointmentId);
  });
  if (row.appointmentId) await recordSaleForAppointment(clinicId, row.appointmentId);
  return { ok: true };
}
