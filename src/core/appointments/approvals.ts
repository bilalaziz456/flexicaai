import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import {
  appointmentDiscountApprovals,
  appointments,
  clinics,
  patients,
  users,
} from "@/core/db/schema";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { discountBorneSplit } from "@/core/appointments/discount-bearing";

/** The overall discount status derived from an appointment's approval rows. */
export type DiscountStatus = "none" | "pending" | "approved" | "rejected";

/**
 * (Re)compute an appointment's discount approvals. Called after the discount /
 * borne-by / split / procedures change. Only the party that actually BEARS the
 * discount signs off (no spillover — the discount-bearing rule): clinic-borne → the
 * clinic; doctor-borne → the earning doctors; split → whichever side has a positive
 * portion. Of those bearers, the ones whose `discount_needs_approval` switch is ON
 * are required; it then replaces the approval rows and sets `discount_status`.
 *
 * With every default (borne-by = clinic, clinic switch off, doctor switches off)
 * nobody requires approval → status stays 'none' and the discount applies exactly
 * as before. The workflow only engages once a party opts in. Best-effort — a
 * failure here never blocks the booking (the caller ignores the result).
 */
export async function syncDiscountApprovals(
  clinicId: string,
  appointmentId: string,
): Promise<DiscountStatus> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId);

  const discount = Math.max(0, ctx.grossTotal - ctx.netRequested);
  // No discount → nothing to approve.
  if (!ctx.found || discount <= 0) {
    return clearApprovals(clinicId, appointmentId);
  }

  // Who actually BEARS the discount (positive portion), per the no-spill split.
  const { clinicBorne, doctorBorne } = discountBorneSplit(discount, ctx.borneBy, {
    type: ctx.discountSplitType === "amount" ? "amount" : "percent",
    value: ctx.discountSplitValue,
  });
  const clinicAffected = clinicBorne > 0;
  const doctorsAffected = doctorBorne > 0 ? ctx.earnerDoctorIds : [];

  // Of the affected parties, who requires approval?
  const [clinic] = await db
    .select({ needs: clinics.discountNeedsApproval })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const clinicRequires = clinicAffected && Boolean(clinic?.needs);

  let requiringDoctorIds: string[] = [];
  if (doctorsAffected.length > 0) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          and(
            inArray(users.id, doctorsAffected),
            eq(users.discountNeedsApproval, true),
          ),
        ),
      );
    requiringDoctorIds = rows.map((r) => r.id);
  }

  // Nobody requires approval → the discount applies immediately.
  if (!clinicRequires && requiringDoctorIds.length === 0) {
    return clearApprovals(clinicId, appointmentId);
  }

  // Replace the approval rows with a fresh pending set (re-submitting a discount
  // resets the whole batch to pending).
  await db
    .delete(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.appointmentId, appointmentId),
      ),
    );

  const rows: (typeof appointmentDiscountApprovals.$inferInsert)[] = [];
  if (clinicRequires) {
    rows.push({ clinicId, appointmentId, approverKind: "clinic", status: "pending" });
  }
  for (const doctorId of requiringDoctorIds) {
    rows.push({
      clinicId,
      appointmentId,
      approverKind: "doctor",
      approverDoctorId: doctorId,
      status: "pending",
    });
  }
  await db.insert(appointmentDiscountApprovals).values(rows);

  await setStatus(clinicId, appointmentId, "pending");
  return "pending";
}

/** Delete any approval rows and mark the discount status 'none' (applies). */
async function clearApprovals(
  clinicId: string,
  appointmentId: string,
): Promise<DiscountStatus> {
  await db
    .delete(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.appointmentId, appointmentId),
      ),
    );
  await setStatus(clinicId, appointmentId, "none");
  return "none";
}

async function setStatus(
  clinicId: string,
  appointmentId: string,
  status: DiscountStatus,
): Promise<void> {
  await db
    .update(appointments)
    .set({ discountStatus: status, updatedAt: new Date() })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));
}

/** Derive the overall status from an appointment's rows (any rejected → rejected;
 *  any still pending → pending; otherwise approved). Empty set → 'none'. */
