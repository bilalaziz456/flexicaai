import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { doctorPayouts, saleShares, users } from "@/core/db/schema";

/**
 * Doctor payouts — settling a doctor's accrued shares. A payout batches that
 * doctor's UNPAID `sale_shares` in a date range, sums them into a `doctor_payouts`
 * row and stamps each share's `payout_id` (so it drops out of "outstanding").
 * Deleting a payout un-stamps its shares (FK set null), reversing the settlement.
 * All clinic-scoped.
 */

export type PayoutRow = {
  id: string;
  doctorId: string | null;
  doctorName: string | null;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
};

/**
 * Record a payout: stamp the doctor's unpaid shares that fall in [start, end) and
 * write the settlement row. Returns the amount + share count settled, or an error
 * (e.g. nothing outstanding in the range). Atomic.
 */
export async function recordPayout(
  clinicId: string,
  input: {
    doctorId: string;
    start: Date;
    end: Date; // exclusive
    from: string; // YYYY-MM-DD (recorded period, inclusive)
    to: string;
    note: string | null;
    actor: { id: string; name: string };
  },
): Promise<{ amount: number; count: number } | { error: string }> {
  // The doctor must belong to this clinic (name snapshot for the record).
  const [doctor] = await db
    .select({ fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, input.doctorId)))
    .limit(1);
  if (!doctor) return { error: "Doctor not found." };

  return db.transaction(async (tx) => {
    // The doctor's unpaid shares in range (lock them for this settlement).
    const unpaid = await tx
      .select({ id: saleShares.id, amount: saleShares.shareAmount })
      .from(saleShares)
      .where(
        byClinic(
          saleShares.clinicId,
          clinicId,
          and(
            eq(saleShares.doctorId, input.doctorId),
            isNull(saleShares.payoutId),
            gte(saleShares.occurredAt, input.start),
            lt(saleShares.occurredAt, input.end),
          ),
        ),
      );
    if (unpaid.length === 0) {
      return { error: "Nothing outstanding for this doctor in the selected period." };
    }
    const amount = unpaid.reduce((s, r) => s + r.amount, 0);

    const [payout] = await tx
      .insert(doctorPayouts)
      .values({
        clinicId,
        doctorId: input.doctorId,
        doctorName: doctor.fullName ?? doctor.username,
        amount,
        periodStart: input.from,
        periodEnd: input.to,
        note: input.note?.slice(0, 500) ?? null,
        createdBy: input.actor.id,
        createdByName: input.actor.name,
      })
      .returning({ id: doctorPayouts.id });

    const ids = unpaid.map((r) => r.id);
    await tx
      .update(saleShares)
      .set({ payoutId: payout.id })
      .where(byClinic(saleShares.clinicId, clinicId, inArray(saleShares.id, ids)));

    return { amount, count: unpaid.length };
  });
}

/**
 * Delete a payout (a correction) — the FK set-null returns its shares to
 * "outstanding". Clinic-scoped; a foreign id matches 0 rows.
 */
export async function voidPayout(clinicId: string, payoutId: string): Promise<boolean> {
  const [row] = await db
    .delete(doctorPayouts)
    .where(byClinic(doctorPayouts.clinicId, clinicId, eq(doctorPayouts.id, payoutId)))
    .returning({ id: doctorPayouts.id });
  return Boolean(row);
}

/** Recent payouts for a clinic, optionally scoped to one doctor. */
export async function listPayouts(
  clinicId: string,
  doctorId?: string | null,
  limit = 50,
): Promise<PayoutRow[]> {
  return db
    .select({
      id: doctorPayouts.id,
      doctorId: doctorPayouts.doctorId,
      doctorName: doctorPayouts.doctorName,
      amount: doctorPayouts.amount,
      periodStart: doctorPayouts.periodStart,
      periodEnd: doctorPayouts.periodEnd,
      note: doctorPayouts.note,
      createdByName: doctorPayouts.createdByName,
      createdAt: doctorPayouts.createdAt,
    })
    .from(doctorPayouts)
    .where(
      byClinic(
        doctorPayouts.clinicId,
        clinicId,
        doctorId ? eq(doctorPayouts.doctorId, doctorId) : undefined,
      ),
    )
    .orderBy(desc(doctorPayouts.createdAt))
    .limit(limit);
}
