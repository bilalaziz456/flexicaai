"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClinicAdmin, requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { recordPayout, voidPayout } from "@/core/sales/payouts";
import {
  recordSettlementAction,
  voidSettlementAction,
} from "@/core/sales/settlement-actions";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";

export type PayoutActionState = { error?: string; saved?: boolean };

const recordSchema = z.object({
  doctorId: z.string().uuid("Choose a doctor."),
  amount: z.coerce
    .number({ message: "Enter an amount." })
    .int("Whole rupees only.")
    .positive("Enter an amount greater than zero."),
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a payment of an arbitrary amount against a doctor's outstanding balance
 * (partial allowed). Clinic-admin only; the core validates 0 < amount ≤ outstanding.
 */
export async function recordDoctorPayout(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const admin = await requireClinicAdmin();

  const parsed = recordSchema.safeParse({
    doctorId: formData.get("doctorId"),
    amount: formData.get("amount"),
    method: formData.get("method") || undefined,
    reference: formData.get("reference") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const result = await recordPayout(admin.clinicId, {
    doctorId: parsed.data.doctorId,
    amount: parsed.data.amount,
    method: parsed.data.method ?? null,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    actor: {
      id: admin.id,
      name: displayStaffName(admin.prefix, admin.fullName, admin.username),
    },
  });
  if ("error" in result) return { error: result.error };

  await logActivity({
    action: "create",
    entity: "settings",
    entityId: parsed.data.doctorId,
    summary: `Recorded a payment of Rs ${result.amount} to a doctor`,
  });
  revalidatePath("/clinic/shares");
  revalidateFinance(); // "Payable to doctors" on the dashboard
  return { saved: true };
}

const settlementSchema = z.object({
  doctorId: z.string().uuid("Choose a doctor."),
  kind: z.enum(["doctor_waive", "clinic_waive", "repayment", "write_off"]),
  amount: z.coerce.number({ message: "Enter an amount." }).int("Whole rupees only.").positive("Enter an amount greater than zero."),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a settlement action on a doctor's balance. Clinic-side kinds (clinic_waive /
 * write_off / repayment) need the `share_waive` permission; a doctor waiving his OWN
 * share is allowed by identity. The core validates the amount against the balance.
 */
export async function recordSettlement(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const user = await requireWorkspace();

  const parsed = settlementSchema.safeParse({
    doctorId: formData.get("doctorId"),
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { doctorId, kind, amount, note } = parsed.data;

  const selfWaive = kind === "doctor_waive" && user.role === "doctor" && user.id === doctorId;
  if (!selfWaive && !can(user, "share_waive", "view")) {
    return { error: "You don't have permission for that." };
  }

  const result = await recordSettlementAction(user.clinicId, {
    doctorId,
    kind,
    amount,
    note: note ?? null,
    actor: { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  });
  if ("error" in result) return { error: result.error };

  await logActivity({
    action: "create",
    entity: "settings",
    entityId: doctorId,
    summary: `Recorded a ${kind.replace(/_/g, " ")} of Rs ${amount} on a doctor's balance`,
  });
  revalidatePath("/clinic/shares");
  revalidateFinance();
  return { saved: true };
}

/** Reverse a settlement action (a correction) — the balance moves back. `share_waive`. */
export async function voidSettlement(actionId: string): Promise<PayoutActionState> {
  const user = await requireWorkspace();
  if (!can(user, "share_waive", "view")) return { error: "You don't have permission for that." };
  const ok = await voidSettlementAction(user.clinicId, actionId);
  if (!ok) return { error: "Action not found." };

  await logActivity({
    action: "delete",
    entity: "settings",
    entityId: actionId,
    summary: "Reversed a doctor settlement action",
  });
  revalidatePath("/clinic/shares");
  revalidateFinance();
  return { saved: true };
}

/** Delete a payout (correction) — returns its shares to outstanding. Clinic-admin. */
export async function voidDoctorPayout(payoutId: string): Promise<PayoutActionState> {
  const admin = await requireClinicAdmin();
  const ok = await voidPayout(admin.clinicId, payoutId);
  if (!ok) return { error: "Payout not found." };

  await logActivity({
    action: "delete",
    entity: "settings",
    entityId: payoutId,
    summary: "Reversed a doctor payout",
  });
  revalidatePath("/clinic/shares");
  revalidateFinance(); // "Payable to doctors" on the dashboard
  return { saved: true };
}