function deriveStatus(statuses: string[]): DiscountStatus {
  if (statuses.length === 0) return "none";
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.includes("pending")) return "pending";
  return "approved";
}

export type ApprovalDecision = "approved" | "rejected";

/**
 * Record one approver's decision on a discount, then re-derive the appointment's
 * overall `discount_status`. Returns the new overall status (or an error string).
 * Authorisation is done by the caller via `canDecideRow`. Clinic-scoped.
 */
export async function decideDiscountApproval(
  clinicId: string,
  rowId: string,
  decision: ApprovalDecision,
  decidedBy: { id: string; name: string },
  note: string | null,
): Promise<{ appointmentId: string; status: DiscountStatus } | { error: string }> {
  const [row] = await db
    .update(appointmentDiscountApprovals)
    .set({
      status: decision,
      decidedBy: decidedBy.id,
      decidedByName: decidedBy.name,
      decidedAt: new Date(),
      note: note?.slice(0, 500) ?? null,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.id, rowId),
      ),
    )
    .returning({ appointmentId: appointmentDiscountApprovals.appointmentId });
  if (!row) return { error: "Approval not found." };

  const siblings = await db
    .select({ status: appointmentDiscountApprovals.status })
    .from(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.appointmentId, row.appointmentId),
      ),
    );
  const status = deriveStatus(siblings.map((s) => s.status));
  await setStatus(clinicId, row.appointmentId, status);
  return { appointmentId: row.appointmentId, status };
}

/** A pending approval as shown in the queue. */
export type PendingApproval = {
  id: string;
  appointmentId: string;
  approverKind: string;
  approverDoctorId: string | null;
  patientName: string | null;
  scheduledAt: Date;
  discountValue: number;
  discountType: string;
  borneBy: string;
};

/**
 * The pending discount approvals a user may act on: a doctor sees rows for their
 * OWN share; a clinic approver (holds the capability) sees clinic-borne rows. Pass
 * both flags from the action/page after the permission check.
 */
export async function listPendingApprovalsForUser(
  clinicId: string,
  opts: { doctorId: string; isClinicApprover: boolean },
): Promise<PendingApproval[]> {
  // A clinic approver may act on clinic rows AND their own doctor rows, so we scan
  // all this clinic's pending rows and narrow in JS below; a plain doctor only ever
  // sees their own rows, so we filter those in SQL.
  const kindFilter = opts.isClinicApprover
    ? eq(appointmentDiscountApprovals.status, "pending")
    : and(
        eq(appointmentDiscountApprovals.status, "pending"),
        eq(appointmentDiscountApprovals.approverDoctorId, opts.doctorId),
      );

  const rows = await db
    .select({
      id: appointmentDiscountApprovals.id,
      appointmentId: appointmentDiscountApprovals.appointmentId,
      approverKind: appointmentDiscountApprovals.approverKind,
      approverDoctorId: appointmentDiscountApprovals.approverDoctorId,
      patientName: patients.fullName,
      scheduledAt: appointments.scheduledAt,
      discountValue: appointments.discountValue,
      discountType: appointments.discountType,
      borneBy: appointments.discountBorneBy,
    })
    .from(appointmentDiscountApprovals)
    .innerJoin(appointments, eq(appointments.id, appointmentDiscountApprovals.appointmentId))
    .leftJoin(patients, eq(patients.id, appointments.patientId))
    .where(byClinic(appointmentDiscountApprovals.clinicId, clinicId, kindFilter))
    .orderBy(desc(appointments.scheduledAt));

  // A clinic approver's list = clinic rows + their own doctor rows. We filtered to
  // pending above; narrow in JS so the SQL stays a simple index scan.
  return rows.filter((r) =>
    opts.isClinicApprover
      ? r.approverKind === "clinic" || r.approverDoctorId === opts.doctorId
      : true,
  );
}

/**
 * Whether `user` may decide a given approval row. Clinic rows need the clinic
 * discount-approval capability; doctor rows are decided only by that doctor.
 */
export function canDecideRow(
  row: { approverKind: string; approverDoctorId: string | null },
  user: { id: string; isClinicApprover: boolean },
): boolean {
  if (row.approverKind === "clinic") return user.isClinicApprover;
  return row.approverDoctorId === user.id;
}
