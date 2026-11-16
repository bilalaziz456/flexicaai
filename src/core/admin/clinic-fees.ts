import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { clinicFees, clinicInvoices, clinicPayments } from "@/core/db/schema";
import { clinicPaymentKindId } from "@/core/db/vocabulary-seed";
import { getCompanyInvoiceSettings } from "@/core/admin/clinic-invoices";
import { allocateFeePayments, feeLineLabel, type FeeKind } from "@/core/admin/clinic-fee-rules";

/**
 * One-time fees on a clinic — training, implementation… (migration 0152, owner
 * 2026-11-17). CORE, company control-plane; the rules are in `clinic-fee-rules.ts`.
 * ACL (`fees:*`) and the account-manager scope (`managesClinic`) live in the actions.
 */

/**
 * The live invoice that lists this fee, if any. A fee is "invoiced" only while a LIVE
 * invoice carries it in `fee_lines`, so voiding the invoice frees the fee again with
 * nothing to keep in step.
 *
 * The outer columns are written out WITH their table name on purpose: in a select
 * list Drizzle prints `${clinicFees.id}` as a bare "id", which inside this subquery
 * binds to clinic_invoices.id instead — every fee then read as not invoiced.
 */
const liveInvoiceOfFee = sql<number | null>`(
  select ${clinicInvoices.invoiceNo} from ${clinicInvoices}
  where ${clinicInvoices.deletedAt} is null
    and ${clinicInvoices.clinicId} = "clinic_fees"."clinic_id"
    and exists (select 1 from jsonb_array_elements(${clinicInvoices.feeLines}) e where e->>'feeId' = "clinic_fees"."id"::text)
  limit 1
)`;

/** Σ signed fee money a clinic has paid (payment +, refund −, credit 0). */
async function feeMoneyPaid(clinicId: string): Promise<number> {
  const [row] = await db
    .select({
      v: sql<number>`coalesce(sum(case
        when ${clinicPayments.kind} = ${clinicPaymentKindId("refund")} then -${clinicPayments.feeAmount}
        when ${clinicPayments.kind} = ${clinicPaymentKindId("credit")} then 0
        else ${clinicPayments.feeAmount} end), 0)::int`,
    })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.clinicId, clinicId), notDeleted(clinicPayments.deletedAt)));
  return Number(row?.v ?? 0);
}

export type ClinicFeeRow = {
  id: string;
  kind: string;
  description: string | null;
  label: string;
  amount: number;
  chargedOn: string;
  createdByName: string | null;
  /** The live invoice that bills it ("FA-INV-12"), or null while not invoiced. */
  invoiceLabel: string | null;
  paid: number;
  owed: number;
};

export type ClinicFeesSummary = {
  fees: ClinicFeeRow[];
  charged: number;
  paid: number;
  owed: number;
  /** Fee money paid beyond what the fees come to (shown, never hidden). */
  extra: number;
};

/** A clinic's fees, oldest first, each with what has been paid on it. */
export async function getClinicFees(clinicId: string): Promise<ClinicFeesSummary> {
  return unscoped("admin: clinic one-time fees", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const rows = await db
      .select({
        id: clinicFees.id,
        kind: clinicFees.kind,
        description: clinicFees.description,
        amount: clinicFees.amount,
        chargedOn: clinicFees.chargedOn,
        createdByName: clinicFees.createdByName,
        invoiceNo: liveInvoiceOfFee,
      })
      .from(clinicFees)
      .where(and(eq(clinicFees.clinicId, clinicId), notDeleted(clinicFees.deletedAt)))
      .orderBy(asc(clinicFees.chargedOn), asc(clinicFees.createdAt));
    const paidMoney = await feeMoneyPaid(clinicId);
    const alloc = allocateFeePayments(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        description: r.description,
        label: feeLineLabel(r.kind, r.description),
        amount: r.amount,
        chargedOn: r.chargedOn,
        createdByName: r.createdByName,
        invoiceLabel: r.invoiceNo === null ? null : `${invoicePrefix}${r.invoiceNo}`,
      })),
      paidMoney,
    );
    return { fees: alloc.fees, charged: alloc.charged, paid: alloc.paid, owed: alloc.owed, extra: alloc.extra };
  });
}

/** What a clinic still owes on its fees — the default fee share of a new payment. */
export async function clinicFeesOwed(clinicId: string): Promise<number> {
  return (await getClinicFees(clinicId)).owed;
}

/**
 * What is still owed on the fees of ONE invoice: its fee lines less the fee money
 * already recorded against it. The default split of a payment recorded against it.
 */
export async function invoiceFeesOwed(invoiceId: string): Promise<number> {
  return unscoped("admin: invoice fees owed", async () => {
    const [inv] = await db
      .select({ feeAmount: clinicInvoices.feeAmount })
      .from(clinicInvoices)
      .where(and(eq(clinicInvoices.id, invoiceId), notDeleted(clinicInvoices.deletedAt)))
      .limit(1);
    if (!inv || inv.feeAmount <= 0) return 0;
    const [row] = await db
      .select({
        v: sql<number>`coalesce(sum(case
          when ${clinicPayments.kind} = ${clinicPaymentKindId("refund")} then -${clinicPayments.feeAmount}
          when ${clinicPayments.kind} = ${clinicPaymentKindId("credit")} then 0
          else ${clinicPayments.feeAmount} end), 0)::int`,
      })
      .from(clinicPayments)
      .where(and(eq(clinicPayments.invoiceId, invoiceId), notDeleted(clinicPayments.deletedAt)));
    return Math.max(0, inv.feeAmount - Number(row?.v ?? 0));
  });
}

