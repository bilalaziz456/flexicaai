import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import { companyExpenseCategories, companyExpenses } from "@/core/db/schema";
import { nextRunFrom, normalizeRecurrence } from "@/core/expenses/recurring";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Company operating expenses (Owner Finance, Phase 2) — CORE data layer. Klenic's
 * OWN costs (payroll, rent, software, …), NOT a tenant table (no `clinic_id`), so
 * the tenant guard ignores it and no `unscoped` is needed. Categories are config
 * (deactivate, never delete); expenses soft-delete (recoverable). ACL + audit live
 * in the action layer. Mirrors core/expenses one tier up + adds by-category and
 * per-bucket trend aggregates for the graphs.
 */

const DEFAULT_CATEGORIES = [
  "Payroll",
  "Rent",
  "Software/Infra",
  "Marketing",
  "Legal/Professional",
  "Taxes",
  "AI/API",
  "WhatsApp",
  "Other",
];

const p2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export type CompanyCategoryRow = { id: string; name: string; isActive: boolean };

/** Seed the default categories the first time the page is opened. */
export async function ensureDefaultCompanyCategories(): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(companyExpenseCategories);
  if (Number(n) > 0) return;
  await db.insert(companyExpenseCategories).values(DEFAULT_CATEGORIES.map((name) => ({ name })));
}

export async function listCompanyCategories(includeInactive = false): Promise<CompanyCategoryRow[]> {
  return db
    .select({ id: companyExpenseCategories.id, name: companyExpenseCategories.name, isActive: companyExpenseCategories.isActive })
    .from(companyExpenseCategories)
    .where(includeInactive ? undefined : eq(companyExpenseCategories.isActive, true))
    .orderBy(desc(companyExpenseCategories.isActive), companyExpenseCategories.name);
}

export async function createCompanyCategory(name: string): Promise<void> {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  await db.insert(companyExpenseCategories).values({ name: n });
}

export async function setCompanyCategoryActive(id: string, isActive: boolean): Promise<void> {
  await db.update(companyExpenseCategories).set({ isActive }).where(eq(companyExpenseCategories.id, id));
}

export type CompanyExpenseRow = {
  id: string;
  categoryName: string | null;
  amount: number;
  incurredOn: string;
  vendor: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recurring: boolean;
  createdByName: string | null;
  deleted: boolean;
};

export type CompanyExpenseFilters = {
  from?: Date;
  toExclusive?: Date;
  categoryId?: string;
  method?: string;
  q?: string;
  deleted?: boolean;
  limit?: number;
  offset?: number;
};

function conds(f: CompanyExpenseFilters) {
  const parts = [
    f.deleted ? sql`${companyExpenses.deletedAt} is not null` : notDeleted(companyExpenses.deletedAt),
  ];
  if (f.from) parts.push(gte(companyExpenses.incurredOn, isoDate(f.from)));
  if (f.toExclusive) parts.push(lt(companyExpenses.incurredOn, isoDate(f.toExclusive)));
  if (f.categoryId) parts.push(eq(companyExpenses.categoryId, f.categoryId));
  if (f.method) parts.push(eq(companyExpenses.method, f.method));
  if (f.q) parts.push(or(ilike(companyExpenses.vendor, `%${f.q}%`), ilike(companyExpenses.note, `%${f.q}%`))!);
  return and(...parts);
}

export async function listCompanyExpenses(
  filters: CompanyExpenseFilters,
): Promise<{ rows: CompanyExpenseRow[]; total: number }> {
  const where = conds(filters);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: companyExpenses.id,
        categoryName: companyExpenseCategories.name,
        amount: companyExpenses.amount,
        incurredOn: companyExpenses.incurredOn,
        vendor: companyExpenses.vendor,
        method: companyExpenses.method,
        reference: companyExpenses.reference,
        note: companyExpenses.note,
        recurring: companyExpenses.recurring,
        createdByName: companyExpenses.createdByName,
        deletedAt: companyExpenses.deletedAt,
      })
      .from(companyExpenses)
      .leftJoin(companyExpenseCategories, eq(companyExpenseCategories.id, companyExpenses.categoryId))
      .where(where)
      .orderBy(desc(companyExpenses.incurredOn), desc(companyExpenses.createdAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(companyExpenses).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, deleted: r.deletedAt !== null })), total: Number(total) };
}

/** Σ live expenses in a range — for the summary + the company P&L (Phase 3). */
export async function companyExpensesTotal(from: Date, toExclusive: Date): Promise<number> {
  const [row] = await db
    .select({ t: sql<number>`coalesce(sum(${companyExpenses.amount}), 0)::int` })
    .from(companyExpenses)
    .where(and(notDeleted(companyExpenses.deletedAt), gte(companyExpenses.incurredOn, isoDate(from)), lt(companyExpenses.incurredOn, isoDate(toExclusive))));
  return Number(row?.t ?? 0);
}

