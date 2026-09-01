"use server";

import { revalidatePath } from "next/cache";
import { getClinic } from "@/core/clinics/get-clinic";

import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { displayStaffName } from "@/core/types/auth";
import { clinicHasFeature } from "@/core/lib/features";
import {
  createCategory,
  createExpense,
  restoreExpense,
  setCategoryActive,
  softDeleteExpense,
  updateExpense,
} from "@/core/expenses";
import { logActivity } from "@/core/audit/log";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import { PAYMENT_METHODS } from "@/core/finance/payment-methods";

export type ExpenseActionState = { error?: string; saved?: boolean };

async function requireExpenses(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string } | { error: string }> {
  const user = await requireRole(["clinic_admin", "manager", "doctor", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  const c = await getClinic(user.clinicId);
  if (!clinicHasFeature(c?.featuresEnabled, "finance")) return { error: "Expenses aren't enabled for this clinic." };
  if (!can(user, "expenses", action)) return { error: "You don't have permission for that." };
  return { user, clinicId: user.clinicId };
}

const expenseSchema = z.object({
  categoryId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  vendor: z.string().trim().max(120).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  recurring: z.boolean().optional(),
  recurrence: z.enum(["monthly", "weekly"]).optional(),
});

/** Create (id null) or edit an expense. */
export async function saveExpense(
  expenseId: string | null,
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const guard = await requireExpenses(expenseId ? "edit" : "create");
  if ("error" in guard) return guard;
  const { user, clinicId } = guard;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId") || undefined,
    amount: formData.get("amount"),
    incurredOn: formData.get("incurredOn"),
    vendor: formData.get("vendor") || undefined,
    method: formData.get("method") || undefined,
    reference: formData.get("reference") || undefined,
    note: formData.get("note") || undefined,
    recurring: formData.get("recurring") === "on",
    recurrence: (formData.get("recurrence") as string) || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const input = {
    categoryId: parsed.data.categoryId ?? null,
    amount: parsed.data.amount,
    incurredOn: parsed.data.incurredOn,
    vendor: parsed.data.vendor ?? null,
    method: parsed.data.method ?? null,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    recurring: parsed.data.recurring ?? false,
    recurrence: parsed.data.recurrence ?? null,
  };

  if (expenseId) {
    const ok = await updateExpense(clinicId, expenseId, input);
    if (!ok) return { error: "Expense not found." };
    await logActivity({ action: "update", entity: "settings", entityId: expenseId, summary: `Edited an expense (Rs ${input.amount})` });
  } else {
    const id = await createExpense(clinicId, input, {
      id: user.id,
      name: displayStaffName(user.prefix, user.fullName, user.username),
    });
    await logActivity({ action: "create", entity: "settings", entityId: id, summary: `Added an expense (Rs ${input.amount})` });
  }
  revalidatePath("/clinic/expenses");
  revalidateFinance(); // P&L + dashboard net profit
  return { saved: true };
}

export async function deleteExpenseAction(expenseId: string): Promise<ExpenseActionState> {
  const guard = await requireExpenses("delete");
  if ("error" in guard) return guard;
  const ok = await softDeleteExpense(guard.clinicId, expenseId, guard.user.id);
  if (!ok) return { error: "Expense not found." };
  await logActivity({ action: "delete", entity: "settings", entityId: expenseId, summary: "Moved an expense to Trash" });
  revalidatePath("/clinic/expenses");
  revalidateFinance();
  return { saved: true };
}

export async function restoreExpenseAction(expenseId: string): Promise<ExpenseActionState> {
  const guard = await requireExpenses("delete");
  if ("error" in guard) return guard;
  const ok = await restoreExpense(guard.clinicId, expenseId);
  if (!ok) return { error: "Expense not found." };
  await logActivity({ action: "update", entity: "settings", entityId: expenseId, summary: "Restored an expense" });
  revalidatePath("/clinic/expenses");
  revalidateFinance();
  return { saved: true };
}

export async function addCategoryAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const guard = await requireExpenses("edit");
  if ("error" in guard) return guard;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a category name." };
  await createCategory(guard.clinicId, name);
  await logActivity({ action: "create", entity: "settings", summary: `Added expense category "${name}"` });
  revalidatePath("/clinic/expenses");
  return { saved: true };
}

export async function toggleCategoryAction(categoryId: string, isActive: boolean): Promise<ExpenseActionState> {
  const guard = await requireExpenses("edit");
  if ("error" in guard) return guard;
  await setCategoryActive(guard.clinicId, categoryId, isActive);
  revalidatePath("/clinic/expenses");
  return { saved: true };
}
