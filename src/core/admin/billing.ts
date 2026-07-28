import "server-only";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { clinics, clinicPayments, users } from "@/core/db/schema";

/**
 * Manual clinic→Klenic billing — CORE, super-admin control plane (Feature 6).
 * Model = "paid-through date + carry-forward", the SAME advance/outstanding math as
 * the patient `core/billing/*` ledger, one tier up. A payment PUSHES `paid_through`
 * forward by the months it covers; the gap past it carries forward as owed. Status
 * (`active`/`due`/`overdue`) feeds the Feature-2 lifecycle (`clinics.status`
 * active ↔ past_due). See docs/super-admin-plan.md §5.1 / §11 Feature 6.
 */

/** Shift a date by N whole months (JS handles month overflow). */
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

/** Whole months elapsed from `start` to `now` (0 until the first month completes). */
function wholeMonthsBetween(start: Date, now: Date): number {
  let m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) m -= 1; // current month not yet complete
  return Math.max(0, m);
}

const MS_DAY = 86_400_000;

export type ClinicBalance = {
  monthlyPrice: number;
  /** When billing began (activation, else clinic creation). */
  billingStart: Date;
  /** Whole months the money paid fully covers (Σ amount ÷ price). */
  monthsPaid: number;
  /** Subscription valid-until = billingStart + monthsPaid whole months. */
  paidThrough: Date;
  /** Σ payment amounts. */
  totalPaid: number;
  /** Billed to date — advance: (whole months elapsed + 1) × price. */
  accrued: number;
  billingStatus: "free" | "active" | "due" | "overdue";
  /** MONEY owed right now = max(0, accrued − paid). Supports partial payments. */
  owed: number;
  /** MONEY paid ahead = max(0, paid − accrued). */
  credit: number;
  /** Days until paid_through (0 if overdue). */
  daysRemaining: number;
  /** Days the outstanding balance has been due (0 if none). */
  daysOverdue: number;
};

type BalanceClinic = {
  monthlyPrice: number;
  graceDays: number;
  activatedAt: Date | null;
  createdAt: Date;
};

/**
 * PURE: a clinic's billing balance/status — MONEY-BASED, ADVANCE billing (the
 * month's fee is due at the start of the month). Supports arbitrary PARTIAL
 * payments: `owed = accrued − Σ paid`, so paying 2,000 of a 5,000 month leaves
 * 3,000 owed; overpaying leaves a `credit`. `months_covered` on payments is
 * ignored here (kept only as a record).
 */
/** Signed contribution of a ledger entry to the clinic's paid balance: a refund
 *  subtracts (money returned); payments and credits add. */
export function signedBalanceAmount(kind: string | undefined, amount: number): number {
  return kind === "refund" ? -amount : amount;
}

export function computeClinicBalance(
  clinic: BalanceClinic,
  payments: { amount: number; monthsCovered?: number; kind?: string }[],
  now: Date = new Date(),
): ClinicBalance {
  const billingStart = clinic.activatedAt ?? clinic.createdAt;
  const price = clinic.monthlyPrice;
  const paid = payments.reduce((s, p) => s + signedBalanceAmount(p.kind, p.amount), 0);

  // A free clinic (no price) is never billed.
  if (price <= 0) {
    return {
      monthlyPrice: 0, billingStart, monthsPaid: 0, paidThrough: billingStart, totalPaid: paid,
      accrued: 0, billingStatus: "free", owed: 0, credit: 0, daysRemaining: 0, daysOverdue: 0,
    };
  }

  // Advance billing: at billingStart month 1 is already due, so accrued counts the
  // current (started) month too.
  const monthsBilled = wholeMonthsBetween(billingStart, now) + 1;
  const accrued = monthsBilled * price;
  const owed = Math.max(0, accrued - paid);
  const credit = Math.max(0, paid - accrued);

  // Whole months the money fully covers → the paid-through date + the overdue anchor.
  const monthsPaid = Math.floor(paid / price);
  const paidThrough = addMonths(billingStart, monthsPaid);
  const anchorMs = paidThrough.getTime();

  const daysRemaining = owed <= 0 ? Math.max(0, Math.ceil((anchorMs - now.getTime()) / MS_DAY)) : 0;
  const daysOverdue = owed > 0 ? Math.max(0, Math.ceil((now.getTime() - anchorMs) / MS_DAY)) : 0;

  const billingStatus =
    owed <= 0 ? "active" : daysOverdue <= clinic.graceDays ? "due" : "overdue";

  return {
    monthlyPrice: price, billingStart, monthsPaid, paidThrough, totalPaid: paid,
    accrued, billingStatus, owed, credit, daysRemaining, daysOverdue,
  };
}

