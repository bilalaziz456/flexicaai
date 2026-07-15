"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireClinicAdmin, requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointmentDiscountApprovals, appointments, clinics } from "@/core/db/schema";
import {
  canDecideRow,
  decideDiscountApproval,
  type ApprovalDecision,
} from "@/core/appointments/approvals";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";

export type ApprovalActionState = { error?: string; saved?: boolean };

const decideSchema = z.object({
  rowId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Approve or reject a discount approval row. A doctor may decide only their OWN
 * rows; a clinic-borne row needs the `discount_approval` capability. After the
 * decision the appointment's discount status is re-derived; if it's a completed
 * appointment, its sale is re-snapshotted so the now-effective discount flows to
 * the ledger.
 */
export async function decideApproval(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const user = await requireWorkspace();
  const { clinicId } = user;

  const parsed = decideSchema.safeParse({
    rowId: formData.get("rowId"),
    decision: formData.get("decision"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: "Invalid request." };

  // Load the row (clinic-scoped) to authorise the specific decision.
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
        eq(appointmentDiscountApprovals.id, parsed.data.rowId),
      ),
    )
    .limit(1);
  if (!row) return { error: "Approval not found." };

  const isClinicApprover = can(user, "discount_approval", "view");
  if (!canDecideRow(row, { id: user.id, isClinicApprover })) {
    return { error: "You can't decide this approval." };
  }

  const result = await decideDiscountApproval(
    clinicId,
    parsed.data.rowId,
    parsed.data.decision as ApprovalDecision,
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
    parsed.data.note ?? null,
  );
  if ("error" in result) return { error: result.error };

  // Re-snapshot the sale if the appointment is already completed (best-effort).
  const [appt] = await db
    .select({ status: appointments.status })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, result.appointmentId)))
    .limit(1);
  if (appt?.status === "completed") {
    await recordSaleForAppointment(clinicId, result.appointmentId);
  }

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: result.appointmentId,
    summary: `${parsed.data.decision === "approved" ? "Approved" : "Rejected"} a discount`,
  });
  revalidatePath("/clinic/approvals");
  revalidatePath(`/clinic/appointments/${result.appointmentId}`);
  return { saved: true };
}

const policySchema = z.object({ requireApproval: z.boolean() });

/**
 * Clinic admin sets whether CLINIC-borne discounts require approval before they
 * apply. Only affects the clinic side; each doctor controls their own switch.
 * Note: existing appointments' statuses are recomputed lazily on their next edit.
 */
export async function updateClinicDiscountPolicy(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = policySchema.safeParse({
    requireApproval: formData.get("requireApproval") === "on",
  });
  if (!parsed.success) return { error: "Invalid request." };

  await db
    .update(clinics)
    .set({ discountNeedsApproval: parsed.data.requireApproval, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  await logActivity({
    action: "update",
    entity: "settings",
    summary: parsed.data.requireApproval
      ? "Turned on approval for clinic-borne discounts"
      : "Turned off approval for clinic-borne discounts",
  });
  revalidatePath("/clinic/approvals");
  return { saved: true };
}
