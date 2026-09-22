import "server-only";

import { and, count, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { cashTransferKindId, paymentKindId } from "@/core/db/vocabulary-seed";
import {
  cashCounts,
  cashTransfers,
  doctorPayouts,
  expenses,
  patientPayments,
  type CashCount,
  type CashTransfer,
} from "@/core/db/schema";

/**
 * PETTY CASH — the shared front-desk drawer, reconciled at each handover.
 *
 * THIS IS NOT A LEDGER. Every cash movement is already recorded: a cash patient
 * payment, a cash refund, a cash expense, a cash doctor payout. A second place to
 * type "paid 500 for gloves" would make the day book, the P&L and the drawer disagree
 * with nothing to arbitrate between them — the failure ADR-015 exists for. So this
 * module only READS those ledgers, and stores exactly the two facts they cannot know:
 * what was physically counted, and cash that left the drawer without being a cost.
 *
 * ONE FORMULA, HERE, AND NOWHERE ELSE:
 *
 *     expected = the last count's COUNTED total
 *              + cash in      (after that count)
 *              − cash out     (after that count)
 *              ± transfers    (after that count)
 *
 * Carrying the previous EXPECTED total forward instead would let one bad Tuesday
 * poison every figure after it; re-basing on what was actually counted absorbs a
 * shortfall at the handover where it was seen and explained.
 *
 * See docs/petty-cash-plan.md for the decisions behind this and the open questions.
 */

/**
 * Money recorded against a tender that is NOT cash is irrelevant here, but money
 * recorded against NO tender is a different problem: every `method` column is
 * nullable, so a cash expense saved without one silently disappears from the drawer
 * and comes back as an unexplained shortfall — with the person who counted looking
 * careless. It is counted separately and SHOWN, so the reader can see why the numbers
 * differ instead of doubting them.
 */
export type CashMovement = {
  /** What the ledgers say moved through the drawer since the last count. */
  collected: number;
  refunded: number;
  expenses: number;
  payouts: number;
  transfersOut: number;
  transfersIn: number;
  /** Rows with no tender recorded — not included in any figure above. */
  untendered: { expenses: number; payouts: number; payments: number };
  /** WHY the money left, per line, so a total is answerable without opening another
   *  screen. A sum tells you the drawer is 2,500 lighter; "gloves · courier · tea" is
   *  what lets somebody say whether that is right. Empty strings are dropped rather
   *  than shown as blanks — an unlabelled row is a gap in the record, not a reason. */
  reasons: { spent: string[]; moved: string[] };
};

export type DrawerState = {
  /** The count this window opens from; null before a clinic has ever counted. */
  openedAt: Date | null;
  openingTotal: number;
  movement: CashMovement;
  /** `openingTotal` ± movement. Null when there is no opening count to reckon from. */
  expected: number | null;
};

/** The most recent count, which every expectation is measured from. */
export async function lastCount(clinicId: string) {
  const [row] = await db
    .select()
    .from(cashCounts)
    .where(byClinic(cashCounts.clinicId, clinicId, notDeleted(cashCounts.deletedAt)))
    .orderBy(desc(cashCounts.countedAt))
    .limit(1);
  return row ?? null;
}

/**
 * What should be in the drawer right now.
 *
 * Returns `expected: null` — not 0 — when the clinic has never counted. "I do not
 * know what was in the box to begin with" and "the box should be empty" are different
 * claims, and a screen that prints 0 for the first is lying in a way a reader cannot
 * detect.
 */
export async function getDrawerState(clinicId: string): Promise<DrawerState> {
  const since = await lastCount(clinicId);
  const from = since?.countedAt ?? null;

  const movement = await cashMovementSince(clinicId, from);
  const opening = since?.countedTotal ?? 0;

  return {
    openedAt: from,
    openingTotal: opening,
    movement,
    expected: since
      ? opening +
        movement.collected -
        movement.refunded -
        movement.expenses -
        movement.payouts -
        movement.transfersOut +
        movement.transfersIn
      : null,
  };
}

/**
 * Cash through the drawer since `from` (exclusive), or over all time when null.
 *
 * EVERY SOURCE IS BOUNDED BY `created_at`, NOT by the date it is dated.
 *
 * The day book asks "what happened on this DAY" and rightly keys off `occurred_at` /
 * `incurred_on`. A drawer asks a different question — "what has happened since I last
 * counted" — and the honest test for that is whether the previous count could have
 * SEEN the row. A row recorded after the count was not in the drawer when it was
 * counted; a row recorded before it was already absorbed into that count.
 *
 * Using `incurred_on` here was actively wrong for the chosen design: it is a DATE with
 * no time in it, so every cash expense dated on a handover day fell into BOTH the
 * window before the count and the window after it. With two shifts on one day the
 * evening would have shown a shortfall equal to the morning's spending, every day.
 * (It also needs a cast, and `'…Z'::date` resolves in the SESSION's timezone, which
 * silently shifted the boundary by a day here in PKT — the bug the test caught.)
 *
 * KNOWN CONSEQUENCE, recorded rather than hidden: an expense entered LATE — the cash
 * left yesterday, the row is typed today — was already absorbed as yesterday's
 * shortfall, so subtracting it again today reads as a surplus. That surplus IS the
 * earlier shortfall being explained, which is information rather than noise, but it is
 * not yet linked to the variance it explains. See docs/petty-cash-plan.md §8.
 */
async function cashMovementSince(clinicId: string, from: Date | null): Promise<CashMovement> {
  const after = <T extends { getSQL: () => unknown }>(col: T) =>
    from ? gt(col as never, from as never) : undefined;

  const [pay] = await db
    .select({
      // `advance_applied` settles a bill from stored credit and carries the system
      // marker `advance`, not a tender — no notes move, so it can never reach the
      // drawer. Filtering on the cash method rather than on "not bank, not cheque"
      // excludes it by construction.
      collected: sql<number>`coalesce(sum(case when ${patientPayments.kind} in (${paymentKindId("payment")}, ${paymentKindId("advance")}, ${paymentKindId("opening")}) then ${patientPayments.amount} else 0 end), 0)`,
      refunded: sql<number>`coalesce(sum(case when ${patientPayments.kind} = ${paymentKindId("refund")} then ${patientPayments.amount} else 0 end), 0)`,
    })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        and(
          notDeleted(patientPayments.deletedAt),
          eq(patientPayments.method, "cash"),
          after(patientPayments.createdAt),
        ),
      ),
    );

  const [exp] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      byClinic(
        expenses.clinicId,
        clinicId,
        and(
          notDeleted(expenses.deletedAt),
          eq(expenses.method, "cash"),
          after(expenses.createdAt),
        ),
      ),
    );

  const [pout] = await db
    .select({ total: sql<number>`coalesce(sum(${doctorPayouts.amount}), 0)` })
    .from(doctorPayouts)
    // NOT `notDeleted`: `doctor_payouts` has no soft-delete columns and `voidPayout`
    // really deletes the row (see docs/petty-cash-plan.md §6). A voided payout
    // therefore vanishes from this sum — which is why a count SNAPSHOTS its expected
    // figure instead of recomputing it later.
    .where(
      byClinic(
        doctorPayouts.clinicId,
        clinicId,
        and(eq(doctorPayouts.method, "cash"), after(doctorPayouts.createdAt)),
      ),
    );

  const [xfer] = await db
    .select({
      out: sql<number>`coalesce(sum(case when ${cashTransfers.kind} in (${cashTransferKindId("bank_deposit")}, ${cashTransferKindId("owner_draw")}) then ${cashTransfers.amount} else 0 end), 0)`,
      in: sql<number>`coalesce(sum(case when ${cashTransfers.kind} = ${cashTransferKindId("float_topup")} then ${cashTransfers.amount} else 0 end), 0)`,
    })
    .from(cashTransfers)
    .where(
      byClinic(
        cashTransfers.clinicId,
        clinicId,
        and(notDeleted(cashTransfers.deletedAt), after(cashTransfers.createdAt)),
      ),
    );

  const untendered = await untenderedSince(clinicId, from);
  const reasons = await reasonsSince(clinicId, from);

  return {
    collected: Number(pay?.collected ?? 0),
    refunded: Number(pay?.refunded ?? 0),
    expenses: Number(exp?.total ?? 0),
    payouts: Number(pout?.total ?? 0),
    transfersOut: Number(xfer?.out ?? 0),
    transfersIn: Number(xfer?.in ?? 0),
    untendered,
    reasons,
  };
}

