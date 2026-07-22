import "server-only";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { companyExpenses } from "@/core/db/schema";
import { nextRunFrom, normalizeRecurrence } from "@/core/expenses/recurring";

/**
 * Recurring COMPANY expenses (Owner Finance, Phase 2). A recurring row is a TEMPLATE:
 * the cron materialises a fresh plain (non-recurring) copy each period and advances
 * the template's `next_run_on`, so the P&L counts one real expense per occurrence.
 * Same date math as the clinic recurring cron, one tier up (no clinic_id).
 */
export async function generateDueRecurringCompanyExpenses(
  now: Date = new Date(),
): Promise<{ templates: number; generated: number }> {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;

  const due = await db
    .select({
      id: companyExpenses.id,
      categoryId: companyExpenses.categoryId,
      amount: companyExpenses.amount,
      vendor: companyExpenses.vendor,
      method: companyExpenses.method,
      reference: companyExpenses.reference,
      note: companyExpenses.note,
      recurrence: companyExpenses.recurrence,
      nextRunOn: companyExpenses.nextRunOn,
    })
    .from(companyExpenses)
    .where(
      and(
        notDeleted(companyExpenses.deletedAt),
        eq(companyExpenses.recurring, true),
        isNotNull(companyExpenses.nextRunOn),
        lte(companyExpenses.nextRunOn, today),
      ),
    );

  let generated = 0;
  const CAP = 24;

  for (const t of due) {
    const recurrence = normalizeRecurrence(t.recurrence);
    let runOn = t.nextRunOn as string;
    const toInsert: (typeof companyExpenses.$inferInsert)[] = [];
    let iterations = 0;
    while (runOn <= today && iterations < CAP) {
      toInsert.push({
        categoryId: t.categoryId,
        amount: t.amount,
        incurredOn: runOn,
        vendor: t.vendor,
        method: t.method,
        reference: t.reference,
        note: t.note,
        recurring: false,
        createdByName: "Recurring",
      });
      runOn = nextRunFrom(runOn, recurrence);
      iterations++;
    }
    if (toInsert.length === 0) continue;
    await db.transaction(async (tx) => {
      await tx.insert(companyExpenses).values(toInsert);
      await tx.update(companyExpenses).set({ nextRunOn: runOn, updatedAt: new Date() }).where(eq(companyExpenses.id, t.id));
    });
    generated += toInsert.length;
  }
  return { templates: due.length, generated };
}
