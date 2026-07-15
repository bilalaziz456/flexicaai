import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { doctorPayouts, saleShares, users } from "@/core/db/schema";

/**
 * Doctor payouts — an AMOUNT-BASED running balance (Phase 7). A doctor's balance is
 * lifetime: Earned = Σ their `sale_shares`, Paid = Σ their `doctor_payouts`,
 * Outstanding = Earned − Paid. A payment is an arbitrary amount (partial allowed),
 * validated ≤ outstanding; there is no per-share paid flag. Deleting a payout (a
 * correction) simply raises the balance again. All clinic-scoped.
 */

export type DoctorBalance = {
  doctorId: string;
  name: string;
  earned: number;
  paid: number;
  outstanding: number;
};

export type PayoutRow = {
  id: string;
  doctorId: string | null;
  doctorName: string | null;
  amount: number;
  method: string | null;
  reference: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
};

/**
 * Lifetime balances per doctor (Earned / Paid / Outstanding), optionally scoped to
 * one doctor. Earned comes from the share ledger, Paid from the payouts; a doctor
 * shows up if they have either. Names come from the ledger/payout snapshots.
 */
export async function getDoctorBalances(
  clinicId: string,
  doctorId?: string | null,
): Promise<DoctorBalance[]> {
  const earnedRows = await db
    .select({
      doctorId: saleShares.doctorId,
      name: sql<string | null>`max(${saleShares.doctorName})`,
      earned: sql<number>`coalesce(sum(${saleShares.shareAmount}), 0)::int`,
    })
    .from(saleShares)
    .where(
      byClinic(
        saleShares.clinicId,
        clinicId,
        doctorId ? eq(saleShares.doctorId, doctorId) : undefined,
      ),
    )
    .groupBy(saleShares.doctorId);

  const paidRows = await db
    .select({
      doctorId: doctorPayouts.doctorId,
      name: sql<string | null>`max(${doctorPayouts.doctorName})`,
      paid: sql<number>`coalesce(sum(${doctorPayouts.amount}), 0)::int`,
    })
    .from(doctorPayouts)
    .where(
      byClinic(
        doctorPayouts.clinicId,
        clinicId,
        doctorId ? eq(doctorPayouts.doctorId, doctorId) : undefined,
      ),
    )
    .groupBy(doctorPayouts.doctorId);

  const map = new Map<string, DoctorBalance>();
  for (const r of earnedRows) {
    if (!r.doctorId) continue;
    map.set(r.doctorId, {
      doctorId: r.doctorId,
      name: r.name ?? "Unknown",
      earned: Number(r.earned),
      paid: 0,
      outstanding: Number(r.earned),
    });
  }
  for (const r of paidRows) {
    if (!r.doctorId) continue;
    const existing = map.get(r.doctorId);
    if (existing) {
      existing.paid = Number(r.paid);
      existing.outstanding = existing.earned - existing.paid;
    } else {
      map.set(r.doctorId, {
        doctorId: r.doctorId,
        name: r.name ?? "Unknown",
        earned: 0,
        paid: Number(r.paid),
        outstanding: -Number(r.paid),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/** One doctor's lifetime balance (or a zero balance if they have no activity). */
export async function getDoctorBalance(
  clinicId: string,
  doctorId: string,
): Promise<DoctorBalance> {
  const [row] = await getDoctorBalances(clinicId, doctorId);
  return (
    row ?? { doctorId, name: "Unknown", earned: 0, paid: 0, outstanding: 0 }
  );
}

/**
 * Record a payment of an ARBITRARY amount against a doctor's outstanding balance
 * (partial allowed). Validates `0 < amount ≤ outstanding`. Returns the recorded
 * amount + the new outstanding, or an error. Clinic-scoped.
 */
export async function recordPayout(
  clinicId: string,
  input: {
    doctorId: string;
    amount: number;
    method: string | null;
    reference: string | null;
    from?: string | null; // optional covered period (YYYY-MM-DD)
    to?: string | null;
    note: string | null;
    actor: { id: string; name: string };
  },
): Promise<{ amount: number; outstanding: number } | { error: string }> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  const [doctor] = await db
    .select({ fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, input.doctorId)))
    .limit(1);
  if (!doctor) return { error: "Doctor not found." };

  const balance = await getDoctorBalance(clinicId, input.doctorId);
  if (balance.outstanding <= 0) {
    return { error: "This doctor has nothing outstanding." };
  }
  if (amount > balance.outstanding) {
    return { error: `Amount exceeds the outstanding balance (Rs ${balance.outstanding}).` };
  }

  await db.insert(doctorPayouts).values({
    clinicId,
    doctorId: input.doctorId,
    doctorName: doctor.fullName ?? doctor.username,
    amount,
    method: input.method?.slice(0, 40) || null,
    reference: input.reference?.slice(0, 120) || null,
    periodStart: input.from ?? null,
    periodEnd: input.to ?? null,
    note: input.note?.slice(0, 500) ?? null,
    createdBy: input.actor.id,
    createdByName: input.actor.name,
  });

  return { amount, outstanding: balance.outstanding - amount };
}

/** Delete a payout (a correction) — the balance rises again. Clinic-scoped. */
export async function voidPayout(clinicId: string, payoutId: string): Promise<boolean> {
  const [row] = await db
    .delete(doctorPayouts)
    .where(byClinic(doctorPayouts.clinicId, clinicId, eq(doctorPayouts.id, payoutId)))
    .returning({ id: doctorPayouts.id });
  return Boolean(row);
}

/** Recent payments for a clinic, optionally scoped to one doctor. */
export async function listPayouts(
  clinicId: string,
  doctorId?: string | null,
  limit = 100,
): Promise<PayoutRow[]> {
  return db
    .select({
      id: doctorPayouts.id,
      doctorId: doctorPayouts.doctorId,
      doctorName: doctorPayouts.doctorName,
      amount: doctorPayouts.amount,
      method: doctorPayouts.method,
      reference: doctorPayouts.reference,
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
