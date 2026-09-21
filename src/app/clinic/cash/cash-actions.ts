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
import { recordCashCount, recordCashTransfer } from "@/core/finance/petty-cash";
import { CASH_TRANSFER_KIND_CODES } from "@/core/db/vocabulary-seed";

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
