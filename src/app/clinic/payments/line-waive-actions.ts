"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getAppointmentDoctorLines } from "@/core/sales/appointment-lines";
import { recordSettlementAction, voidSettlementAction } from "@/core/sales/settlement-actions";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";

export type LineWaiveState = { error?: string; saved?: boolean };

function revalidate(appointmentId: string) {
  revalidatePath(`/reception/appointments/${appointmentId}`);
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidateFinance();
}

/**
 * Waive the doctor's share for one earning line of a completed visit (a `doctor_waive`
 * tagged with the line). Allowed for the line's OWN doctor (self) or a `share_waive`
 * holder. The amount is computed server-side from the line (never trusted from the
 * client), and a line can only be waived once.
 */
export async function waiveAppointmentLine(
  appointmentId: string,
  lineRef: string,
): Promise<LineWaiveState> {
  const user = await requireWorkspace();
  const lines = await getAppointmentDoctorLines(user.clinicId, appointmentId);
  const line = lines.find((l) => l.lineRef === lineRef);
  if (!line) return { error: "Earning line not found." };
  if (line.waivedActionId) return { error: "This line is already waived." };

  const selfDoctor = user.role === "doctor" && user.id === line.doctorId;
  if (!selfDoctor && !can(user, "share_waive", "view")) {
    return { error: "You don't have permission for that." };
  }

  const result = await recordSettlementAction(user.clinicId, {
    doctorId: line.doctorId,
    kind: "doctor_waive",
    amount: line.earned,
    appointmentId,
    lineRef,
    bounded: false, // the amount is the line's earned share (server-computed, safe)
    note: `Waived ${line.label} share`,
    actor: { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  });
  if ("error" in result) return { error: result.error };

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Waived a doctor's ${line.label} share (Rs ${line.earned})`,
  });
  revalidate(appointmentId);
  return { saved: true };
}

/** Undo a per-line waive. Same rights as making it (self doctor or `share_waive`). */
export async function unwaiveAppointmentLine(
  appointmentId: string,
  actionId: string,
): Promise<LineWaiveState> {
  const user = await requireWorkspace();
  const lines = await getAppointmentDoctorLines(user.clinicId, appointmentId);
  const line = lines.find((l) => l.waivedActionId === actionId);
  const selfDoctor = Boolean(line) && user.role === "doctor" && user.id === line!.doctorId;
  if (!selfDoctor && !can(user, "share_waive", "view")) {
    return { error: "You don't have permission for that." };
  }

  const ok = await voidSettlementAction(user.clinicId, actionId);
  if (!ok) return { error: "Waive not found." };

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: appointmentId,
    summary: "Reversed a per-line doctor share waive",
  });
  revalidate(appointmentId);
  return { saved: true };
}
