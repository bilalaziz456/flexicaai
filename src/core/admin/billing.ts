import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { clinics, clinicPayments } from "@/core/db/schema";

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

const MS_DAY = 86_400_000;

export type ClinicBalance = {
  monthlyPrice: number;
  /** When billing began (activation, else clinic creation). */
  billingStart: Date;
  /** Σ months_covered across live payments. */
  monthsPaid: number;
  /** Subscription valid-until = billingStart + monthsPaid. */
  paidThrough: Date;
  /** Σ payment amounts (revenue view). */
  totalPaid: number;
  billingStatus: "free" | "active" | "due" | "overdue";
  /** Carried-forward money owed (0 when paid ahead / free). */
  owed: number;
  /** Days until paid_through (0 if overdue). */
  daysRemaining: number;
  /** Days past paid_through (0 if ahead). */
  daysOverdue: number;
};

type BalanceClinic = {
  monthlyPrice: number;
  graceDays: number;
  activatedAt: Date | null;
  createdAt: Date;
};

/** PURE: derive a clinic's billing balance/status from its clinic + live payments. */
export function computeClinicBalance(
  clinic: BalanceClinic,
  payments: { amount: number; monthsCovered: number }[],
  now: Date = new Date(),
): ClinicBalance {
  const billingStart = clinic.activatedAt ?? clinic.createdAt;
  const monthsPaid = payments.reduce((s, p) => s + p.monthsCovered, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const paidThrough = addMonths(billingStart, monthsPaid);
  const price = clinic.monthlyPrice;

  const ahead = paidThrough.getTime() - now.getTime();
  const daysRemaining = ahead > 0 ? Math.ceil(ahead / MS_DAY) : 0;
  const daysOverdue = ahead < 0 ? Math.ceil(-ahead / MS_DAY) : 0;

  // A free clinic (no price) is never billed.
  if (price <= 0) {
    return {
      monthlyPrice: 0, billingStart, monthsPaid, paidThrough, totalPaid,
      billingStatus: "free", owed: 0, daysRemaining, daysOverdue,
    };
  }

  // Carry-forward: each ~month past paid_through accrues one more month's price.
  const monthsOverdue = daysOverdue > 0 ? Math.ceil(daysOverdue / 30) : 0;
  const owed = monthsOverdue * price;
  const billingStatus =
    daysOverdue === 0 ? "active" : daysOverdue <= clinic.graceDays ? "due" : "overdue";

  return {
    monthlyPrice: price, billingStart, monthsPaid, paidThrough, totalPaid,
    billingStatus, owed, daysRemaining, daysOverdue,
  };
}

export type ClinicPaymentRow = {
  id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  monthsCovered: number;
  note: string | null;
  occurredAt: Date;
  recordedByName: string | null;
};

/** Reads a clinic + its live payment ledger and derives the balance. */
export async function getClinicBilling(clinicId: string): Promise<{
  clinic: BalanceClinic & { id: string; status: string; billingCycle: string };
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
    })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!clinic) return null;

  const payments = await db
    .select({
      id: clinicPayments.id,
      amount: clinicPayments.amount,
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
      amount: sql<number>`coalesce(sum(${clinicPayments.amount}),0)`,
    })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.clinicId, clinic.id), notDeleted(clinicPayments.deletedAt)));
  return computeClinicBalance(clinic, [
    { amount: Number(agg?.amount ?? 0), monthsCovered: Number(agg?.months ?? 0) },
  ]);
}

/**
 * Auto-status hook (Feature 2 ↔ 6): flips `clinics.status` between `active` and
 * `past_due` from the derived billing health. Only ever touches those two states —
 * trial / suspended / cancelled are the super-admin's manual call and untouched.
 */
export async function syncClinicBillingStatus(clinicId: string): Promise<void> {
  const b = await getClinicBilling(clinicId);
  if (!b) return;
  const { clinic, balance } = b;
  if (balance.billingStatus === "overdue" && clinic.status === "active") {
    await db.update(clinics).set({ status: "past_due", updatedAt: new Date() }).where(eq(clinics.id, clinicId));
  } else if (balance.billingStatus !== "overdue" && clinic.status === "past_due") {
    await db
      .update(clinics)
      .set({ status: "active", activatedAt: clinic.activatedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));
  }
}

/** Records a clinic payment (extends paid_through by monthsCovered) + syncs status. */
export async function recordClinicPayment(input: {
  clinicId: string;
  amount: number;
  monthsCovered: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  occurredAt?: Date;
  recordedBy?: string | null;
  recordedByName?: string | null;
}): Promise<{ error: string } | { ok: true }> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: "Amount must be positive." };
  }
  const months = Math.trunc(input.monthsCovered);
  if (!Number.isFinite(months) || months < 0 || months > 120) {
    return { error: "Months covered must be 0–120." };
  }
  await db.insert(clinicPayments).values({
    clinicId: input.clinicId,
    amount: Math.round(input.amount),
    monthsCovered: months,
    method: input.method || null,
    reference: input.reference || null,
    note: input.note || null,
    occurredAt: input.occurredAt ?? new Date(),
    recordedBy: input.recordedBy ?? null,
    recordedByName: input.recordedByName ?? null,
  });
  await syncClinicBillingStatus(input.clinicId);
  return { ok: true };
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
      })
      .from(clinics)
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
        out.push({ id: c.id, name: c.name, status: c.status, balance });
      }
    }
    return out.sort((a, b) => b.balance.owed - a.balance.owed || b.balance.daysOverdue - a.balance.daysOverdue);
  });
}

/**
 * Daily sweep (cron): recompute every priced clinic and flip active↔past_due as
 * time passes (the time-based downgrade a payment event can't trigger).
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
