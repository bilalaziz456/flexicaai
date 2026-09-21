import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { byClinic } from "@/core/db/tenant";
import { notify } from "@/core/notifications/in-app";
import { settlementKindId } from "@/core/db/vocabulary-seed";
import type { PaymentMethodCode } from "@/core/db/vocabulary-seed";
import {
  discountSettlements,
  doctorPayouts,
  doctorSettlementActions,
  saleShares,
  users,
} from "@/core/db/schema";

/**
 * Doctor payouts — an AMOUNT-BASED running balance. A doctor's lifetime balance is
 * Earned (Σ their gross-basis `sale_shares`) + Borne (Σ their `discount_settlements`
 * — signed; a doctor-borne discount is negative and can push the balance below zero,
 * i.e. the doctor OWES the clinic) − Paid (Σ their `doctor_payouts`). Outstanding =
 * Earned + Borne − Paid; a payment is validated `0 < amount ≤ outstanding`. All
 * clinic-scoped. (Settlement ACTIONS — waives/repayments/write-offs — fold in here in
 * phase 4.)
 */

export type DoctorBalance = {
  doctorId: string;
  name: string;
  earned: number;
  /** Σ discount settlements (signed; − = the doctor bears a discount / may owe). */
  borne: number;
  /** Σ settlement ACTIONS (signed): doctor_waive −; clinic_waive/repayment/write_off +. */
  adjustments: number;
  paid: number;
  outstanding: number;
};

/** Signed balance effect of a settlement action: a doctor waiving his own share
 *  lowers what he's owed; a clinic waive / doctor repayment / write-off relieves his
 *  debt (raises the balance toward zero). */
function settlementActionEffectSql() {
  return sql`case when ${doctorSettlementActions.kind} = ${settlementKindId("doctor_waive")} then -${doctorSettlementActions.amount} else ${doctorSettlementActions.amount} end`;
}

function settlementAdjustmentSql() {
  return sql<number>`coalesce(sum(${settlementActionEffectSql()}), 0)::int`;
}

