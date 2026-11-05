import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import {
  appointmentDiscountApprovals,
  appointmentProcedures,
  appointments,
  clinics,
  patients,
  users,
} from "@/core/db/schema";
import { getAppointmentShareContext, type RequestedPiece } from "@/core/appointments/share-context";
import { discountBorneSplit } from "@/core/appointments/discount-bearing";
import { notify, notifyUsersWithPermission } from "@/core/notifications/in-app";

/** The overall discount status derived from an appointment's approval rows. */
export type DiscountStatus = "none" | "pending" | "approved" | "rejected";

/**
 * (Re)compute an appointment's discount approvals. Called after any discount, bearer,
 * split or line changes.
 *
 * PER DISCOUNT (docs/per-line-discount-plan.md §6): each patient discount — a line's,
 * the consultation's, the whole visit's — is asked only of whoever BEARS it (no
 * spillover): clinic-borne → the clinic; doctor-borne → THAT line's doctor (the
 * overall discount: the earning doctors); split → each side with a positive portion.
 * Of those, the ones whose `discount_needs_approval` switch is ON are asked. Rows are
 * still one per party per visit; a party's decision covers everything it bears.
 *
 * Clinic offers never ask (the clinic's own standing decision), nor a treatment plan's
 * discount carried unchanged (agreed when the plan was made, owner's call 2026-10-18).
 *
 * With every default (clinic-borne, all switches off) nobody is asked → status stays
 * 'none' and every discount applies at once. Best-effort — the caller ignores failures.
 * Returns the visit's SUMMARY status (pending while anyone is).
 */
export async function syncDiscountApprovals(
  clinicId: string,
  appointmentId: string,
): Promise<DiscountStatus> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId);
  const asking = ctx.found ? ctx.requestedPieces.filter((p) => !p.fromPlan) : [];
  if (asking.length === 0) return clearApprovals(clinicId, appointmentId);

  // Each party that bears any asking discount, then the ones whose switch is on.
  const bearers = new Set<string>();
  for (const p of asking) for (const party of partiesBearing(p, ctx.earnerDoctorIds)) bearers.add(party);
  const [clinic] = await db
    .select({ needs: clinics.discountNeedsApproval })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const clinicRequires = bearers.has(CLINIC_PARTY) && Boolean(clinic?.needs);
  const doctorBearers = [...bearers].filter((b) => b !== CLINIC_PARTY);
  let requiringDoctorIds: string[] = [];
  if (doctorBearers.length > 0) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          and(inArray(users.id, doctorBearers), eq(users.discountNeedsApproval, true)),
        ),
      );
    requiringDoctorIds = rows.map((r) => r.id);
  }

  // Nobody requires approval → every discount applies immediately.
  if (!clinicRequires && requiringDoctorIds.length === 0) {
    return clearApprovals(clinicId, appointmentId);
  }

  // Whether anything was already waiting — so re-saving does not re-ping everyone.
  const before = await db
    .select({ status: appointmentDiscountApprovals.status })
    .from(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.appointmentId, appointmentId),
      ),
    );
  const wasPending = before.some((r) => r.status === "pending");

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
    rows.push({ clinicId, appointmentId, approverKind: "doctor", approverDoctorId: doctorId, status: "pending" });
  }
  await db.insert(appointmentDiscountApprovals).values(rows);

  const status = await applyApprovalGates(clinicId, appointmentId);

  if (!wasPending) {
    const [appt] = await db
      .select({ patientName: patients.fullName })
      .from(appointments)
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
      .limit(1);
    const payload = {
      type: "discount.approval_needed",
      title: "Discount needs approval",
      body: appt?.patientName ? `${appt.patientName}. Review the discount.` : "Review a discount.",
      entity: "appointment",
      entityId: appointmentId,
      // The approvals queue NARROWED to this discount — the buttons live there, so
      // this opens the exact record without stranding the approver on a page where
      // they can only look at it.
      link: `/clinic/approvals?appointment=${appointmentId}`,
    };
    if (clinicRequires) {
      await notifyUsersWithPermission(clinicId, "discount_approval", "view", payload);
    }
    for (const doctorId of requiringDoctorIds) {
      await notify(clinicId, doctorId, payload);
    }
  }
  return status;
}

/** The clinic's approval party key; a doctor's is their user id. */
const CLINIC_PARTY = "clinic";

/**
 * One discount's approval status from its visit's approval rows: the decisions of the
 * parties that bear it (pending/rejected/approved), or "none" when nobody was asked.
 * The rule `applyApprovalGates` applies, for readers (the Discounts report).
 */