/**
 * The words attached to the cash that left: an expense's note or vendor, a transfer's
 * reference or note. Capped, because this feeds a hint under a figure rather than a
 * report — a drawer with forty entries needs the history table, not a longer hint.
 */
async function reasonsSince(clinicId: string, from: Date | null) {
  const after = <T extends { getSQL: () => unknown }>(col: T) =>
    from ? gt(col as never, from as never) : undefined;

  const spentRows = await db
    .select({ note: expenses.note, vendor: expenses.vendor })
    .from(expenses)
    .where(
      byClinic(
        expenses.clinicId,
        clinicId,
        and(notDeleted(expenses.deletedAt), eq(expenses.method, "cash"), after(expenses.createdAt)),
      ),
    )
    .orderBy(desc(expenses.createdAt))
    .limit(6);

  const movedRows = await db
    .select({ note: cashTransfers.note, reference: cashTransfers.reference })
    .from(cashTransfers)
    .where(
      byClinic(
        cashTransfers.clinicId,
        clinicId,
        and(notDeleted(cashTransfers.deletedAt), after(cashTransfers.createdAt)),
      ),
    )
    .orderBy(desc(cashTransfers.createdAt))
    .limit(6);

  const clean = (xs: (string | null)[]) =>
    xs.map((x) => (x ?? "").trim()).filter((x) => x.length > 0);

  return {
    spent: clean(spentRows.map((r) => r.note ?? r.vendor)),
    moved: clean(movedRows.map((r) => r.reference ?? r.note)),
  };
}