export type UninvoicedFee = { id: string; clinicId: string; kind: string; label: string; amount: number; chargedOn: string };

/** Fees not on any live invoice yet — what the Issue invoice form offers, per clinic. */
export async function listUninvoicedFees(clinicIds?: string[]): Promise<UninvoicedFee[]> {
  if (clinicIds && clinicIds.length === 0) return [];
  return unscoped("admin: uninvoiced one-time fees", async () => {
    const rows = await db
      .select({
        id: clinicFees.id,
        clinicId: clinicFees.clinicId,
        kind: clinicFees.kind,
        description: clinicFees.description,
        amount: clinicFees.amount,
        chargedOn: clinicFees.chargedOn,
      })
      .from(clinicFees)
      .where(
        and(
          notDeleted(clinicFees.deletedAt),
          clinicIds ? inArray(clinicFees.clinicId, clinicIds) : undefined,
          sql`${liveInvoiceOfFee} is null`,
        ),
      )
      .orderBy(asc(clinicFees.chargedOn), asc(clinicFees.createdAt));
    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinicId,
      kind: r.kind,
      label: feeLineLabel(r.kind, r.description),
      amount: r.amount,
      chargedOn: r.chargedOn,
    }));
  });
}

/**
 * The fee lines to put on a new invoice: the picked fees, checked to be this clinic's,
 * live and not on another live invoice. Snapshotted as they stand now.
 */
export async function feeLinesForInvoice(
  clinicId: string,
  feeIds: string[],
): Promise<{ lines: { feeId: string; kind: string; label: string; amount: number }[] } | { error: string }> {
  if (feeIds.length === 0) return { lines: [] };
  const open = await listUninvoicedFees([clinicId]);
  const byId = new Map(open.map((f) => [f.id, f]));
  const lines: { feeId: string; kind: string; label: string; amount: number }[] = [];
  for (const id of new Set(feeIds)) {
    const f = byId.get(id);
    if (!f) return { error: "A one-time fee you picked is already on another invoice, or was removed. Reload and try again." };
    lines.push({ feeId: f.id, kind: f.kind, label: f.label, amount: f.amount });
  }
  return { lines };
}

export async function addClinicFee(input: {
  clinicId: string;
  kind: FeeKind;
  description: string | null;
  amount: number;
  chargedOn: string;
  actor: { id: string; name: string };
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(clinicFees)
    .values({
      clinicId: input.clinicId,
      kind: input.kind,
      description: input.description?.trim().slice(0, 200) || null,
      amount: Math.max(0, Math.round(input.amount)),
      chargedOn: input.chargedOn,
      createdBy: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning({ id: clinicFees.id });
  return row;
}

/**
 * Removes a fee (to Trash). Refused while a live invoice bills it: the clinic may
 * already hold that invoice, so void the invoice first.
 */
export async function voidClinicFee(
  clinicId: string,
  feeId: string,
  actorId: string,
): Promise<{ ok: true; label: string; amount: number } | { error: string }> {
  return unscoped("admin: void one-time fee", async () => {
    const [fee] = await db
      .select({ id: clinicFees.id, kind: clinicFees.kind, description: clinicFees.description, amount: clinicFees.amount, invoiceNo: liveInvoiceOfFee })
      .from(clinicFees)
      .where(and(eq(clinicFees.id, feeId), eq(clinicFees.clinicId, clinicId), notDeleted(clinicFees.deletedAt)))
      .limit(1);
    if (!fee) return { error: "Fee not found." };
    if (fee.invoiceNo !== null) return { error: "This fee is on an invoice. Void the invoice first, then remove the fee." };
    await db
      .update(clinicFees)
      .set(softDeleteValues(actorId, newDeleteGroup()))
      .where(and(eq(clinicFees.id, feeId), eq(clinicFees.clinicId, clinicId)));
    return { ok: true, label: feeLineLabel(fee.kind, fee.description), amount: fee.amount };
  });
}

/**
 * Restoring a voided invoice must not bill a fee twice: refused when one of its fees
 * is now on another live invoice (or was removed).
 */
export async function invoiceFeesStillFree(invoiceId: string): Promise<boolean> {
  return unscoped("admin: invoice fee conflict", async () => {
    const [inv] = await db
      .select({ clinicId: clinicInvoices.clinicId, feeLines: clinicInvoices.feeLines })
      .from(clinicInvoices)
      .where(eq(clinicInvoices.id, invoiceId))
      .limit(1);
    if (!inv) return false;
    const ids = (Array.isArray(inv.feeLines) ? inv.feeLines : []).map((l) => l.feeId);
    if (ids.length === 0) return true;
    const free = new Set((await listUninvoicedFees([inv.clinicId])).map((f) => f.id));
    return ids.every((id) => free.has(id));
  });
}