export function pieceApprovalStatus(
  p: RequestedPiece,
  earnerDoctorIds: string[],
  rows: { kind: string; doctorId: string | null; status: string }[],
): DiscountStatus {
  if (p.fromPlan) return "none";
  const statusOf = new Map(rows.map((r) => [r.kind === "clinic" ? CLINIC_PARTY : (r.doctorId ?? ""), r.status]));
  return deriveStatus(
    partiesBearing(p, earnerDoctorIds).flatMap((party) => {
      const st = statusOf.get(party);
      return st ? [st] : [];
    }),
  );
}

/** Who bears a discount (positive portion), by party key. A doctor-borne part of
 *  the whole-visit discount is the earning doctors'; of a line's, that line's doctor. */
export function partiesBearing(p: RequestedPiece, earnerDoctorIds: string[]): string[] {
  const { clinicBorne, doctorBorne } = discountBorneSplit(p.amount, p.borneBy, p.split);
  const out: string[] = [];
  if (clinicBorne > 0) out.push(CLINIC_PARTY);
  if (doctorBorne > 0) out.push(...(p.doctorId ? [p.doctorId] : earnerDoctorIds));
  return out;
}

/**
 * Applies the approval rows to each discount: a discount whose bearers have not ALL
 * approved counts as 0 — a line's or the consultation's through its `*_held` flag,
 * the whole-visit one through `appointments.discount_status` (which every bill
 * already reads as that discount's gate). So a doctor sitting on a request holds up
 * only what that doctor bears (decision §10 b). Returns the SUMMARY over all rows.
 */
export async function applyApprovalGates(clinicId: string, appointmentId: string): Promise<DiscountStatus> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId);
  const rows = await db
    .select({
      kind: appointmentDiscountApprovals.approverKind,
      doctorId: appointmentDiscountApprovals.approverDoctorId,
      status: appointmentDiscountApprovals.status,
    })
    .from(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.appointmentId, appointmentId),
      ),
    );
  const statusOf = new Map(rows.map((r) => [r.kind === "clinic" ? CLINIC_PARTY : (r.doctorId ?? ""), r.status]));
  const gateOf = (p: RequestedPiece): DiscountStatus =>
    p.fromPlan
      ? "none"
      : deriveStatus(
          partiesBearing(p, ctx.earnerDoctorIds)
            .flatMap((party) => {
              const st = statusOf.get(party);
              return st ? [st] : [];
            }),
        );
  const held = (st: DiscountStatus) => st === "pending" || st === "rejected";

  const heldLines = new Set<string>();
  let consultationHeld = false;
  let overall: DiscountStatus = "none";
  for (const p of ctx.requestedPieces) {
    const st = gateOf(p);
    if (p.key === "overall") overall = st;
    else if (p.key === "consultation") consultationHeld = held(st);
    else if (held(st)) heldLines.add(p.key);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(appointmentProcedures)
      .set({ patientDiscountHeld: false })
      .where(byClinic(appointmentProcedures.clinicId, clinicId, eq(appointmentProcedures.appointmentId, appointmentId)));
    if (heldLines.size > 0) {
      await tx
        .update(appointmentProcedures)
        .set({ patientDiscountHeld: true })
        .where(
          byClinic(
            appointmentProcedures.clinicId,
            clinicId,
            and(eq(appointmentProcedures.appointmentId, appointmentId), inArray(appointmentProcedures.id, [...heldLines])),
          ),
        );
    }
    await tx
      .update(appointments)
      .set({ discountStatus: overall, consultationDiscountHeld: consultationHeld, updatedAt: new Date() })
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));
  });
  return deriveStatus(rows.map((r) => r.status));
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
  await db
    .update(appointmentProcedures)
    .set({ patientDiscountHeld: false })
    .where(byClinic(appointmentProcedures.clinicId, clinicId, eq(appointmentProcedures.appointmentId, appointmentId)));
  return "none";
}

