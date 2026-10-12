import "server-only";

import { autoIssueInvoice, setInvoicesVoid } from "@/core/billing/invoice";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments } from "@/core/db/schema";
import {
  notifyAppointmentBooked,
  notifyAppointmentsCancelled,
} from "@/core/notifications/appointment";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { logActivity } from "@/core/audit/log";
import type { AppointmentStatus } from "./status";

/**
 * Apply an appointment status transition and all of its side effects — CORE,
 * clinic-scoped. This is the single place the transition lives so its hooks can
 * never drift between callers (reception/clinic status control and the doctor's
 * queue):
 *   - stamps `arrivedAt` on check-in (and clears it if the visit reverts to a
 *     pre-arrival state);
 *   - notifies the patient on cancel, and on a staff-confirmed WhatsApp booking;
 *   - keeps the sales ledger in step (record on completion, void on leaving it);
 *   - writes the activity log.
 *
 * Returns true when something changed (false = appointment not found, or already in
 * that status). The CALLER owns authorization and revalidation.
 */
export async function applyAppointmentStatus(
  clinicId: string,
  appointmentId: string,
  status: AppointmentStatus,
  /** `notify: false` skips the patient's WhatsApp message — for a cancellation that is
   *  an office correction (an invoice deleted from the Invoices page), not news the
   *  patient needs. */
  opts: { notify?: boolean } = {},
): Promise<boolean> {
  // Source + prior status decide whether/what to message the patient.
  const [prior] = await db
    .select({ source: appointments.source, status: appointments.status })
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
  if (!prior || prior.status === status) return false; // nothing to change

  const now = new Date();

  // ONE unit of work: the status change AND the derived ledgers it implies (ADR-016).
  // Completion is the event that creates revenue, so "this visit is completed" and
  // "this visit's revenue, doctor shares and discount settlement" must become true
  // together or not at all. They used to be five sequential writes on five
  // connections — a crash between them left a visit marked completed with no sale, or
  // a sale with nobody credited, and nothing recomputed it.
  //
  // The derived writes READ the appointment back, so they must run on this same
  // transaction: on the pool they would see the pre-update status and snapshot the
  // wrong thing (see core/db/tx.ts).
  await db.transaction(async (tx) => {
    await tx
      .update(appointments)
      .set({
        status,
        updatedAt: now,
        ...(status === "arrived"
          ? { arrivedAt: now }
          : status === "scheduled" || status === "confirmed"
            ? { arrivedAt: null }
            : {}),
      })
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));

    // Sales ledger: revenue follows the MONEY, not the status (owner's call,
    // 2026-10-13), so a status change no longer creates or removes revenue. It is
    // still re-derived when completion changes, because the discount settlement is
    // recognised at completion. Inside the transaction, so a ledger failure rolls the
    // status back rather than leaving the two disagreeing.
    if (status === "completed" || prior.status === "completed") {
      await recordSaleForAppointment(clinicId, appointmentId, tx);
    }

    // The invoice follows the visit: a cancelled or no-show visit's invoice is VOID
    // (number kept), and bringing the visit back restores the same number.
    const gone = (s: string) => s === "cancelled" || s === "no_show";
    if (gone(status) && !gone(prior.status)) {
      await setInvoicesVoid(tx, clinicId, [appointmentId], true, status === "no_show" ? "No-show" : "Cancelled");
    } else if (gone(prior.status) && !gone(status)) {
      await setInvoicesVoid(tx, clinicId, [appointmentId], false);
    }
  });

  // A visit going ahead gets its invoice number. This is where a WhatsApp request
  // gets one — when the front desk confirms it, not when the patient sent it, so a
  // declined request uses up no number. Staff bookings already have theirs from
  // booking (idempotent). Best-effort, like everything below.
  if (status === "confirmed" || status === "arrived" || status === "in_progress" || status === "completed") {
    await autoIssueInvoice(clinicId, appointmentId, { id: null, name: "Automatic" });
  }

  // ── Everything below is an EXTERNAL side effect, deliberately outside the
  // transaction: a WhatsApp send or an audit write must never roll back a clinical
  // status change, and holding a DB transaction open across a network call to a
  // provider is how you exhaust a connection pool.
  if (opts.notify === false) {
    // An office correction: nothing to tell the patient.
  } else if (status === "cancelled") {
    await notifyAppointmentsCancelled(clinicId, [appointmentId]);
  } else if (status === "confirmed" && prior.source === "whatsapp") {
    await notifyAppointmentBooked(clinicId, appointmentId);
  }

  await logActivity({
    action: "status",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Marked an appointment ${status.replace("_", " ")}`,
  });
  return true;
}

/**
 * Taking money for a visit confirms it — but only ever FORWARD: a `scheduled`
 * appointment becomes `confirmed`, and every other status is left alone.
 *
 * WHY NOT ALWAYS SET IT. Money is usually taken at the desk after the visit, when the
 * appointment is already arrived, in progress or completed. Setting any of those to
 * `confirmed` would move it BACKWARDS: an arrived patient would drop out of the
 * doctor's queue, and a completed visit would void its sale — the payment just taken
 * would vanish from the P&L at the moment it was collected. Cancelled and no-show are
 * left alone too: a late payment is not a decision to reinstate the visit.
 *
 * Goes through `applyAppointmentStatus`, so the WhatsApp confirmation for a patient's
 * self-booking, the audit row and the ledger hooks behave exactly as a manual confirm.
 * Returns true when it confirmed.
 */
export async function confirmAppointmentOnPayment(
  clinicId: string,
  appointmentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: appointments.status })
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
  if (row?.status !== "scheduled") return false;
  return applyAppointmentStatus(clinicId, appointmentId, "confirmed");
}
