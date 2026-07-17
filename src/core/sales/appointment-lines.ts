import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
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

type RawLine = { lineRef: string; label: string; doctorId: string; earned: number };

/**
 * Every earning line's collected-basis share for a COMPLETED appointment (earned may
 * be 0 — e.g. a completed-but-unpaid visit). Non-completed / not-found → []. The one
 * place the per-line earned number is computed; `getAppointmentDoctorLines` (display)
 * and `syncLineWaives` (keep waives in step) both read it.
 */
async function rawLineEarnings(clinicId: string, appointmentId: string): Promise<RawLine[]> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId);
  if (!ctx.found || ctx.grossTotal <= 0) return [];

  const [appt] = await db
    .select({ collected: appointments.amountCollected, status: appointments.status })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  if (!appt || appt.status !== "completed") return [];

  const collected = Math.max(0, Math.min(appt.collected ?? 0, ctx.netEffective));
  const fraction = ctx.grossTotal > 0 ? collected / ctx.grossTotal : 0;

  const out: RawLine[] = [];
  const add = (lineRef: string, label: string, doctorId: string | null, grossShare: number) => {
    if (doctorId) out.push({ lineRef, label, doctorId, earned: Math.round(grossShare * fraction) });
  };
  if (ctx.consultation && ctx.consultation.fee > 0) {
    add("consultation", "Consultation", ctx.consultation.doctorId, Math.round((ctx.consultation.fee * clampPct(ctx.consultation.pct)) / 100));
  }
  for (const l of ctx.lines) {
    add(l.lineRef, l.label, l.doctorId, Math.round((l.gross * clampPct(l.pct)) / 100));
  }
  return out;
}

export async function getAppointmentDoctorLines(
  clinicId: string,
  appointmentId: string,
): Promise<DoctorEarningLine[]> {
  const raw = (await rawLineEarnings(clinicId, appointmentId)).filter((r) => r.earned > 0);
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

/**
 * Re-sync every per-line `doctor_waive` on an appointment to its line's CURRENT earned
 * share, so a waived line nets to zero at any collection level (as the patient pays,
 * the earning and the waive grow together). A line that no longer earns — unpaid,
 * un-completed, soft-deleted, or removed from the visit — syncs to 0 (inert), so a
 * waive never lingers as a phantom deduction. Called from the sale record/void hooks;
 * best-effort.
 */
export async function syncLineWaives(clinicId: string, appointmentId: string): Promise<void> {
  try {
    const waives = await db
      .select({ id: doctorSettlementActions.id, lineRef: doctorSettlementActions.lineRef, amount: doctorSettlementActions.amount })
      .from(doctorSettlementActions)
      .where(
        byClinic(
          doctorSettlementActions.clinicId,
          clinicId,
          and(
            eq(doctorSettlementActions.appointmentId, appointmentId),
            eq(doctorSettlementActions.kind, "doctor_waive"),
            isNotNull(doctorSettlementActions.lineRef),
          ),
        ),
      );
    if (waives.length === 0) return;

    const earned = new Map((await rawLineEarnings(clinicId, appointmentId)).map((r) => [r.lineRef, r.earned]));
    for (const w of waives) {
      const target = earned.get(w.lineRef as string) ?? 0;
      if (target !== w.amount) {
        await db
          .update(doctorSettlementActions)
          .set({ amount: target })
          .where(byClinic(doctorSettlementActions.clinicId, clinicId, eq(doctorSettlementActions.id, w.id)));
      }
    }
  } catch {
    // best-effort
  }
}