/** Money recorded with no tender at all — shown, never guessed at. */
async function untenderedSince(clinicId: string, from: Date | null) {
  const after = <T extends { getSQL: () => unknown }>(col: T) =>
    from ? gt(col as never, from as never) : undefined;

  const [e] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      byClinic(
        expenses.clinicId,
        clinicId,
        and(
          notDeleted(expenses.deletedAt),
          sql`${expenses.method} is null`,
          after(expenses.createdAt),
        ),
      ),
    );
  const [p] = await db
    .select({ total: sql<number>`coalesce(sum(${doctorPayouts.amount}), 0)` })
    .from(doctorPayouts)
    .where(
      byClinic(
        doctorPayouts.clinicId,
        clinicId,
        and(sql`${doctorPayouts.method} is null`, after(doctorPayouts.createdAt)),
      ),
    );
  const [pp] = await db
    .select({ total: sql<number>`coalesce(sum(${patientPayments.amount}), 0)` })
    .from(patientPayments)
    .where(
      byClinic(
        patientPayments.clinicId,
        clinicId,
        and(
          notDeleted(patientPayments.deletedAt),
          sql`${patientPayments.method} is null`,
          after(patientPayments.createdAt),
        ),
      ),
    );

  return {
    expenses: Number(e?.total ?? 0),
    payouts: Number(p?.total ?? 0),
    payments: Number(pp?.total ?? 0),
  };
}

/**
 * Record a handover count.
 *
 * The expected total and the variance are SNAPSHOT onto the row, not recomputed on
 * read. A cash expense back-dated into a counted window — or a payout voided
 * afterwards, which really deletes the row — would otherwise rewrite a variance
 * somebody has already signed off and explained. Same reasoning as `sales`
 * snapshotting its amounts (ADR-016).
 *
 * The first count of a clinic's life IS the opening float: there is nothing to
 * reconcile against, so `expected` and `variance` are left NULL rather than zero.
 */
export async function recordCashCount(
  clinicId: string,
  input: { countedTotal: number; note?: string | null; by: { id: string; name: string } },
): Promise<{ id: string; variance: number | null }> {
  const state = await getDrawerState(clinicId);
  const expected = state.expected;

  const [row] = await db
    .insert(cashCounts)
    .values({
      clinicId,
      countedTotal: input.countedTotal,
      expectedTotal: expected,
      variance: expected === null ? null : input.countedTotal - expected,
      note: input.note ?? null,
      countedBy: input.by.id,
      countedByName: input.by.name,
    })
    .returning({ id: cashCounts.id, variance: cashCounts.variance });

  return { id: row.id, variance: row.variance };
}