/** Expenses grouped by category over a range (highest first) — the breakdown graph. */
export async function companyExpensesByCategory(
  from: Date,
  toExclusive: Date,
): Promise<{ category: string; total: number }[]> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${companyExpenseCategories.name}, 'Uncategorized')`,
      total: sql<number>`coalesce(sum(${companyExpenses.amount}), 0)::int`,
    })
    .from(companyExpenses)
    .leftJoin(companyExpenseCategories, eq(companyExpenseCategories.id, companyExpenses.categoryId))
    .where(and(notDeleted(companyExpenses.deletedAt), gte(companyExpenses.incurredOn, isoDate(from)), lt(companyExpenses.incurredOn, isoDate(toExclusive))))
    .groupBy(sql`coalesce(${companyExpenseCategories.name}, 'Uncategorized')`)
    .orderBy(desc(sql`sum(${companyExpenses.amount})`));
  return rows.map((r) => ({ category: r.category, total: Number(r.total) }));
}

/** Per-bucket expense totals over a resolved range — the trend chart. */
export async function companyExpensesTrend(range: ResolvedRange): Promise<{ label: string; total: number }[]> {
  const { start, end, granularity } = range;
  const rows = await db
    .select({ incurredOn: companyExpenses.incurredOn, amount: companyExpenses.amount })
    .from(companyExpenses)
    .where(and(notDeleted(companyExpenses.deletedAt), gte(companyExpenses.incurredOn, isoDate(start)), lt(companyExpenses.incurredOn, isoDate(end))));

  const buckets: { label: string; total: number }[] = [];
  const index = new Map<number, number>();
  for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
    index.set(cur.getTime(), buckets.length);
    buckets.push({ label: bucketLabel(cur, granularity), total: 0 });
  }
  for (const r of rows) {
    // incurredOn is a YYYY-MM-DD date string → parse as local midnight.
    const [y, m, d] = r.incurredOn.split("-").map(Number);
    const at = new Date(y, m - 1, d);
    const idx = index.get(startOfBucket(at, granularity).getTime());
    if (idx !== undefined) buckets[idx].total += r.amount;
  }
  return buckets;
}

export type CompanyExpenseInput = {
  categoryId: string | null;
  amount: number;
  incurredOn: string; // YYYY-MM-DD
  vendor: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recurring: boolean;
  recurrence?: string | null;
};

function recurrenceFields(input: CompanyExpenseInput): { recurrence: string | null; nextRunOn: string | null } {
  if (!input.recurring) return { recurrence: null, nextRunOn: null };
  const recurrence = normalizeRecurrence(input.recurrence);
  return { recurrence, nextRunOn: nextRunFrom(input.incurredOn, recurrence) };
}

export async function createCompanyExpense(
  input: CompanyExpenseInput,
  actor: { id: string; name: string },
): Promise<string> {
  const rec = recurrenceFields(input);
  const [row] = await db
    .insert(companyExpenses)
    .values({
      categoryId: input.categoryId,
      amount: Math.max(0, Math.round(input.amount)),
      incurredOn: input.incurredOn,
      vendor: input.vendor?.slice(0, 120) || null,
      method: input.method?.slice(0, 40) || null,
      reference: input.reference?.slice(0, 120) || null,
      note: input.note?.slice(0, 500) || null,
      recurring: input.recurring,
      recurrence: rec.recurrence,
      nextRunOn: rec.nextRunOn,
      createdBy: actor.id,
      createdByName: actor.name,
    })
    .returning({ id: companyExpenses.id });
  return row.id;
}

export async function updateCompanyExpense(id: string, input: CompanyExpenseInput): Promise<boolean> {
  const rec = recurrenceFields(input);
  const res = await db
    .update(companyExpenses)
    .set({
      categoryId: input.categoryId,
      amount: Math.max(0, Math.round(input.amount)),
      incurredOn: input.incurredOn,
      vendor: input.vendor?.slice(0, 120) || null,
      method: input.method?.slice(0, 40) || null,
      reference: input.reference?.slice(0, 120) || null,
      note: input.note?.slice(0, 500) || null,
      recurring: input.recurring,
      recurrence: rec.recurrence,
      nextRunOn: rec.nextRunOn,
      updatedAt: new Date(),
    })
    .where(and(notDeleted(companyExpenses.deletedAt), eq(companyExpenses.id, id)))
    .returning({ id: companyExpenses.id });
  return res.length > 0;
}

export async function softDeleteCompanyExpense(id: string, actorId: string): Promise<boolean> {
  const res = await db
    .update(companyExpenses)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(and(notDeleted(companyExpenses.deletedAt), eq(companyExpenses.id, id)))
    .returning({ id: companyExpenses.id });
  return res.length > 0;
}

export async function restoreCompanyExpense(id: string): Promise<boolean> {
  const res = await db
    .update(companyExpenses)
    .set(restoreValues())
    .where(eq(companyExpenses.id, id))
    .returning({ id: companyExpenses.id });
  return res.length > 0;
}
