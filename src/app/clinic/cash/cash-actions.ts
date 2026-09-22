"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { logActivity } from "@/core/audit/log";
import {
  recordCashCount,
  recordCashTransfer,
  softDeleteCashCount,
  softDeleteCashTransfer,
  updateCashCount,
  updateCashTransfer,
  updateDrawerSpend,
  softDeleteDrawerSpend,
} from "@/core/finance/petty-cash";
import { CASH_TRANSFER_KIND_CODES } from "@/core/db/vocabulary-seed";
import { NOT_YOURS } from "./ownership";
import { createExpense } from "@/core/expenses";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";

export type CashActionState = { error?: string; saved?: boolean };

/** Feature ∩ permission, checked first and in one place (ADR-013 / conventions §5). */
async function requireCash(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string } | { error: string }> {
  const user = await requireRole(["clinic_admin", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  const c = await getClinic(user.clinicId);
  if (!clinicHasFeature(c?.featuresEnabled, "finance")) {
    return { error: "Petty cash isn't enabled for this clinic." };
  }
  if (!can(user, "cash", action)) return { error: "You don't have permission for that." };
  return { user, clinicId: user.clinicId };
}

const countSchema = z.object({
  // Zero is legitimate — an emptied drawer is a real count, and refusing it would
  // push somebody into typing 1. Negative is not: you cannot count minus money.
  countedTotal: z.coerce.number().int().min(0, "A count cannot be negative.").max(100_000_000),
  note: z.string().trim().max(500).optional(),
});

export async function submitCashCount(
  _prev: CashActionState,
  formData: FormData,
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;

  const parsed = countSchema.safeParse({
    countedTotal: formData.get("countedTotal"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { variance } = await recordCashCount(guard.clinicId, {
    countedTotal: parsed.data.countedTotal,
    note: parsed.data.note ?? null,
    by: { id: guard.user.id, name: guard.user.fullName ?? guard.user.username },
  });

  await logActivity({
    action: "create",
    entity: "settings",
    // Ids and figures, never a judgement about a person (§10). The variance is the
    // fact; who was on shift is already on the row.
    summary:
      variance === null
        ? "Recorded the opening petty-cash float"
        : `Counted petty cash (variance ${variance >= 0 ? "+" : ""}${variance})`,
  });

  revalidatePath("/clinic/cash");
  return { saved: true };
}

const transferSchema = z.object({
  kind: z.enum(CASH_TRANSFER_KIND_CODES),
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function submitCashTransfer(
  _prev: CashActionState,
  formData: FormData,
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;

  const parsed = transferSchema.safeParse({
    kind: formData.get("kind"),
    amount: formData.get("amount"),
    reference: formData.get("reference") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await recordCashTransfer(guard.clinicId, {
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    by: { id: guard.user.id, name: guard.user.fullName ?? guard.user.username },
  });

  await logActivity({
    action: "create",
    entity: "settings",
    summary: `Recorded a petty-cash transfer (${parsed.data.kind}, Rs ${parsed.data.amount})`,
  });

  revalidatePath("/clinic/cash");
  return { saved: true };
}

const spendSchema = z.object({
  amount: z.coerce.number().int().positive("Enter an amount greater than zero."),
  what: z.string().trim().min(1, "Say what it was for.").max(120),
});

/**
 * "Paid for something" on the Move cash form.
 *
 * IT WRITES AN EXPENSE, not a cash transfer, and that distinction is the whole reason
 * this action exists rather than a fourth `cash_transfer_kinds` row. A transfer moves
 * money between the clinic's own pockets — banking it, topping the float up — and so
 * never reaches the P&L. Buying gloves is a COST. Recorded as a transfer it would
 * leave the drawer correctly and understate the clinic's expenses by exactly the
 * amount, every time, silently.
 *
 * So the front desk gets the one-click entry it asked for, and the row lands in the
 * ledger that already owns it: one place a cash expense can live (ADR-015), visible
 * in Expenses and the P&L, and picked up by the drawer because it reads that ledger.
 *
 * It needs `expenses:create` on top of `cash:create` — it is an expense, and who may
 * record one is not a question this screen gets to answer differently.
 */
export async function submitCashSpend(
  _prev: CashActionState,
  formData: FormData,
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;
  if (!can(guard.user, "expenses", "create")) {
    return { error: "You don't have permission to record an expense." };
  }

  const parsed = spendSchema.safeParse({
    amount: formData.get("amount"),
    what: formData.get("what"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  await createExpense(
    guard.clinicId,
    {
      amount: parsed.data.amount,
      // Local date, matching what the Expenses form writes — `toISOString()` would
      // give the UTC day, which is yesterday here for most of the evening.
      incurredOn: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
      method: "cash",
      note: parsed.data.what,
      // Uncategorised on purpose: the front desk is recording that cash left the
      // drawer, not doing the bookkeeping. Expenses is where a category is chosen,
      // and an empty one there is already a first-class state ("Uncategorized").
      categoryId: null,
      vendor: null,
      reference: null,
      recurring: false,
      // So the drawer can list it among its own records. It is still an ordinary
      // cash expense everywhere else — this only says where it was typed.
      fromDrawer: true,
    },
    { id: guard.user.id, name: guard.user.fullName ?? guard.user.username },
  );

  await logActivity({
    action: "create",
    entity: "settings",
    summary: `Recorded a cash expense from petty cash (Rs ${parsed.data.amount})`,
  });

  revalidatePath("/clinic/cash");
  revalidateFinance();
  return { saved: true };
}

/**
 * Correcting an entry. `cash:create` covers it: somebody who may record a count or a
 * move may fix their own typo, and there is no separate `cash:edit` because a
 * narrower grant here would mean a front desk that can enter a wrong figure and not
 * put it right — which is how a drawer ends up with a note in the margin instead of a
 * corrected record.
 */
const countEditSchema = z.object({
  countedTotal: z.coerce.number().int().min(0, "A count cannot be negative.").max(100_000_000),
  note: z.string().trim().max(500).optional(),
});

/**
 * Correcting a count: the figure somebody read off the notes, and the note explaining
 * it. The expected total is NOT touched — see `updateCashCount`, which re-derives the
 * variance from that frozen snapshot rather than from today's ledgers.
 *
 * Audit-logged with both figures, because this rewrites a money record that was
 * already signed: "corrected 41,000 → 4,100" is the line somebody needs later, and it
 * is the kind of change that is invisible afterwards without it.
 */
export async function editCashCount(
  id: string,
  input: { countedTotal: number; note?: string },
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;

  const parsed = countEditSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const ok = await updateCashCount(guard.clinicId, id, {
    countedTotal: parsed.data.countedTotal,
    note: parsed.data.note?.trim() || null,
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };

  await logActivity({
    action: "update",
    entity: "settings",
    summary: `Corrected a petty-cash count to Rs ${parsed.data.countedTotal}`,
  });
  revalidatePath("/clinic/cash");
  return { saved: true };
}

export async function removeCashCount(id: string): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;
  const ok = await softDeleteCashCount(guard.clinicId, id, {
    id: guard.user.id,
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };
  await logActivity({ action: "delete", entity: "settings", summary: "Deleted a petty-cash count" });
  revalidatePath("/clinic/cash");
  return { saved: true };
}

export async function editCashTransfer(
  id: string,
  input: { kind: string; amount: number; reference?: string | null },
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;

  const parsed = transferSchema.safeParse({
    kind: input.kind,
    amount: input.amount,
    reference: input.reference || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const ok = await updateCashTransfer(guard.clinicId, id, {
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    reference: parsed.data.reference ?? null,
    note: null,
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };
  await logActivity({ action: "update", entity: "settings", summary: "Edited a petty-cash move" });
  revalidatePath("/clinic/cash");
  return { saved: true };
}

export async function removeCashTransfer(id: string): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;
  const ok = await softDeleteCashTransfer(guard.clinicId, id, {
    id: guard.user.id,
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };
  await logActivity({ action: "delete", entity: "settings", summary: "Deleted a petty-cash move" });
  revalidatePath("/clinic/cash");
  return { saved: true };
}

/**
 * Correcting or removing a "Paid for something" from the drawer history.
 *
 * TWO PERMISSIONS, not one, exactly as recording it needs two. `cash:create` says you
 * may work the drawer; the row is an EXPENSE, so changing or removing it also needs
 * the `expenses` grant. A receptionist who may count the box is not thereby allowed
 * to rewrite a cost, and `softDeleteDrawerSpend` refuses anything not typed here.
 */
export async function editCashSpend(
  id: string,
  input: { amount: number; what: string },
): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;
  if (!can(guard.user, "expenses", "create")) {
    return { error: "You don't have permission to change an expense." };
  }

  const parsed = spendSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const ok = await updateDrawerSpend(guard.clinicId, id, {
    amount: parsed.data.amount,
    what: parsed.data.what,
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };

  await logActivity({
    action: "update",
    entity: "settings",
    summary: `Corrected a petty-cash spend to Rs ${parsed.data.amount}`,
  });
  revalidatePath("/clinic/cash");
  // It is an expense, so every screen that totals expenses is now stale — the same
  // sweep `submitCashSpend` does after writing one.
  revalidateFinance();
  return { saved: true };
}

export async function removeCashSpend(id: string): Promise<CashActionState> {
  const guard = await requireCash("create");
  if ("error" in guard) return guard;
  if (!can(guard.user, "expenses", "delete")) {
    return { error: "You don't have permission to delete an expense." };
  }
  const ok = await softDeleteDrawerSpend(guard.clinicId, id, guard.user.id, {
    onlyOwnedBy: guard.user.role === "clinic_admin" ? undefined : guard.user.id,
  });
  if (!ok) return { error: NOT_YOURS };
  await logActivity({
    action: "delete",
    entity: "settings",
    summary: "Deleted a petty-cash spend",
  });
  revalidatePath("/clinic/cash");
  revalidateFinance();
  return { saved: true };
}