export type ClinicPaymentRow = {
  id: string;
  amount: number;
  kind: string;
  method: string | null;
  reference: string | null;
  monthsCovered: number;
  note: string | null;
  occurredAt: Date;
  recordedByName: string | null;
};

/** Reads a clinic + its live payment ledger and derives the balance. */
export async function getClinicBilling(clinicId: string): Promise<{
  clinic: BalanceClinic & {
    id: string;
    status: string;
    billingCycle: string;
    commitmentAt: Date | null;
    commitmentNote: string | null;
  };
  payments: ClinicPaymentRow[];
  balance: ClinicBalance;
} | null> {
  const [clinic] = await db
    .select({
      id: clinics.id,
      status: clinics.status,
      monthlyPrice: clinics.monthlyPrice,
      billingCycle: clinics.billingCycle,
      graceDays: clinics.graceDays,
      activatedAt: clinics.activatedAt,
      createdAt: clinics.createdAt,
      commitmentAt: clinics.paymentCommitmentAt,
      commitmentNote: clinics.paymentCommitmentNote,
    })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!clinic) return null;

  const payments = await db
    .select({
      id: clinicPayments.id,
      amount: clinicPayments.amount,
      kind: clinicPayments.kind,
      method: clinicPayments.method,
      reference: clinicPayments.reference,
      monthsCovered: clinicPayments.monthsCovered,
      note: clinicPayments.note,
      occurredAt: clinicPayments.occurredAt,
      recordedByName: clinicPayments.recordedByName,
    })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.clinicId, clinicId), notDeleted(clinicPayments.deletedAt)))
    .orderBy(desc(clinicPayments.occurredAt));

  return { clinic, payments, balance: computeClinicBalance(clinic, payments) };
}

/**
 * Lightweight balance from a SINGLE aggregate (Σ months, Σ amount) — for hot paths
 * like the clinic layout's payment-due banner, where loading every payment row per
 * request would be wasteful. Same math as `computeClinicBalance`.
 */
export async function getClinicBalanceSummary(
  clinic: BalanceClinic & { id: string },
): Promise<ClinicBalance> {
  const [agg] = await db
    .select({
      months: sql<number>`coalesce(sum(${clinicPayments.monthsCovered}),0)`,
      // Sign-aware: a refund subtracts from the paid balance.
      amount: sql<number>`coalesce(sum(case when ${clinicPayments.kind} = 'refund' then -${clinicPayments.amount} else ${clinicPayments.amount} end),0)`,
    })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.clinicId, clinic.id), notDeleted(clinicPayments.deletedAt)));
  // The signed sum is already the net paid; pass it as a single 'payment' entry.
  return computeClinicBalance(clinic, [
    { amount: Number(agg?.amount ?? 0), monthsCovered: Number(agg?.months ?? 0), kind: "payment" },
  ]);
}

/**
 * Auto-status hook (Feature 2 ↔ 6). Overdue NO LONGER auto-pauses a clinic —
 * pausing access is a deliberate, owner/super-admin-only MANUAL action (with a
 * password step-up); an overdue clinic just shows the dues/notice, it keeps working
 * until a human pauses it. See `setClinicStatus`. This hook now only ever GRANTS
 * access back: a legacy `past_due` clinic (auto-locked before this policy) that has
 * since cleared its balance is auto-resumed to `active`. It never locks a clinic.
 */
export async function syncClinicBillingStatus(clinicId: string): Promise<void> {
  const b = await getClinicBilling(clinicId);
  if (!b) return;
  const { clinic, balance } = b;
  if (balance.billingStatus !== "overdue" && clinic.status === "past_due") {
    await db
      .update(clinics)
      .set({ status: "active", activatedAt: clinic.activatedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));
  }
}