export type PayoutRow = {
  id: string;
  doctorId: string | null;
  doctorName: string | null;
  amount: number;
  method: PaymentMethodCode | null;
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

  // Discount borne (signed) per doctor — the settlement ledger's doctor rows.
  const borneRows = await db
    .select({
      doctorId: discountSettlements.doctorId,
      name: sql<string | null>`max(${discountSettlements.doctorName})`,
      borne: sql<number>`coalesce(sum(${discountSettlements.settlementAmount}), 0)::int`,
    })
    .from(discountSettlements)
    .where(
      byClinic(
        discountSettlements.clinicId,
        clinicId,
        and(
          eq(discountSettlements.party, "doctor"),
          doctorId ? eq(discountSettlements.doctorId, doctorId) : undefined,
        ),
      ),
    )
    .groupBy(discountSettlements.doctorId);

  // Settlement actions (waives / repayments / write-offs) per doctor.
  const adjRows = await db
    .select({
      doctorId: doctorSettlementActions.doctorId,
      name: sql<string | null>`max(${doctorSettlementActions.doctorName})`,
      adjustments: settlementAdjustmentSql(),
    })
    .from(doctorSettlementActions)
    .where(
      byClinic(
        doctorSettlementActions.clinicId,
        clinicId,
        doctorId ? eq(doctorSettlementActions.doctorId, doctorId) : undefined,
      ),
    )
    .groupBy(doctorSettlementActions.doctorId);

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
  const ensure = (id: string, name: string | null) => {
    let b = map.get(id);
    if (!b) {
      b = { doctorId: id, name: name ?? "Unknown", earned: 0, borne: 0, adjustments: 0, paid: 0, outstanding: 0 };
      map.set(id, b);
    } else if (b.name === "Unknown" && name) {
      b.name = name;
    }
    return b;
  };
  for (const r of earnedRows) {
    if (r.doctorId) ensure(r.doctorId, r.name).earned = Number(r.earned);
  }
  for (const r of borneRows) {
    if (r.doctorId) ensure(r.doctorId, r.name).borne = Number(r.borne);
  }
  for (const r of adjRows) {
    if (r.doctorId) ensure(r.doctorId, r.name).adjustments = Number(r.adjustments);
  }
  for (const r of paidRows) {
    if (r.doctorId) ensure(r.doctorId, r.name).paid = Number(r.paid);
  }
  // Outstanding may be negative — the doctor owes the clinic (discount-bearing).
  for (const b of map.values()) b.outstanding = b.earned + b.borne + b.adjustments - b.paid;
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/** One doctor's lifetime balance (or a zero balance if they have no activity). */
export async function getDoctorBalance(
  clinicId: string,
  doctorId: string,
): Promise<DoctorBalance> {
  const [row] = await getDoctorBalances(clinicId, doctorId);
  return (
    row ?? { doctorId, name: "Unknown", earned: 0, borne: 0, adjustments: 0, paid: 0, outstanding: 0 }
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
    method: PaymentMethodCode | null;
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
    method: input.method ?? null,
    reference: input.reference?.slice(0, 120) || null,
    periodStart: input.from ?? null,
    periodEnd: input.to ?? null,
    note: input.note?.slice(0, 500) ?? null,
    createdBy: input.actor.id,
    createdByName: input.actor.name,
  });

  // Tell the doctor a payment was recorded against their balance.
  await notify(clinicId, input.doctorId, {
    type: "payout.recorded",
    title: "Payment recorded",
    body: `Rs ${amount} was recorded as paid to you${input.method ? ` (${input.method})` : ""}.`,
    entity: "payout",
    link: "/clinic/shares",
    actor: { userId: input.actor.id, name: input.actor.name },
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

/**
 * The RUNNING payable balance over a window — what the clinic owed its doctors at
 * the end of each day, for the dashboard's "Payable to doctors" sparkline.
 *
 * WHY IT IS ANCHORED TO `balances` RATHER THAN SUMMED FROM SCRATCH. The figure on
 * the card is `Σ max(0, outstanding)` over LIFETIME balances. A series built by
 * summing its own opening totals would be a second expression of the same money
 * rule, and the two would drift the first time the formula changed (ADR-015). So
 * this takes the already-computed balances as the anchor, works each doctor's
 * opening position out by SUBTRACTING their movement inside the window, and walks
 * forward. The last point is then equal to the card's figure by construction, not
 * by coincidence — which is the one property a sparkline under a number must have.
 *
 * The clamp is per DOCTOR and re-applied every day, matching `payableToDoctors`: a
 * doctor who owes the clinic (a negative balance, from discount-bearing) does not
 * reduce what is owed to everyone else.
 */
export async function getPayableTrend(
  clinicId: string,
  range: { start: Date; end: Date },
  balances: DoctorBalance[],
): Promise<number[]> {
  const day = (c: AnyPgColumn) => sql<string>`to_char(date_trunc('day', ${c}), 'YYYY-MM-DD')`;
  const inWindow = (c: AnyPgColumn) =>
    and(gte(c, range.start), lt(c, range.end));

  // Four sources, same four the lifetime balance is built from, each grouped by
  // doctor and day. Signed so they can simply be added together.
  const [shares, borne, actions, paid] = await Promise.all([
    db
      .select({
        doctorId: saleShares.doctorId,
        d: day(saleShares.occurredAt),
        v: sql<number>`coalesce(sum(${saleShares.shareAmount}), 0)::int`,
      })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, inWindow(saleShares.occurredAt)))
      .groupBy(saleShares.doctorId, day(saleShares.occurredAt)),
    db
      .select({
        doctorId: discountSettlements.doctorId,
        d: day(discountSettlements.occurredAt),
        v: sql<number>`coalesce(sum(${discountSettlements.settlementAmount}), 0)::int`,
      })
      .from(discountSettlements)
      .where(
        byClinic(
          discountSettlements.clinicId,
          clinicId,
          and(
            eq(discountSettlements.party, "doctor"),
            inWindow(discountSettlements.occurredAt),
          ),
        ),
      )
      .groupBy(discountSettlements.doctorId, day(discountSettlements.occurredAt)),
    db
      .select({
        doctorId: doctorSettlementActions.doctorId,
        d: day(doctorSettlementActions.occurredAt),
        v: settlementAdjustmentSql(),
      })
      .from(doctorSettlementActions)
      .where(
        byClinic(
          doctorSettlementActions.clinicId,
          clinicId,
          inWindow(doctorSettlementActions.occurredAt),
        ),
      )
      .groupBy(doctorSettlementActions.doctorId, day(doctorSettlementActions.occurredAt)),
    // Payouts are dated by `created_at` — the same column the lifetime Paid total
    // uses. A payout REDUCES what is owed, hence the negative.
    db
      .select({
        doctorId: doctorPayouts.doctorId,
        d: day(doctorPayouts.createdAt),
        v: sql<number>`-coalesce(sum(${doctorPayouts.amount}), 0)::int`,
      })
      .from(doctorPayouts)
      .where(byClinic(doctorPayouts.clinicId, clinicId, inWindow(doctorPayouts.createdAt)))
      .groupBy(doctorPayouts.doctorId, day(doctorPayouts.createdAt)),
  ]);

  // doctorId -> day -> signed movement
  const moves = new Map<string, Map<string, number>>();
  for (const row of [...shares, ...borne, ...actions, ...paid]) {
    if (!row.doctorId) continue;
    let byDay = moves.get(row.doctorId);
    if (!byDay) moves.set(row.doctorId, (byDay = new Map()));
    byDay.set(row.d, (byDay.get(row.d) ?? 0) + Number(row.v));
  }

  // Each doctor's opening position: lifetime balance minus everything that moved
  // inside the window. Doctors with no balance row but movement in the window are
  // included too, or their earnings would appear from nowhere on the last day.
  const running = new Map<string, number>();
  for (const b of balances) {
    if (!b.doctorId) continue;
    running.set(b.doctorId, b.outstanding);
  }
  for (const [doctorId, byDay] of moves) {
    const total = [...byDay.values()].reduce((a, v) => a + v, 0);
    running.set(doctorId, (running.get(doctorId) ?? 0) - total);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const out: number[] = [];
  for (const cursor = new Date(range.start); cursor < range.end; cursor.setDate(cursor.getDate() + 1)) {
    const key = iso(cursor);
    for (const [doctorId, byDay] of moves) {
      const delta = byDay.get(key);
      if (delta) running.set(doctorId, (running.get(doctorId) ?? 0) + delta);
    }
    let total = 0;
    for (const v of running.values()) total += Math.max(0, v);
    out.push(total);
  }
  return out;
}