import "server-only";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { expenses } from "@/core/db/schema";

/**
 * Recurring expenses (Finance) — a recurring expense row is a TEMPLATE: the cron
 * materialises a fresh, plain (non-recurring) copy each period and advances the
 * template's `next_run_on`. So the P&L counts one real expense per occurrence and
 * the template never double-counts. Platform-wide (all clinics), like the reminder
 * cron. Pure date math here so create/update and the cron agree.
 */

export type Recurrence = "monthly" | "weekly";

/** Normalise free-text input to a supported interval (default monthly). */
export function normalizeRecurrence(v: string | null | undefined): Recurrence {
  return v === "weekly" ? "weekly" : "monthly";
}

const p2 = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate(); // m is 1-based

/** The next occurrence date (YYYY-MM-DD) after `iso`, given the interval. */
export function nextRunFrom(iso: string, recurrence: Recurrence): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (recurrence === "weekly") {
    const dt = new Date(y, m - 1, d + 7);
    return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  // Monthly: advance one month, clamping the day to the target month's length so
  // Jan 31 → Feb 28/29 rather than rolling into March.
  const targetMonth = m === 12 ? 1 : m + 1;
  const targetYear = m === 12 ? y + 1 : y;
  const day = Math.min(d, daysInMonth(targetYear, targetMonth));
  return toIso(targetYear, targetMonth, day);
}

function todayIso(now: Date): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Generate every recurring expense that has come due (across all clinics), cloning
 * the template into a plain expense for each missed period and advancing the
 * template's `next_run_on` past today. Catch-up is capped per template so a stale
 * date can't explode into thousands of rows. Returns counts for the cron response.
 */
export async function generateDueRecurringExpenses(
  now: Date = new Date(),
): Promise<{ templates: number; generated: number }> {
  const today = todayIso(now);

  const due = await db
    .select({
      id: expenses.id,
      clinicId: expenses.clinicId,
      categoryId: expenses.categoryId,
      amount: expenses.amount,
      vendor: expenses.vendor,
      method: expenses.method,
      reference: expenses.reference,
      note: expenses.note,
      recurrence: expenses.recurrence,
      nextRunOn: expenses.nextRunOn,
    })
    .from(expenses)
    .where(
      and(
        notDeleted(expenses.deletedAt),
        eq(expenses.recurring, true),
        isNotNull(expenses.nextRunOn),
        lte(expenses.nextRunOn, today),
      ),
    );

  let generated = 0;
  const CAP = 24; // never fire more than 2 years' worth on one template in a run

  for (const t of due) {
    const recurrence = normalizeRecurrence(t.recurrence);
    let runOn = t.nextRunOn as string;
    const toInsert: (typeof expenses.$inferInsert)[] = [];
    let iterations = 0;
    while (runOn <= today && iterations < CAP) {
      toInsert.push({
        clinicId: t.clinicId,
        categoryId: t.categoryId,
        amount: t.amount,
        incurredOn: runOn,
        vendor: t.vendor,
        method: t.method,
        reference: t.reference,
        note: t.note,
        recurring: false, // a generated occurrence is a plain expense, not a template
        createdByName: "Recurring",
      });
      runOn = nextRunFrom(runOn, recurrence);
      iterations++;
    }
    if (toInsert.length === 0) continue;

    await db.transaction(async (tx) => {
      await tx.insert(expenses).values(toInsert);
      await tx
        .update(expenses)
        .set({ nextRunOn: runOn, updatedAt: new Date() })
        .where(eq(expenses.id, t.id));
    });
    generated += toInsert.length;
  }

  return { templates: due.length, generated };
}
