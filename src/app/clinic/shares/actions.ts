"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClinicAdmin } from "@/core/auth/user";
import { resolveSalesRange } from "@/core/sales/report";
import { recordPayout, voidPayout } from "@/core/sales/payouts";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";

export type PayoutActionState = { error?: string; saved?: boolean };

const recordSchema = z.object({
  doctorId: z.string().uuid("Choose a doctor."),
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a payout that settles a doctor's outstanding shares for the currently
 * filtered period. Clinic-admin only. The period comes from the same filter the
 * report uses, so "what you see outstanding" is exactly what's settled.
 */
export async function recordDoctorPayout(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const admin = await requireClinicAdmin();

  const parsed = recordSchema.safeParse({
    doctorId: formData.get("doctorId"),
    period: formData.get("period") || undefined,
    from: formData.get("from") || undefined,
    to: formData.get("to") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const range = resolveSalesRange(parsed.data.period, parsed.data.from, parsed.data.to);
  const result = await recordPayout(admin.clinicId, {
    doctorId: parsed.data.doctorId,
    start: range.start,
    end: range.end,
    from: range.from,
    to: range.to,
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
    summary: `Recorded a doctor payout of Rs ${result.amount} (${result.count} visit${result.count === 1 ? "" : "s"})`,
  });
  revalidatePath("/clinic/shares");
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
  return { saved: true };
}