async function setStatus(
  clinicId: string,
  appointmentId: string,
  status: DiscountStatus,
): Promise<void> {
  await db
    .update(appointments)
    // "none" releases the consultation's gate too; per-line gates are set with it.
    .set({ discountStatus: status, ...(status === "none" ? { consultationDiscountHeld: false } : {}), updatedAt: new Date() })
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

  // Each discount's gate follows its own bearers' decisions (§6); the returned status
  // is the visit's summary over every row.
  const status = await applyApprovalGates(clinicId, row.appointmentId);

  // Once the discount is fully decided (all approved, or any rejected), tell the front
  // desk — the bill just changed. Fire once (not per sibling); skip the decider.
  if (status === "approved" || status === "rejected") {
    const [appt] = await db
      .select({ patientName: patients.fullName })
      .from(appointments)
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, row.appointmentId)))
      .limit(1);
    await notifyUsersWithPermission(
      clinicId,
      "appointments",
      "edit",
      {
        type: "discount.decided",
        title: `Discount ${status}`,
        body: appt?.patientName ? `${appt.patientName}'s discount was ${status}.` : `A discount was ${status}.`,
        entity: "appointment",
        entityId: row.appointmentId,
        link: `/clinic/appointments/${row.appointmentId}`,
        actor: { userId: decidedBy.id, name: decidedBy.name },
      },
      { excludeUserId: decidedBy.id },
    );
  }
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
  /** What THIS party is asked about — each discount it bears, with the part it bears
   *  (plan §6: "each request names the line it is for"). */
  /** `borne` is NULL where it is not one number yet: the whole-visit discount's
   *  doctor side, spread over several doctors by their gross share. */
  items: { label: string; amount: number; borne: number | null }[];
};

/**
 * The pending discount approvals a user may act on: a doctor sees rows for their
 * OWN share; a clinic approver (holds the capability) sees clinic-borne rows. Pass
 * both flags from the action/page after the permission check.
 */
export async function listPendingApprovalsForUser(
  clinicId: string,
  opts: { doctorId: string; isClinicApprover: boolean; appointmentId?: string },
): Promise<PendingApproval[]> {
  // A clinic approver may act on clinic rows AND their own doctor rows, so we scan
  // all this clinic's pending rows and narrow in JS below; a plain doctor only ever
  // sees their own rows, so we filter those in SQL.
  // `appointmentId` narrows to ONE discount — what a "discount needs approval"
  // notification links to. It stays on this page rather than deep-linking the
  // appointment because Approve/Reject live HERE; the appointment detail only shows a
  // "pending approval" badge, so linking there would show the approver the problem
  // and give them no way to act on it.
  const one = opts.appointmentId
    ? eq(appointmentDiscountApprovals.appointmentId, opts.appointmentId)
    : undefined;
  const kindFilter = opts.isClinicApprover
    ? and(eq(appointmentDiscountApprovals.status, "pending"), one)
    : and(
        eq(appointmentDiscountApprovals.status, "pending"),
        eq(appointmentDiscountApprovals.approverDoctorId, opts.doctorId),
        one,
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
  const mine = rows.filter((r) =>
    opts.isClinicApprover
      ? r.approverKind === "clinic" || r.approverDoctorId === opts.doctorId
      : true,
  );
  // Each visit's discounts, once per visit (a queue is short; this is its detail).
  const ctxs = new Map<string, Awaited<ReturnType<typeof getAppointmentShareContext>>>();
  for (const id of new Set(mine.map((r) => r.appointmentId))) {
    ctxs.set(id, await getAppointmentShareContext(clinicId, id));
  }
  return mine.map((r) => {
    const ctx = ctxs.get(r.appointmentId);
    const party = r.approverKind === "clinic" ? CLINIC_PARTY : (r.approverDoctorId ?? "");
    const items = (ctx?.requestedPieces ?? [])
      .filter((p) => !p.fromPlan && partiesBearing(p, ctx!.earnerDoctorIds).includes(party))
      .map((p) => {
        const part = discountBorneSplit(p.amount, p.borneBy, p.split);
        const doctorShare = p.doctorId || ctx!.earnerDoctorIds.length <= 1 ? part.doctorBorne : null;
        return { label: p.label, amount: p.amount, borne: party === CLINIC_PARTY ? part.clinicBorne : doctorShare };
      });
    return { ...r, items };
  });
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

/** Who one approval row is waiting on — the caller checks it may decide this row. */
export async function getApprovalRow(clinicId: string, rowId: string) {
  const [row] = await db
    .select({
      approverKind: appointmentDiscountApprovals.approverKind,
      approverDoctorId: appointmentDiscountApprovals.approverDoctorId,
    })
    .from(appointmentDiscountApprovals)
    .where(
      byClinic(
        appointmentDiscountApprovals.clinicId,
        clinicId,
        eq(appointmentDiscountApprovals.id, rowId),
      ),
    )
    .limit(1);
  return row ?? null;
}