/**
 * Records a clinic payment (money-based, partial-friendly) + syncs status. When a
 * `commitmentAt` (follow-up date the clinic promised to clear the rest) is given
 * it's saved on the clinic; and whenever the resulting balance is fully settled we
 * clear any commitment (nothing left to chase).
 */
export async function recordClinicPayment(input: {
  clinicId: string;
  amount: number;
  /** 'payment' (default) | 'refund' (money out) | 'credit' (non-cash goodwill). */
  kind?: "payment" | "refund" | "credit";
  monthsCovered?: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  occurredAt?: Date;
  recordedBy?: string | null;
  recordedByName?: string | null;
  commitmentAt?: Date | null;
  commitmentNote?: string | null;
}): Promise<{ error: string } | { ok: true }> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: "Amount must be positive." };
  }
  const kind = input.kind ?? "payment";
  await db.insert(clinicPayments).values({
    clinicId: input.clinicId,
    amount: Math.round(input.amount),
    kind,
    // A refund/credit doesn't "cover" billing months; only a payment does.
    monthsCovered: kind === "payment" ? Math.max(0, Math.trunc(input.monthsCovered ?? 0)) : 0,
    method: input.method || null,
    reference: input.reference || null,
    note: input.note || null,
    occurredAt: input.occurredAt ?? new Date(),
    recordedBy: input.recordedBy ?? null,
    recordedByName: input.recordedByName ?? null,
  });
  await syncClinicBillingStatus(input.clinicId);

  // Follow-up commitment: set when there's still a balance, clear once settled.
  const after = await getClinicBilling(input.clinicId);
  const settled = !after || after.balance.owed <= 0;
  if (settled) {
    await db
      .update(clinics)
      .set({ paymentCommitmentAt: null, paymentCommitmentNote: null, updatedAt: new Date() })
      .where(eq(clinics.id, input.clinicId));
  } else if (input.commitmentAt !== undefined) {
    await db
      .update(clinics)
      .set({
        paymentCommitmentAt: input.commitmentAt,
        paymentCommitmentNote: input.commitmentNote?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(clinics.id, input.clinicId));
  }
  return { ok: true };
}

/**
 * Set or clear a clinic's payment follow-up (`payment_commitment_at`/`_note`) on its
 * OUTSTANDING subscription balance, WITHOUT recording a payment — the standalone
 * counterpart to the follow-up that `recordClinicPayment` sets inline. A future date
 * is "clinic promised to clear the balance by X"; `at = null` clears it. Unlike the
 * health-alert follow-up this does NOT hide the clinic from the dues list (unpaid is
 * unpaid) — it's shown alongside. Updates a clinic by id, so no tenant scope needed.
 */
