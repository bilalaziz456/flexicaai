"use server";

import { getApprovalRow } from "@/core/appointments/approvals";
import { setDiscountNeedsApproval } from "@/core/clinics/settings";
import { getAppointmentStatus } from "@/core/appointments/manage";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClinicAdmin, requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  canDecideRow,
  decideDiscountApproval,
  type ApprovalDecision,
} from "@/core/appointments/approvals";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import { APPROVAL_DECISION_CODES } from "@/core/db/vocabulary-seed";

export type ApprovalActionState = { error?: string; saved?: boolean };

const decideSchema = z.object({
  rowId: z.string().uuid(),
  decision: z.enum(APPROVAL_DECISION_CODES),
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
  const row = await getApprovalRow(clinicId, parsed.data.rowId);
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
  const status = await getAppointmentStatus(clinicId, result.appointmentId);
  if (status === "completed") {
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
  revalidateFinance(); // approving/rejecting a discount changes the bill → revenue
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

  await setDiscountNeedsApproval(clinicId, parsed.data.requireApproval);

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
