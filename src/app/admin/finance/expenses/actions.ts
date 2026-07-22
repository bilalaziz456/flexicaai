"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminCapability } from "@/core/auth/user";
import { displayStaffName } from "@/core/types/auth";
import {
  createCompanyCategory,
  createCompanyExpense,
  restoreCompanyExpense,
  setCompanyCategoryActive,
  softDeleteCompanyExpense,
  updateCompanyExpense,
} from "@/core/admin/company-expenses";
import { logActivity } from "@/core/audit/log";

export type ExpenseActionState = { error?: string; saved?: boolean };

const schema = z.object({
  categoryId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  vendor: z.string().trim().max(120).optional(),
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  recurring: z.boolean().optional(),
  recurrence: z.enum(["monthly", "weekly"]).optional(),
});

/** Create (id null) or edit a company expense. finance:create / finance:edit. */
export async function saveCompanyExpense(
  expenseId: string | null,
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireAdminCapability(expenseId ? "finance:edit" : "finance:create");
  const parsed = schema.safeParse({
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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

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
    const ok = await updateCompanyExpense(expenseId, input);
    if (!ok) return { error: "Expense not found." };
    await logActivity({ action: "update", entity: "settings", entityId: expenseId, clinicId: null, summary: `Edited a company expense (Rs ${input.amount})` });
  } else {
    const id = await createCompanyExpense(input, { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) });
    await logActivity({ action: "create", entity: "settings", entityId: id, clinicId: null, summary: `Added a company expense (Rs ${input.amount})` });
  }
  revalidatePath("/admin/finance/expenses");
  return { saved: true };
}

export async function deleteCompanyExpenseAction(expenseId: string): Promise<ExpenseActionState> {
  const user = await requireAdminCapability("finance:delete");
  const ok = await softDeleteCompanyExpense(expenseId, user.id);
  if (!ok) return { error: "Expense not found." };
  await logActivity({ action: "delete", entity: "settings", entityId: expenseId, clinicId: null, summary: "Moved a company expense to Trash" });
  revalidatePath("/admin/finance/expenses");
  return { saved: true };
}

export async function restoreCompanyExpenseAction(expenseId: string): Promise<ExpenseActionState> {
  await requireAdminCapability("finance:delete");
  const ok = await restoreCompanyExpense(expenseId);
  if (!ok) return { error: "Expense not found." };
  await logActivity({ action: "update", entity: "settings", entityId: expenseId, clinicId: null, summary: "Restored a company expense" });
  revalidatePath("/admin/finance/expenses");
  return { saved: true };
}

export async function addCompanyCategoryAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  await requireAdminCapability("finance:edit");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a category name." };
  await createCompanyCategory(name);
  await logActivity({ action: "create", entity: "settings", clinicId: null, summary: `Added company expense category "${name}"` });
  revalidatePath("/admin/finance/expenses");
  return { saved: true };
}

export async function toggleCompanyCategoryAction(categoryId: string, isActive: boolean): Promise<ExpenseActionState> {
  await requireAdminCapability("finance:edit");
  await setCompanyCategoryActive(categoryId, isActive);
  revalidatePath("/admin/finance/expenses");
  return { saved: true };
}
