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
  await db
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

  if (status === "cancelled") {
    await notifyAppointmentsCancelled(clinicId, [appointmentId]);
  } else if (status === "confirmed" && prior.source === "whatsapp") {
    await notifyAppointmentBooked(clinicId, appointmentId);
  }

  // Sales ledger: a completed appointment is a realised sale; leaving "completed"
  // voids it. Best-effort — never blocks the status change.
  if (status === "completed") {
    await recordSaleForAppointment(clinicId, appointmentId);
  } else if (prior.status === "completed") {
    await voidSaleForAppointment(clinicId, appointmentId);
  }

  await logActivity({
    action: "status",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Marked an appointment ${status.replace("_", " ")}`,
  });
  return true;
}
