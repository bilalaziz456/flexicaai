import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments } from "@/core/db/schema";
import {
  notifyAppointmentBooked,
  notifyAppointmentsCancelled,
} from "@/core/notifications/appointment";
import { recordSaleForAppointment, voidSaleForAppointment } from "@/core/sales/ledger";
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

    // Sales ledger: a completed appointment is a realised sale; leaving "completed"
    // voids it. Inside the transaction, so a ledger failure rolls the status back
    // rather than leaving the two disagreeing.
    if (status === "completed") {
      await recordSaleForAppointment(clinicId, appointmentId, tx);
    } else if (prior.status === "completed") {
      await voidSaleForAppointment(clinicId, appointmentId, tx);
    }
  });

  // ── Everything below is an EXTERNAL side effect, deliberately outside the
  // transaction: a WhatsApp send or an audit write must never roll back a clinical
  // status change, and holding a DB transaction open across a network call to a
  // provider is how you exhaust a connection pool.
  if (status === "cancelled") {
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