/** Money moved into or out of the drawer that is not a cost. */
export async function recordCashTransfer(
  clinicId: string,
  input: {
    kind: "bank_deposit" | "owner_draw" | "float_topup";
    amount: number;
    reference?: string | null;
    note?: string | null;
    by: { id: string; name: string };
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(cashTransfers)
    .values({
      clinicId,
      kind: input.kind,
      amount: input.amount,
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdBy: input.by.id,
      createdByName: input.by.name,
    })
    .returning({ id: cashTransfers.id });
  return { id: row.id };
}

/**
 * The handover history, newest first, optionally bounded by a date range.
 *
 * The range filters the HISTORY ONLY. It must never reach `getDrawerState`: what
 * should be in the drawer is a fact about right now, reckoned from the newest count
 * whenever that was, and letting a filter move it would produce a figure that is
 * confidently wrong — "expected Rs 4,300 in September" means nothing about the box on
 * the desk.
 */
export async function listCashCounts(
  clinicId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {},
) {
  return db
    .select()
    .from(cashCounts)
    .where(
      byClinic(
        cashCounts.clinicId,
        clinicId,
        and(
          notDeleted(cashCounts.deletedAt),
          opts.from ? gte(cashCounts.countedAt, opts.from) : undefined,
          opts.to ? lt(cashCounts.countedAt, opts.to) : undefined,
        ),
      ),
    )
    .orderBy(desc(cashCounts.countedAt))
    .limit(opts.limit ?? 50);
}

/** Cash moves, same range treatment as the counts they sit beside. */
export async function listRecentTransfers(
  clinicId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {},
) {
  return db
    .select()
    .from(cashTransfers)
    .where(
      byClinic(
        cashTransfers.clinicId,
        clinicId,
        and(
          notDeleted(cashTransfers.deletedAt),
          opts.from ? gte(cashTransfers.occurredAt, opts.from) : undefined,
          opts.to ? lt(cashTransfers.occurredAt, opts.to) : undefined,
        ),
      ),
    )
    .orderBy(desc(cashTransfers.occurredAt))
    .limit(opts.limit ?? 50);
}

/**
 * Correcting a count.
 *
 * THE COUNTED TOTAL IS EDITABLE; THE EXPECTED TOTAL IS NOT. That split is the whole
 * of it, and an earlier version of this module got it wrong by refusing both.
 *
 * `expectedTotal` is a snapshot of what the ledgers said at the moment of counting.
 * Nothing a person types afterwards can change what was true then, so it is never
 * recomputed — that is what makes a signed-off variance survive a back-dated expense.
 *
 * `countedTotal` is just what somebody read off a pile of notes, and people mistype.
 * The argument for refusing it was "count again", which sounded principled and is
 * worse in practice: a fat-fingered 41,000 instead of 4,100 leaves a nonsense variance
 * in the record for ever AND opens the next window from a wrong float, and counting
 * again fixes neither. So it can be corrected, and the variance is RE-DERIVED from the
 * untouched snapshot — never re-measured against today's ledgers.
 *
 * Editing it does move every later expected figure, because the float carries forward
 * from what was counted. That is the point: if the true figure was 4,100, everything
 * reckoned from 41,000 was wrong too.
 *
 * DELETING IS SOFT (ADR-006), and it matters more here than usual: a deleted count is
 * a money record somebody signed, and a variance that can be made to disappear is a
 * variance nobody has to answer for. It leaves the drawer's arithmetic — the next
 * count re-bases on the newest surviving one — but stays in the row for Trash.
 */
export async function updateCashCount(
  clinicId: string,
  id: string,
  input: { countedTotal?: number; note?: string | null },
): Promise<boolean> {
  const [current] = await db
    .select({ expected: cashCounts.expectedTotal, counted: cashCounts.countedTotal })
    .from(cashCounts)
    .where(byClinic(cashCounts.clinicId, clinicId, and(eq(cashCounts.id, id), notDeleted(cashCounts.deletedAt))));
  if (!current) return false;

  const countedTotal = input.countedTotal ?? current.counted;
  const [row] = await db
    .update(cashCounts)
    .set({
      countedTotal,
      // From the STORED expectation, not a fresh reading of the ledgers. An opening
      // float has no expectation, so it keeps none — correcting its figure does not
      // invent a reconciliation that never happened.
      variance: current.expected === null ? null : countedTotal - current.expected,
      ...(input.note !== undefined ? { note: input.note } : {}),
    })
    .where(byClinic(cashCounts.clinicId, clinicId, and(eq(cashCounts.id, id), notDeleted(cashCounts.deletedAt))))
    .returning({ id: cashCounts.id });
  return Boolean(row);
}

export async function softDeleteCashCount(
  clinicId: string,
  id: string,
  by: { id: string },
): Promise<boolean> {
  const [row] = await db
    .update(cashCounts)
    .set({ deletedAt: new Date(), deletedBy: by.id })
    .where(byClinic(cashCounts.clinicId, clinicId, and(eq(cashCounts.id, id), notDeleted(cashCounts.deletedAt))))
    .returning({ id: cashCounts.id });
  return Boolean(row);
}

/** A transfer is fully editable — it is a plain record of money moving, with no
 *  snapshot hanging off it, so a typo is just a typo. */
export async function updateCashTransfer(
  clinicId: string,
  id: string,
  input: { kind: "bank_deposit" | "owner_draw" | "float_topup"; amount: number; reference: string | null; note: string | null },
): Promise<boolean> {
  const [row] = await db
    .update(cashTransfers)
    .set({ kind: input.kind, amount: input.amount, reference: input.reference, note: input.note })
    .where(
      byClinic(
        cashTransfers.clinicId,
        clinicId,
        and(eq(cashTransfers.id, id), notDeleted(cashTransfers.deletedAt)),
      ),
    )
    .returning({ id: cashTransfers.id });
  return Boolean(row);
}

export async function softDeleteCashTransfer(
  clinicId: string,
  id: string,
  by: { id: string },
): Promise<boolean> {
  const [row] = await db
    .update(cashTransfers)
    .set({ deletedAt: new Date(), deletedBy: by.id })
    .where(
      byClinic(
        cashTransfers.clinicId,
        clinicId,
        and(eq(cashTransfers.id, id), notDeleted(cashTransfers.deletedAt)),
      ),
    )
    .returning({ id: cashTransfers.id });
  return Boolean(row);
}

export type DrawerEntry =
  | { kind: "count"; at: Date; count: CashCount }
  | { kind: "move"; at: Date; move: CashTransfer };

/**
 * The drawer history as ONE paged chronology across two tables.
 *
 * ADR-024's shape, for the same reason Trash uses it: each source is asked for at
 * most `offset + limit` rows, the two are merged, and the page is cut from the
 * result. A SQL UNION would page in one round trip, but it would mean expressing
 * both row shapes — a count with its snapshotted expectation, a transfer with its
 * kind and reference — as one projection, and keeping that in step with how each is
 * rendered. The bound is what matters, and this gets it without the coupling.
 *
 * The merge therefore holds `2 × (offset + limit)` rows, not the tables. Deep paging
 * grows with the offset, which is acceptable and would only be worth revisiting if
 * somebody actually pages deep into a cash drawer.
 */
export async function listDrawerHistory(
  clinicId: string,
  opts: { from?: Date; to?: Date; offset?: number; limit?: number } = {},
): Promise<{ rows: DrawerEntry[]; total: number }> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 20;
  const need = offset + limit;
  const range = { from: opts.from, to: opts.to };

  const inRange = <T extends { getSQL: () => unknown }>(col: T) =>
    and(
      opts.from ? gte(col as never, opts.from as never) : undefined,
      opts.to ? lt(col as never, opts.to as never) : undefined,
    );

  const [counts, moves, countTotal, moveTotal] = await Promise.all([
    listCashCounts(clinicId, { ...range, limit: need }),
    listRecentTransfers(clinicId, { ...range, limit: need }),
    db
      .select({ n: count() })
      .from(cashCounts)
      .where(
        byClinic(
          cashCounts.clinicId,
          clinicId,
          and(notDeleted(cashCounts.deletedAt), inRange(cashCounts.countedAt)),
        ),
      ),
    db
      .select({ n: count() })
      .from(cashTransfers)
      .where(
        byClinic(
          cashTransfers.clinicId,
          clinicId,
          and(notDeleted(cashTransfers.deletedAt), inRange(cashTransfers.occurredAt)),
        ),
      ),
  ]);

  const merged: DrawerEntry[] = [
    ...counts.map((c) => ({ kind: "count" as const, at: c.countedAt, count: c })),
    ...moves.map((t) => ({ kind: "move" as const, at: t.occurredAt, move: t })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    rows: merged.slice(offset, offset + limit),
    total: Number(countTotal[0]?.n ?? 0) + Number(moveTotal[0]?.n ?? 0),
  };
}