export async function setPaymentCommitment(
  clinicId: string,
  at: Date | null,
  note: string | null,
): Promise<void> {
  await db
    .update(clinics)
    .set({
      paymentCommitmentAt: at,
      paymentCommitmentNote: at ? note?.trim() || null : null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
}

/**
 * Toggle whether the SOFT payment-due/overdue notice is shown to this clinic's own
 * staff (the workspace pill). Does NOT touch the super-admin dues dashboard or the
 * hard `past_due` access lock. Updates a clinic by id → no tenant scope needed.
 */
export async function setPaymentNoticeEnabled(clinicId: string, enabled: boolean): Promise<void> {
  await db
    .update(clinics)
    .set({ paymentNoticeEnabled: enabled, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
}

/** Voids (soft-deletes) a clinic payment + syncs status (paid_through shrinks). */
export async function voidClinicPayment(
  clinicId: string,
  paymentId: string,
  actorId: string,
): Promise<{ error: string } | { ok: true }> {
  const [row] = await db
    .select({ id: clinicPayments.id })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.clinicId, clinicId), eq(clinicPayments.id, paymentId), notDeleted(clinicPayments.deletedAt)))
    .limit(1);
  if (!row) return { error: "Payment not found." };

  await db
    .update(clinicPayments)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(and(eq(clinicPayments.clinicId, clinicId), eq(clinicPayments.id, paymentId)));
  await syncClinicBillingStatus(clinicId);
  return { ok: true };
}

export type OverdueClinic = {
  id: string;
  name: string;
  status: string;
  balance: ClinicBalance;
  /** Follow-up the clinic promised for the remaining balance (if any). */
  commitmentAt: Date | null;
  commitmentNote: string | null;
  /** Account manager (team member) assigned to this clinic. */
  assignedTo: string | null;
  assigneeName: string | null;
  assigneeSuspended: boolean;
};

/**
 * Cross-tenant: every priced clinic that is `due` or `overdue`, worst first —
 * for the /admin overdue list. One clinics scan + one payments scan, grouped in
 * memory (fleet-scale note: paginate/aggregate in SQL when clinic count climbs).
 */
export async function listDueClinics(): Promise<OverdueClinic[]> {
  return unscoped("admin: due/overdue clinics", async () => {
    const cs = await db
      .select({
        id: clinics.id,
        name: clinics.name,
        status: clinics.status,
        monthlyPrice: clinics.monthlyPrice,
        graceDays: clinics.graceDays,
        activatedAt: clinics.activatedAt,
        createdAt: clinics.createdAt,
        commitmentAt: clinics.paymentCommitmentAt,
        commitmentNote: clinics.paymentCommitmentNote,
        assignedTo: clinics.assignedTo,
        assigneeName: users.fullName,
        assigneeUsername: users.username,
        assigneeActive: users.isActive,
      })
      .from(clinics)
      .leftJoin(users, and(eq(clinics.assignedTo, users.id), isNull(users.deletedAt)))
      .where(and(notDeleted(clinics.deletedAt), gt(clinics.monthlyPrice, 0)));
    if (cs.length === 0) return [];

    const pays = await db
      .select({
        clinicId: clinicPayments.clinicId,
        amount: clinicPayments.amount,
        monthsCovered: clinicPayments.monthsCovered,
      })
      .from(clinicPayments)
      .where(notDeleted(clinicPayments.deletedAt));

    const byClinicId = new Map<string, { amount: number; monthsCovered: number }[]>();
    for (const p of pays) {
      const list = byClinicId.get(p.clinicId) ?? [];
      list.push({ amount: p.amount, monthsCovered: p.monthsCovered });
      byClinicId.set(p.clinicId, list);
    }

    const out: OverdueClinic[] = [];
    for (const c of cs) {
      const balance = computeClinicBalance(c, byClinicId.get(c.id) ?? []);
      if (balance.billingStatus === "due" || balance.billingStatus === "overdue") {
        out.push({
          id: c.id, name: c.name, status: c.status, balance,
          commitmentAt: c.commitmentAt, commitmentNote: c.commitmentNote,
          assignedTo: c.assignedTo, assigneeName: c.assigneeName ?? c.assigneeUsername,
          assigneeSuspended: c.assigneeActive === false,
        });
      }
    }
    return out.sort((a, b) => b.balance.owed - a.balance.owed || b.balance.daysOverdue - a.balance.daysOverdue);
  });
}

/**
 * Daily sweep (cron): recompute every priced clinic. Since overdue no longer
 * auto-pauses, this now only auto-RESUMES a legacy `past_due` clinic once its
 * balance clears (see `syncClinicBillingStatus`); it never locks anyone out.
 */
export async function sweepClinicBillingStatus(): Promise<{ scanned: number; changed: number }> {
  return unscoped("cron: clinic billing sweep", async () => {
    const cs = await db
      .select({ id: clinics.id })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), gt(clinics.monthlyPrice, 0)));
    let changed = 0;
    for (const c of cs) {
      const before = await db.select({ s: clinics.status }).from(clinics).where(eq(clinics.id, c.id)).limit(1);
      await syncClinicBillingStatus(c.id);
      const after = await db.select({ s: clinics.status }).from(clinics).where(eq(clinics.id, c.id)).limit(1);
      if (before[0]?.s !== after[0]?.s) changed++;
    }
    return { scanned: cs.length, changed };
  });
}
