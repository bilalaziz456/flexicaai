import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, doctorSettlementActions, users } from "@/core/db/schema";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { displayStaffName } from "@/core/types/auth";

/**
 * A doctor's earning line on a completed appointment (the consultation or one
 * procedure) — for the per-line waive UI on the appointment detail. `earned` is the
 * doctor's share for that line on the collected basis (gross line share × collected ÷
 * gross), matching `sale_shares`. `waivedActionId` is set when a `doctor_waive` already
 * covers this line (so the UI shows "Waived" + undo).
 */
export type DoctorEarningLine = {
  lineRef: string; // 'consultation' | appointment_procedures row id
  label: string;
  doctorId: string;
  doctorName: string | null;
  earned: number;
  waivedActionId: string | null;
};

const clampPct = (p: number) => Math.max(0, Math.min(100, Math.round(p)));

export async function getAppointmentDoctorLines(
  clinicId: string,
  appointmentId: string,
): Promise<DoctorEarningLine[]> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId);
  if (!ctx.found || ctx.grossTotal <= 0) return [];

  const [appt] = await db
    .select({ collected: appointments.amountCollected, status: appointments.status })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  // Only a completed visit has realised earnings to waive.
  if (!appt || appt.status !== "completed") return [];

  const collected = Math.max(0, Math.min(appt.collected ?? 0, ctx.netEffective));
  const fraction = ctx.grossTotal > 0 ? collected / ctx.grossTotal : 0;

  // Gross share per line → collected-scaled earned share (like the share ledger).
  const raw: { lineRef: string; label: string; doctorId: string; earned: number }[] = [];
  const add = (lineRef: string, label: string, doctorId: string | null, grossShare: number) => {
    if (!doctorId) return;
    const earned = Math.round(grossShare * fraction);
    if (earned > 0) raw.push({ lineRef, label, doctorId, earned });
  };
  if (ctx.consultation && ctx.consultation.fee > 0) {
    add("consultation", "Consultation", ctx.consultation.doctorId, Math.round((ctx.consultation.fee * clampPct(ctx.consultation.pct)) / 100));
  }
  for (const l of ctx.lines) {
    add(l.lineRef, l.label, l.doctorId, Math.round((l.gross * clampPct(l.pct)) / 100));
  }
  if (raw.length === 0) return [];

  // Existing doctor_waive rows for this appointment, keyed by line.
  const waives = await db
    .select({ id: doctorSettlementActions.id, lineRef: doctorSettlementActions.lineRef })
    .from(doctorSettlementActions)
    .where(
      byClinic(
        doctorSettlementActions.clinicId,
        clinicId,
        and(eq(doctorSettlementActions.appointmentId, appointmentId), eq(doctorSettlementActions.kind, "doctor_waive")),
      ),
    );
  const waivedByRef = new Map<string, string>();
  for (const w of waives) if (w.lineRef) waivedByRef.set(w.lineRef, w.id);

  const ids = [...new Set(raw.map((r) => r.doctorId))];
  const nameRows = await db
    .select({ id: users.id, fullName: users.fullName, username: users.username, prefix: users.prefix })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, inArray(users.id, ids)));
  const names = new Map(nameRows.map((r) => [r.id, displayStaffName(r.prefix, r.fullName, r.username)]));

  return raw.map((r) => ({
    lineRef: r.lineRef,
    label: r.label,
    doctorId: r.doctorId,
    doctorName: names.get(r.doctorId) ?? null,
    earned: r.earned,
    waivedActionId: waivedByRef.get(r.lineRef) ?? null,
  }));
}
