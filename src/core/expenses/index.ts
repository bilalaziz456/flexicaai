import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import { expenseCategories, expenses } from "@/core/db/schema";

/**
 * Expenses (Finance) — CORE data layer. Categories are per-clinic config (deactivate,
 * never delete); expenses are soft-deletable (recoverable). All clinic-scoped. The
 * ACL + audit live in the action layer.
 */

const DEFAULT_CATEGORIES = ["Rent", "Salaries", "Supplies", "Lab", "Utilities", "Marketing", "Other"];

export type ExpenseCategoryRow = { id: string; name: string; isActive: boolean };

/** Seed the default categories the first time a clinic opens Expenses. */
export async function ensureDefaultCategories(clinicId: string): Promise<void> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(expenseCategories)
    .where(eq(expenseCategories.clinicId, clinicId));
  if (Number(n) > 0) return;
  await db.insert(expenseCategories).values(DEFAULT_CATEGORIES.map((name) => ({ clinicId, name })));
}

export async function listCategories(
  clinicId: string,
  includeInactive = false,
): Promise<ExpenseCategoryRow[]> {
  const rows = await db
    .select({ id: expenseCategories.id, name: expenseCategories.name, isActive: expenseCategories.isActive })
    .from(expenseCategories)
    .where(
      includeInactive
        ? eq(expenseCategories.clinicId, clinicId)
        : and(eq(expenseCategories.clinicId, clinicId), eq(expenseCategories.isActive, true)),
    )
    .orderBy(desc(expenseCategories.isActive), expenseCategories.name);
  return rows;
}

export async function createCategory(clinicId: string, name: string): Promise<void> {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  await db.insert(expenseCategories).values({ clinicId, name: n });
}

export async function setCategoryActive(clinicId: string, id: string, isActive: boolean): Promise<void> {
  await db
    .update(expenseCategories)
    .set({ isActive })
    .where(byClinic(expenseCategories.clinicId, clinicId, eq(expenseCategories.id, id)));
}

export type ExpenseRow = {
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

export type ExpenseFilters = {
  from?: Date;
  toExclusive?: Date;
  categoryId?: string;
  method?: string;
  q?: string;
  deleted?: boolean; // show the Trash view
  limit?: number;
  offset?: number;
};

function expenseConds(clinicId: string, f: ExpenseFilters) {
  const parts = [
    f.deleted ? sql`${expenses.deletedAt} is not null` : notDeleted(expenses.deletedAt),
  ];
  if (f.from) parts.push(gte(expenses.incurredOn, isoDate(f.from)));
  if (f.toExclusive) parts.push(lt(expenses.incurredOn, isoDate(f.toExclusive)));
  if (f.categoryId) parts.push(eq(expenses.categoryId, f.categoryId));
  if (f.method) parts.push(eq(expenses.method, f.method));
  if (f.q) parts.push(or(ilike(expenses.vendor, `%${f.q}%`), ilike(expenses.note, `%${f.q}%`))!);
  return byClinic(expenses.clinicId, clinicId, and(...parts));
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function listExpenses(
  clinicId: string,
  filters: ExpenseFilters,
): Promise<{ rows: ExpenseRow[]; total: number }> {
  const where = expenseConds(clinicId, filters);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: expenses.id,
        categoryName: expenseCategories.name,
        amount: expenses.amount,
        incurredOn: expenses.incurredOn,
        vendor: expenses.vendor,
        method: expenses.method,
        reference: expenses.reference,
        note: expenses.note,
        recurring: expenses.recurring,
        createdByName: expenses.createdByName,
        deletedAt: expenses.deletedAt,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(where)
      .orderBy(desc(expenses.incurredOn), desc(expenses.createdAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(expenses).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, deleted: r.deletedAt !== null })),
    total: Number(total),
  };
}

/** Σ expenses in a range (live only) — for the summary + P&L. */
export async function expensesTotal(
  clinicId: string,
  from: Date,
  toExclusive: Date,
): Promise<number> {
  const [row] = await db
    .select({ t: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
    .from(expenses)
    .where(
      byClinic(
        expenses.clinicId,
        clinicId,
        notDeleted(expenses.deletedAt),
        and(gte(expenses.incurredOn, isoDate(from)), lt(expenses.incurredOn, isoDate(toExclusive))),
      ),
    );
  return Number(row?.t ?? 0);
}

export type ExpenseInput = {
  categoryId: string | null;
  amount: number;
  incurredOn: string; // YYYY-MM-DD
  vendor: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recurring: boolean;
};

export async function createExpense(
  clinicId: string,
  input: ExpenseInput,
  actor: { id: string; name: string },
): Promise<string> {
  const [row] = await db
    .insert(expenses)
    .values({
      clinicId,
      categoryId: input.categoryId,
      amount: Math.max(0, Math.round(input.amount)),
      incurredOn: input.incurredOn,
      vendor: input.vendor?.slice(0, 120) || null,
      method: input.method?.slice(0, 40) || null,
      reference: input.reference?.slice(0, 120) || null,
      note: input.note?.slice(0, 500) || null,
      recurring: input.recurring,
      createdBy: actor.id,
      createdByName: actor.name,
    })
    .returning({ id: expenses.id });
  return row.id;
}

export async function updateExpense(
  clinicId: string,
  id: string,
  input: ExpenseInput,
): Promise<boolean> {
  const res = await db
    .update(expenses)
    .set({
      categoryId: input.categoryId,
      amount: Math.max(0, Math.round(input.amount)),
      incurredOn: input.incurredOn,
      vendor: input.vendor?.slice(0, 120) || null,
      method: input.method?.slice(0, 40) || null,
      reference: input.reference?.slice(0, 120) || null,
      note: input.note?.slice(0, 500) || null,
      recurring: input.recurring,
      updatedAt: new Date(),
    })
    .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.id, id)))
    .returning({ id: expenses.id });
  return res.length > 0;
}

export async function softDeleteExpense(
  clinicId: string,
  id: string,
  actorId: string,
): Promise<boolean> {
  const res = await db
    .update(expenses)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.id, id)))
    .returning({ id: expenses.id });
  return res.length > 0;
}

export async function restoreExpense(clinicId: string, id: string): Promise<boolean> {
  const res = await db
    .update(expenses)
    .set(restoreValues())
    .where(byClinic(expenses.clinicId, clinicId, eq(expenses.id, id)))
    .returning({ id: expenses.id });
  return res.length > 0;
}
