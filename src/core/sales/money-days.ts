import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { byClinic, notDeleted } from "@/core/db/tenant";
import type { Executor } from "@/core/db/tx";
import { patientPayments } from "@/core/db/schema";

/**
 * A visit's money, DAY BY DAY — what the sales and share ledgers are derived from
 * since revenue counts on the date it is RECEIVED (owner's call, 2026-10-13: the
 * front desk records a payment and expects to see it everywhere; the visit's status
 * is for the queue only).
 *
 * Returns one entry per calendar day (server-local, like every other day boundary in
 * the app — D-14) on which the visit's collected total CHANGED, with the running
 * total at the end of that day CLAMPED to [0, billNet]: the clamp is what the old
 * single-row ledger applied to `amount_collected`, so the per-day rows sum to exactly
 * the figure it would have booked. A refund is just a day whose running total fell,
 * so its delta is negative and the revenue comes off on the refund's date.
 *
 * `at` is the day's LAST money movement — a real timestamp inside that day, so a
 * report bucketing by day, week or month puts the row where the money moved.
 *
 * PURE apart from the one read; `moneyDaysFrom` holds the arithmetic so it can be
 * tested without a database.
 */
export type MoneyDay = { at: Date; cumulative: number; delta: number };

/** What each ledger kind does to a visit's collected total. */
const SIGN: Record<string, number> = { payment: 1, advance_applied: 1, refund: -1 };

export function moneyDaysFrom(
  entries: { kind: string; amount: number; occurredAt: Date }[],
  billNet: number,
): MoneyDay[] {
  const cap = Math.max(0, billNet);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const ordered = [...entries]
    .filter((e) => SIGN[e.kind] !== undefined)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const out: MoneyDay[] = [];
  let raw = 0;
  let booked = 0; // the clamped running total already turned into rows
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    raw += SIGN[e.kind] * e.amount;
    const last = i === ordered.length - 1 || dayKey(ordered[i + 1].occurredAt) !== dayKey(e.occurredAt);
    if (!last) continue;
    const cumulative = Math.min(cap, Math.max(0, raw));
    const delta = cumulative - booked;
    if (delta !== 0) {
      out.push({ at: e.occurredAt, cumulative, delta });
      booked = cumulative;
    }
  }
  return out;
}

/** Reads the visit's live payment rows and folds them into `MoneyDay`s. */
export async function getMoneyDays(
  clinicId: string,
  appointmentId: string,
  billNet: number,
  exec: Executor,
): Promise<MoneyDay[]> {
  const rows = await exec
    .select({ kind: patientPayments.kind, amount: patientPayments.amount, occurredAt: patientPayments.occurredAt })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        notDeleted(patientPayments.deletedAt),
        and(
          eq(patientPayments.appointmentId, appointmentId),
          inArray(patientPayments.kind, ["payment", "advance_applied", "refund"]),
        ),
      ),
    )
    .orderBy(asc(patientPayments.occurredAt));
  return moneyDaysFrom(rows, billNet);
}
