import "server-only";

import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import { syncClinicBillingStatus } from "@/core/admin/billing";
import { clinicInvoices, clinicPayments, cities,
  clinics, companySettings } from "@/core/db/schema";
import { clinicPaymentKindId } from "@/core/db/vocabulary-seed";
import {
  invoiceTax,
  localIsoDate,
  type InvoiceStatusFilter,
  type ProvinceTaxMap,
  splitInvoiceDiscount,
  type InvoiceDiscountInput,
} from "@/core/admin/invoice-status";
import { isProvinceCode } from "@/core/clinics/provinces";
import { z } from "zod";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Clinic subscription invoices (Owner Finance, Phase 4) — invoices FlexicaAI issues TO
 * clinics for their subscription. CORE, company control-plane. `clinic_invoices`
 * carries `clinic_id`, so cross-tenant reads run `unscoped`; the number comes from a
 * company-global counter (`company_settings`) allocated under a row lock, mirroring
 * the patient-invoice pattern one tier up. ACL + audit live in the action layer.
 */

const isoDate = localIsoDate;

/** `YYYY-MM-DD` + n days, in local calendar terms (no time-of-day drift). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

/**
 * What has been paid ON an invoice: payments and credits recorded against it, less
 * refunds recorded against it. A correlated subquery so the list can filter on it in
 * SQL (ADR-024: a paged list's figures come from the whole filtered set, never from
 * the rows of one page). Same signs as `signedBalanceAmount`.
 */
const invoicePaidSql = sql<number>`coalesce((
  select sum(case when ${clinicPayments.kind} = ${clinicPaymentKindId("refund")} then -${clinicPayments.amount} else ${clinicPayments.amount} end)
  from ${clinicPayments}
  where ${clinicPayments.invoiceId} = ${clinicInvoices.id} and ${clinicPayments.deletedAt} is null
), 0)::int`;

/** What the clinic owes on an invoice: the amount plus any tax on it (0145). */
/** The first subscription invoice number (owner, 2026-11-18): FA-INV-1001, then 1002… */
export const FIRST_SUBSCRIPTION_INVOICE_NO = 1001;

const invoiceTotalSql = sql<number>`(${clinicInvoices.amount} + ${clinicInvoices.taxAmount})`;

/** The status filter as SQL — the same rules as `invoiceStatus` (invoice-status.ts). */
function statusCondition(status: InvoiceStatusFilter, today: string): SQL {
  const owes = sql`${invoiceTotalSql} - ${invoicePaidSql} > 0`;
  switch (status) {
    case "paid":
      return sql`${invoiceTotalSql} - ${invoicePaidSql} <= 0`;
    case "unpaid":
      return owes;
    case "partly":
      return sql`${owes} and ${invoicePaidSql} > 0`;
    case "overdue":
      return sql`${owes} and ${clinicInvoices.dueOn} < ${today}`;
  }
}

export type CompanyInvoiceSettings = {
  nextInvoiceNo: number;
  invoicePrefix: string;
  /** What the "Add tax" tick starts from; each invoice keeps its own copy. */
  taxLabel: string;
  taxRate: number;
  /** Printed on the invoice when set. */
  ntn: string | null;
  strn: string | null;
  /** The tax per province; a clinic's invoice starts from its province's entry. */
  provinceTax: ProvinceTaxMap;
};

const provinceTaxSchema = z.record(
  z.string(),
  z.object({ label: z.string().max(60), rate: z.coerce.number().gt(0).max(100) }),
);

/**
 * The stored jsonb read back through zod: anything malformed, or keyed by a province
 * this app no longer knows, is dropped rather than trusted — a bad entry then falls
 * back to the company default instead of putting a wrong rate on an invoice.
 */
function parseProvinceTax(raw: unknown): ProvinceTaxMap {
  const parsed = provinceTaxSchema.safeParse(raw);
  if (!parsed.success) return {};
  const out: ProvinceTaxMap = {};
  for (const [code, t] of Object.entries(parsed.data)) if (isProvinceCode(code)) out[code] = t;
  return out;
}

/** Seed + read the singleton company settings (counter, prefix, tax defaults). */
export async function getCompanyInvoiceSettings(): Promise<CompanyInvoiceSettings> {
  let [row] = await db.select().from(companySettings).limit(1);
  if (!row) [row] = await db.insert(companySettings).values({}).returning();
  return {
    nextInvoiceNo: row.nextInvoiceNo,
    invoicePrefix: row.invoicePrefix,
    taxLabel: row.taxLabel,
    taxRate: Number(row.taxRate),
    ntn: row.ntn,
    strn: row.strn,
    provinceTax: parseProvinceTax(row.provinceTax),
  };
}

/** Saves the tax defaults and the registration numbers. Empty NTN/STRN = not printed. */
export async function setCompanyInvoiceTaxSettings(input: {
  taxLabel: string;
  taxRate: number;
  ntn: string | null;
  strn: string | null;
  provinceTax: ProvinceTaxMap;
}): Promise<void> {
  await getCompanyInvoiceSettings(); // makes sure the row exists
  await db.update(companySettings).set({
    taxLabel: input.taxLabel.trim() || "Sales tax",
    taxRate: String(input.taxRate),
    ntn: input.ntn?.trim() || null,
    strn: input.strn?.trim() || null,
    provinceTax: parseProvinceTax(input.provinceTax) as Record<string, { label: string; rate: number }>,
    updatedAt: new Date(),
  });
}

/** Tax as given on the form: null = no tax. */
export type InvoiceTaxInput = { label: string; rate: number } | null;

/** The three stored tax columns for an amount — one place, for issue and edit. */
function taxColumns(amount: number, tax: InvoiceTaxInput) {
  if (!tax || !(tax.rate > 0)) return { taxLabel: null, taxRate: null, taxAmount: 0 };
  return {
    taxLabel: tax.label.trim() || "Sales tax",
    taxRate: String(tax.rate),
    taxAmount: invoiceTax(amount, tax.rate),
  };
}

export type IssueInvoiceInput = {
  clinicId: string;
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  /** YYYY-MM-DD; null = the period start (or today) plus the clinic's grace days. */
  dueOn?: string | null;
  /** The SUBSCRIPTION part, before tax (0 for an invoice of one-time fees only). */
  amount: number;
  /**
   * One-time fees billed on this invoice (0152), already checked by the caller to be
   * this clinic's and not on another live invoice (`feeLinesForInvoice`). Added to the
   * amount; tax, when ticked, is on the whole.
   */
  feeLines?: { feeId: string; kind: string; label: string; amount: number }[];
  tax?: InvoiceTaxInput;
  /** Off the whole invoice — subscription and fees — before tax (0154). */
  discount?: InvoiceDiscountInput;
  note: string | null;
};

/**
 * The stored discount columns, and the fees' share for the credit, for a subscription
 * part and fees — one place, for issue and edit (0154 / 0155).
 */
function discountColumns(subscription: number, fees: number, discount: InvoiceDiscountInput | undefined) {
  const split = splitInvoiceDiscount(subscription, fees, discount ?? null);
  return {
    columns: {
      discountAmount: split.amount,
      discountPercent: split.amount > 0 && discount?.kind === "percent" ? String(Math.round(discount.value * 100) / 100) : null,
      discountOn: split.amount > 0 ? (discount?.on ?? "all") : "all",
    },
    feeShare: split.feeShare,
    base: split.base,
  };
}

/** Refuses a discount typed in rupees that is more than what it comes off. */
function discountTooBig(subscription: number, fees: number, discount: InvoiceDiscountInput | undefined): string | null {
  if (!discount || discount.value <= 0) return null;
  const { base } = splitInvoiceDiscount(subscription, fees, discount);
  if (base <= 0) {
    return discount.on === "fees" ? "There are no one-time fees on this invoice to discount." : "There is nothing to discount.";
  }
  if (discount.kind === "amount" && discount.value > base) {
    return discount.on === "fees"
      ? "The discount is more than the one-time fees."
      : discount.on === "subscription"
        ? "The discount is more than the subscription."
        : "The discount is more than the invoice.";
  }
  return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Keeps the CREDIT that carries an invoice's discount to the clinic's balance in step
 * with it (0154): written when there is a discount, its amount changed with it, voided
 * when the discount is taken off. The balance never reads invoices, so without this
 * the rupees forgiven on the invoice would still be owed, and the clinic would go
 * overdue for them.
 */
async function syncDiscountCredit(
  tx: Tx,
  inv: { id: string; clinicId: string; label: string },
  discountAmount: number,
  /** Of it, the one-time fees' share (`discountFeeShare`). */
  feeShare: number,
  actor: { id: string; name: string },
): Promise<void> {
  const [credit] = await tx
    .select({ id: clinicPayments.id })
    .from(clinicPayments)
    .where(and(eq(clinicPayments.discountOfInvoiceId, inv.id), notDeleted(clinicPayments.deletedAt)))
    .limit(1);
  const note = `Discount on invoice ${inv.label}`;
  if (discountAmount > 0 && credit) {
    await tx
      .update(clinicPayments)
      .set({ amount: discountAmount, feeAmount: feeShare, note, updatedAt: new Date() })
      .where(eq(clinicPayments.id, credit.id));
  } else if (discountAmount > 0) {
    await tx.insert(clinicPayments).values({
      clinicId: inv.clinicId,
      amount: discountAmount,
      feeAmount: feeShare,
      kind: "credit",
      monthsCovered: 0,
      note,
      recordedBy: actor.id,
      recordedByName: actor.name,
      discountOfInvoiceId: inv.id,
    });
  } else if (credit) {
    await tx
      .update(clinicPayments)
      .set(softDeleteValues(actor.id, newDeleteGroup()))
      .where(eq(clinicPayments.id, credit.id));
  }
}

/** A fee line as stored: bounded, whole rupees, never negative. */
function cleanFeeLines(lines: IssueInvoiceInput["feeLines"]) {
  return (lines ?? []).slice(0, 20).map((l) => ({
    feeId: l.feeId,
    kind: l.kind.slice(0, 40),
    label: l.label.slice(0, 200),
    amount: Math.max(0, Math.round(l.amount)),
  }));
}

const feeLinesSchema = z
  .array(z.object({ feeId: z.string(), kind: z.string(), label: z.string().max(200), amount: z.number().int().min(0) }))
  .max(20);

/** The stored jsonb read back through zod; anything malformed prints no fee lines. */
function parseFeeLines(raw: unknown): { label: string; amount: number }[] {
  const parsed = feeLinesSchema.safeParse(raw);
  return parsed.success ? parsed.data.map((l) => ({ label: l.label, amount: l.amount })) : [];
}

/** Issues a numbered subscription invoice; allocates the company-global number under
 *  a row lock so concurrent issues never collide. */
export async function issueClinicInvoice(
  input: IssueInvoiceInput,
  actor: { id: string; name: string },
): Promise<{ id: string; invoiceNo: number; label: string } | { error: string }> {
  return unscoped("admin: issue clinic invoice", async () => {
    const [clinic] = await db
      .select({ id: clinics.id, graceDays: clinics.graceDays })
      .from(clinics)
      .where(and(eq(clinics.id, input.clinicId), notDeleted(clinics.deletedAt)))
      .limit(1);
    if (!clinic) return { error: "Clinic not found." };
    const feeTotal = cleanFeeLines(input.feeLines).reduce((sum, l) => sum + l.amount, 0);
    const tooBig = discountTooBig(input.amount, feeTotal, input.discount);
    if (tooBig) return { error: tooBig };
    // Due when the period starts (advance billing, like the balance), plus the same
    // grace the clinic's subscription gets — so an invoice is never "overdue" on a day
    // the clinic itself is not yet late.
    const dueOn =
      input.dueOn || addDaysIso(input.periodStart ?? isoDate(new Date()), Math.max(0, clinic.graceDays ?? 0));

    return db.transaction(async (tx) => {
      // Lock the singleton settings row so number allocation serializes.
      let [cfg] = await tx.select().from(companySettings).for("update").limit(1);
      if (!cfg) [cfg] = await tx.insert(companySettings).values({}).returning();
      // Never below 1001 (owner, 2026-11-18): FA-INV-1001 is the first number.
      const allocated = Math.max(cfg.nextInvoiceNo, FIRST_SUBSCRIPTION_INVOICE_NO);
      await tx.update(companySettings).set({ nextInvoiceNo: allocated + 1, updatedAt: new Date() }).where(eq(companySettings.id, cfg.id));

      const feeLines = cleanFeeLines(input.feeLines);
      const feeAmount = feeLines.reduce((sum, l) => sum + l.amount, 0);
      const before = Math.max(0, Math.round(input.amount)) + feeAmount;
      const disc = discountColumns(input.amount, feeAmount, input.discount);
      // Stored AFTER the discount, so tax is on what the clinic actually pays.
      const amount = before - disc.columns.discountAmount;
      const [inv] = await tx
        .insert(clinicInvoices)
        .values({
          clinicId: input.clinicId,
          invoiceNo: allocated,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueOn,
          amount,
          feeLines,
          feeAmount,
          ...disc.columns,
          ...taxColumns(amount, input.tax ?? null),
          note: input.note?.slice(0, 500) || null,
          issuedBy: actor.id,
          issuedByName: actor.name,
        })
        .returning({ id: clinicInvoices.id });

      const label = `${cfg.invoicePrefix}${allocated}`;
      await syncDiscountCredit(
        tx,
        { id: inv.id, clinicId: input.clinicId, label },
        disc.columns.discountAmount,
        disc.feeShare,
        actor,
      );
      return { id: inv.id, invoiceNo: allocated, label };
    });
  }).then(async (res) => {
    // The credit may have settled the clinic's balance; its status follows (outside the
    // transaction, as `recordClinicPayment` does).
    if (!("error" in res)) await syncClinicBillingStatus(input.clinicId);
    return res;
  });
}

export type ClinicInvoiceRow = {
  id: string;
  clinicId: string;
  invoiceNo: number;
  label: string;
  clinicName: string;
  /** For "Add tax" on edit: the province's rate is where an untaxed invoice starts. */
  clinicProvince: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  /** Before tax — subscription and one-time fees together. */
  amount: number;
  /** Of `amount`, the one-time fees billed on it (0152). */
  feeAmount: number;
  /** Off the invoice before tax, already taken out of `amount` (0154). */
  discountAmount: number;
  /** As typed, when the discount was given as a percentage; else null. */
  discountPercent: number | null;
  /** What it was on: 'all' | 'subscription' | 'fees' (0155). */
  discountOn: string;
  taxLabel: string | null;
  taxRate: number | null;
  taxAmount: number;
  /** What the clinic owes: amount + tax. Status and balance are worked out on this. */
  total: number;
  /** Σ recorded against this invoice (payments + credits − refunds). */
  paid: number;
  note: string | null;
  issuedAt: Date;
  issuedByName: string | null;
  /** Last edit, if it was ever corrected after issue. */
  updatedAt: Date | null;
  updatedByName: string | null;
  deleted: boolean;
};

export type InvoiceFilters = {
  clinicId?: string;
  from?: Date;
  toExclusive?: Date;
  deleted?: boolean;
  status?: InvoiceStatusFilter;
  /** Only clinics this team member manages (an account manager's view). */
  assignedTo?: string;
  limit?: number;
  offset?: number;
};

export type InvoiceListSummary = {
  total: number;
  /** Σ what clinics were billed, tax included. */
  invoiced: number;
  /** Of which tax. */
  tax: number;
  /** Paid against the filtered invoices (refunds off, credits on). */
  received: number;
  /** How many of them are paid in full. */
  paidCount: number;
  /** Still owed across the filtered invoices. */
  outstanding: number;
  overdueCount: number;
  overdueAmount: number;
};

export async function listClinicInvoices(
  filters: InvoiceFilters,
): Promise<{ rows: ClinicInvoiceRow[]; total: number; summary: InvoiceListSummary }> {
  return unscoped("admin: list clinic invoices", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const today = isoDate(new Date());
    const parts: SQL[] = [
      filters.deleted ? sql`${clinicInvoices.deletedAt} is not null` : notDeleted(clinicInvoices.deletedAt),
    ];
    if (filters.clinicId) parts.push(eq(clinicInvoices.clinicId, filters.clinicId));
    if (filters.assignedTo) parts.push(eq(clinics.assignedTo, filters.assignedTo));
    if (filters.from) parts.push(gte(clinicInvoices.issuedAt, filters.from));
    if (filters.toExclusive) parts.push(lt(clinicInvoices.issuedAt, filters.toExclusive));
    if (filters.status) parts.push(statusCondition(filters.status, today));
    const where = and(...parts);

    const balanceSql = sql`greatest(${invoiceTotalSql} - ${invoicePaidSql}, 0)`;
    const overdueSql = sql`(${invoiceTotalSql} - ${invoicePaidSql} > 0 and ${clinicInvoices.dueOn} < ${today})`;

    const [rows, [agg]] = await Promise.all([
      db
        .select({
          id: clinicInvoices.id,
          clinicId: clinicInvoices.clinicId,
          invoiceNo: clinicInvoices.invoiceNo,
          clinicName: clinics.name,
          clinicProvince: clinics.province,
          periodStart: clinicInvoices.periodStart,
          periodEnd: clinicInvoices.periodEnd,
          dueOn: clinicInvoices.dueOn,
          amount: clinicInvoices.amount,
          feeAmount: clinicInvoices.feeAmount,
          discountAmount: clinicInvoices.discountAmount,
          discountPercent: clinicInvoices.discountPercent,
          discountOn: clinicInvoices.discountOn,
          taxLabel: clinicInvoices.taxLabel,
          taxRate: clinicInvoices.taxRate,
          taxAmount: clinicInvoices.taxAmount,
          paid: invoicePaidSql,
          note: clinicInvoices.note,
          issuedAt: clinicInvoices.issuedAt,
          issuedByName: clinicInvoices.issuedByName,
          updatedAt: clinicInvoices.updatedAt,
          updatedByName: clinicInvoices.updatedByName,
          deletedAt: clinicInvoices.deletedAt,
        })
        .from(clinicInvoices)
        .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
        .where(where)
        .orderBy(desc(clinicInvoices.invoiceNo))
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0),
      // The summary is aggregated over the WHOLE filtered set, not folded from one page.
      db
        .select({
          total: sql<number>`count(*)::int`,
          invoiced: sql<number>`coalesce(sum(${invoiceTotalSql}), 0)::int`,
          tax: sql<number>`coalesce(sum(${clinicInvoices.taxAmount}), 0)::int`,
          received: sql<number>`coalesce(sum(${invoicePaidSql}), 0)::int`,
          paidCount: sql<number>`(count(*) filter (where ${invoiceTotalSql} > 0 and ${balanceSql} <= 0))::int`,
          outstanding: sql<number>`coalesce(sum(${balanceSql}), 0)::int`,
          overdueCount: sql<number>`(count(*) filter (where ${overdueSql}))::int`,
          overdueAmount: sql<number>`coalesce(sum(${balanceSql}) filter (where ${overdueSql}), 0)::int`,
        })
        .from(clinicInvoices)
        .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
        .where(where),
    ]);
    const summary: InvoiceListSummary = {
      total: Number(agg?.total ?? 0),
      invoiced: Number(agg?.invoiced ?? 0),
      tax: Number(agg?.tax ?? 0),
      received: Number(agg?.received ?? 0),
      paidCount: Number(agg?.paidCount ?? 0),
      outstanding: Number(agg?.outstanding ?? 0),
      overdueCount: Number(agg?.overdueCount ?? 0),
      overdueAmount: Number(agg?.overdueAmount ?? 0),
    };
    return {
      rows: rows.map(({ deletedAt, ...r }) => ({
        ...r,
        taxRate: r.taxRate === null ? null : Number(r.taxRate),
        discountPercent: r.discountPercent === null ? null : Number(r.discountPercent),
        total: r.amount + r.taxAmount,
        paid: Number(r.paid),
        label: `${invoicePrefix}${r.invoiceNo}`,
        deleted: deletedAt !== null,
      })),
      total: summary.total,
      summary,
    };
  });
}

/**
 * One clinic's live invoices with what is paid on each — the clinic page's billing
 * card, where a payment is recorded against one or an older payment linked to one.
 * Oldest first: the order they fall due in.
 */
export async function listInvoicesForClinic(clinicId: string): Promise<ClinicInvoiceRow[]> {
  const { rows } = await listClinicInvoices({ clinicId, limit: 200 });
  return rows.sort((a, b) => a.invoiceNo - b.invoiceNo);
}

/**
 * Ties a recorded payment to one of the SAME clinic's live invoices, or unties it
 * (`invoiceId` null). Only which invoice it settles changes — never the amount, so the
 * clinic's balance is untouched. Refuses a cross-clinic pair outright.
 */
export async function setPaymentInvoice(
  clinicId: string,
  paymentId: string,
  invoiceId: string | null,
): Promise<{ ok: true } | { error: string }> {
  return unscoped("admin: link clinic payment to invoice", async () => {
    if (invoiceId && !(await isLiveInvoiceOfClinic(invoiceId, clinicId))) {
      return { error: "That invoice is not one of this clinic's." };
    }
    const res = await db
      .update(clinicPayments)
      .set({ invoiceId, updatedAt: new Date() })
      .where(
        and(
          eq(clinicPayments.id, paymentId),
          eq(clinicPayments.clinicId, clinicId),
          notDeleted(clinicPayments.deletedAt),
          // An invoice's discount credit (0154) is already counted off that invoice;
          // linking it as a payment would count it twice.
          isNull(clinicPayments.discountOfInvoiceId),
        ),
      )
      .returning({ id: clinicPayments.id });
    return res.length > 0 ? { ok: true } : { error: "Payment not found." };
  });
}

/** Does this invoice belong to this clinic and still stand? (Recording a payment.) */
export async function isLiveInvoiceOfClinic(invoiceId: string, clinicId: string): Promise<boolean> {
  return unscoped("admin: check clinic invoice", async () => {
    const [row] = await db
      .select({ id: clinicInvoices.id })
      .from(clinicInvoices)
      .where(and(eq(clinicInvoices.id, invoiceId), eq(clinicInvoices.clinicId, clinicId), isNull(clinicInvoices.deletedAt)))
      .limit(1);
    return Boolean(row);
  });
}

/** Σ invoiced (live) in a range — the KPI. Tax included, with the tax share beside it. */
export async function invoicedTotal(
  from: Date,
  toExclusive: Date,
  scope: { assignedTo?: string } = {},
): Promise<{ total: number; tax: number }> {
  return unscoped("admin: invoiced total", async () => {
    const [row] = await db
      .select({
        t: sql<number>`coalesce(sum(${invoiceTotalSql}), 0)::int`,
        tax: sql<number>`coalesce(sum(${clinicInvoices.taxAmount}), 0)::int`,
      })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      .where(
        and(
          notDeleted(clinicInvoices.deletedAt),
          gte(clinicInvoices.issuedAt, from),
          lt(clinicInvoices.issuedAt, toExclusive),
          scope.assignedTo ? eq(clinics.assignedTo, scope.assignedTo) : undefined,
        ),
      );
    return { total: Number(row?.t ?? 0), tax: Number(row?.tax ?? 0) };
  });
}

/**
 * Which clinic an invoice is for, and who manages it — so an action can refuse an
 * account manager acting on a clinic that is not theirs. Includes voided invoices
 * (restoring one is an action too).
 */
export async function getInvoiceClinic(
  id: string,
): Promise<{ clinicId: string; assignedTo: string | null } | null> {
  return unscoped("admin: invoice clinic", async () => {
    const [row] = await db
      .select({ clinicId: clinicInvoices.clinicId, assignedTo: clinics.assignedTo })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      .where(eq(clinicInvoices.id, id))
      .limit(1);
    return row ?? null;
  });
}

/** Per-bucket invoiced total over a resolved range — the trend chart. */
export async function invoicedTrend(
  range: ResolvedRange,
  scope: { assignedTo?: string } = {},
): Promise<{ label: string; total: number }[]> {
  const { start, end, granularity } = range;
  return unscoped("admin: invoiced trend", async () => {
    const rows = await db
      .select({ issuedAt: clinicInvoices.issuedAt, amount: invoiceTotalSql })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      .where(
        and(
          notDeleted(clinicInvoices.deletedAt),
          gte(clinicInvoices.issuedAt, start),
          lt(clinicInvoices.issuedAt, end),
          scope.assignedTo ? eq(clinics.assignedTo, scope.assignedTo) : undefined,
        ),
      );
    const buckets: { label: string; total: number }[] = [];
    const index = new Map<number, number>();
    for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
      index.set(cur.getTime(), buckets.length);
      buckets.push({ label: bucketLabel(cur, granularity), total: 0 });
    }
    for (const r of rows) {
      const idx = index.get(startOfBucket(r.issuedAt, granularity).getTime());
      if (idx !== undefined) buckets[idx].total += Number(r.amount);
    }
    return buckets;
  });
}

export type EditInvoiceInput = {
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  /** YYYY-MM-DD; null = worked out again, as at issue. */
  dueOn: string | null;
  /**
   * The SUBSCRIPTION part, before tax. One-time fees billed on the invoice are kept as
   * issued and added back (to change them, void the invoice and issue it again).
   */
  amount: number;
  tax: InvoiceTaxInput;
  /** Off the whole invoice before tax (0154). Null or absent = none. */
  discount?: InvoiceDiscountInput;
  note: string | null;
};

type InvoiceFields = {
  amount: number;
  /** In rupees — what the invoice prints. */
  discountAmount: number;
  /** "Sales tax 16%", or null for none — one comparable value for the audit line. */
  tax: string | null;
  taxAmount: number;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  note: string | null;
};

const taxText = (label: string | null, rate: string | number | null) =>
  label && rate !== null && Number(rate) > 0 ? `${label} ${Number(Number(rate).toFixed(2))}%` : null;

/**
 * Corrects an issued invoice — amount, period, due date, note (owner's call,
 * 2026-11-11). Never its clinic or its number: payments are recorded against it, and
 * the number is a printed reference the clinic may already be quoting. A voided
 * invoice is not edited (restore it first). Payments already linked stay linked; if
 * the amount drops below what was paid, the invoice shows as paid with the excess.
 *
 * Returns the values before and after, so the caller's audit line can say what
 * changed.
 */
export async function updateClinicInvoice(
  id: string,
  input: EditInvoiceInput,
  actor: { id: string; name: string },
): Promise<{ error: string } | { ok: true; label: string; clinicId: string; before: InvoiceFields; after: InvoiceFields }> {
  return unscoped("admin: edit clinic invoice", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const [cur] = await db
      .select({
        invoiceNo: clinicInvoices.invoiceNo,
        clinicId: clinicInvoices.clinicId,
        amount: clinicInvoices.amount,
        feeAmount: clinicInvoices.feeAmount,
        discountAmount: clinicInvoices.discountAmount,
        taxLabel: clinicInvoices.taxLabel,
        taxRate: clinicInvoices.taxRate,
        taxAmount: clinicInvoices.taxAmount,
        periodStart: clinicInvoices.periodStart,
        periodEnd: clinicInvoices.periodEnd,
        dueOn: clinicInvoices.dueOn,
        note: clinicInvoices.note,
        graceDays: clinics.graceDays,
      })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      .where(and(eq(clinicInvoices.id, id), notDeleted(clinicInvoices.deletedAt)))
      .limit(1);
    if (!cur) return { error: "Invoice not found, or it was voided. Restore it to edit it." };

    const preTax = Math.max(0, Math.round(input.amount)) + cur.feeAmount;
    const tooBig = discountTooBig(input.amount, cur.feeAmount, input.discount);
    if (tooBig) return { error: tooBig };
    const disc = discountColumns(input.amount, cur.feeAmount, input.discount);
    const amount = preTax - disc.columns.discountAmount;
    const taxCols = taxColumns(amount, input.tax);
    const label = `${invoicePrefix}${cur.invoiceNo}`;
    const after: InvoiceFields = {
      amount,
      discountAmount: disc.columns.discountAmount,
      tax: taxText(taxCols.taxLabel, taxCols.taxRate),
      taxAmount: taxCols.taxAmount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueOn:
        input.dueOn ||
        addDaysIso(input.periodStart ?? isoDate(new Date()), Math.max(0, cur.graceDays ?? 0)),
      note: input.note?.trim() || null,
    };
    await db.transaction(async (tx) => {
      await tx
        .update(clinicInvoices)
        .set({
          amount: after.amount,
          ...disc.columns,
          ...taxCols,
          periodStart: after.periodStart,
          periodEnd: after.periodEnd,
          dueOn: after.dueOn,
          note: after.note,
          updatedAt: new Date(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        })
        .where(eq(clinicInvoices.id, id));
      await syncDiscountCredit(
        tx,
        { id, clinicId: cur.clinicId, label },
        disc.columns.discountAmount,
        disc.feeShare,
        actor,
      );
    });
    if (disc.columns.discountAmount !== cur.discountAmount) await syncClinicBillingStatus(cur.clinicId);
    const before: InvoiceFields = {
      amount: cur.amount,
      discountAmount: cur.discountAmount,
      tax: taxText(cur.taxLabel, cur.taxRate),
      taxAmount: cur.taxAmount,
      periodStart: cur.periodStart,
      periodEnd: cur.periodEnd,
      dueOn: cur.dueOn,
      note: cur.note,
    };
    return { ok: true, label, clinicId: cur.clinicId, before, after };
  });
}

/**
 * Voids an invoice — and, under the same delete group, the credit its discount wrote
 * (0154): a discount on an invoice that no longer exists is not owed to the clinic.
 */
export async function voidClinicInvoice(id: string, actorId: string): Promise<boolean> {
  return unscoped("admin: void clinic invoice", async () => {
    const group = newDeleteGroup();
    const res = await db.transaction(async (tx) => {
      const rows = await tx
        .update(clinicInvoices)
        .set(softDeleteValues(actorId, group))
        .where(and(notDeleted(clinicInvoices.deletedAt), eq(clinicInvoices.id, id)))
        .returning({ id: clinicInvoices.id, clinicId: clinicInvoices.clinicId });
      if (rows.length === 0) return null;
      const credits = await tx
        .update(clinicPayments)
        .set({ ...softDeleteValues(actorId, group), deletedByCascade: true })
        .where(and(eq(clinicPayments.discountOfInvoiceId, id), notDeleted(clinicPayments.deletedAt)))
        .returning({ id: clinicPayments.id });
      return { clinicId: rows[0].clinicId, credit: credits.length > 0 };
    });
    if (res?.credit) await syncClinicBillingStatus(res.clinicId);
    return res !== null;
  });
}

/** Restores a voided invoice, and the discount credit that was voided WITH it. */
export async function restoreClinicInvoice(id: string): Promise<boolean> {
  return unscoped("admin: restore clinic invoice", async () => {
    const res = await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ group: clinicInvoices.deleteGroup })
        .from(clinicInvoices)
        .where(eq(clinicInvoices.id, id))
        .limit(1);
      const rows = await tx
        .update(clinicInvoices)
        .set(restoreValues())
        .where(eq(clinicInvoices.id, id))
        .returning({ id: clinicInvoices.id, clinicId: clinicInvoices.clinicId });
      if (rows.length === 0) return null;
      // Only the credit voided in the same act: one an edit took off stays off.
      const credits = cur?.group
        ? await tx
            .update(clinicPayments)
            .set(restoreValues())
            .where(and(eq(clinicPayments.discountOfInvoiceId, id), eq(clinicPayments.deleteGroup, cur.group)))
            .returning({ id: clinicPayments.id })
        : [];
      return { clinicId: rows[0].clinicId, credit: credits.length > 0 };
    });
    if (res?.credit) await syncClinicBillingStatus(res.clinicId);
    return res !== null;
  });
}

export type ClinicInvoicePrint = {
  label: string;
  invoiceNo: number;
  /** Before tax. */
  amount: number;
  taxLabel: string | null;
  taxRate: number | null;
  taxAmount: number;
  /** amount + tax — what the clinic owes. */
  total: number;
  paid: number;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  note: string | null;
  issuedAt: Date;
  issuedByName: string | null;
  /** One-time fees billed on it (0152), as invoiced; included in `amount`. */
  feeLines: { label: string; amount: number }[];
  /** The subscription line BEFORE the discount: `amount − fees + discount`. */
  subscriptionAmount: number;
  /** Off the invoice before tax, in rupees (0154) — printed as a line of its own. */
  discountAmount: number;
  /** What it was on (0155) — names the line ("Discount on one-time fees"). */
  discountOn: string;
  /** Money recorded against this invoice, oldest first — printed as "Payments received". */
  payments: { occurredAt: Date; amount: number; kind: string; method: string | null; reference: string | null }[];
  clinic: {
    name: string; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
    city: string | null; country: string | null; address: string | null;
    /** For the account-manager scope check on the print route. */
    assignedTo: string | null;
  };
};

/** One invoice + its clinic (bill-to) for the printable receipt. */
export async function getClinicInvoiceForPrint(id: string): Promise<ClinicInvoicePrint | null> {
  return unscoped("admin: clinic invoice print", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const [row] = await db
      .select({
        id: clinicInvoices.id,
        invoiceNo: clinicInvoices.invoiceNo,
        amount: clinicInvoices.amount,
        feeLines: clinicInvoices.feeLines,
        feeAmount: clinicInvoices.feeAmount,
        discountAmount: clinicInvoices.discountAmount,
        discountOn: clinicInvoices.discountOn,
        taxLabel: clinicInvoices.taxLabel,
        taxRate: clinicInvoices.taxRate,
        taxAmount: clinicInvoices.taxAmount,
        paid: invoicePaidSql,
        periodStart: clinicInvoices.periodStart,
        periodEnd: clinicInvoices.periodEnd,
        dueOn: clinicInvoices.dueOn,
        note: clinicInvoices.note,
        issuedAt: clinicInvoices.issuedAt,
        issuedByName: clinicInvoices.issuedByName,
        name: clinics.name,
        ownerName: clinics.ownerName,
        ownerEmail: clinics.ownerEmail,
        ownerPhone: clinics.ownerPhone,
        city: cities.name,
        country: clinics.country,
        address: clinics.address,
        assignedTo: clinics.assignedTo,
      })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      // LEFT: a clinic with no city recorded still gets an invoice; the bill-to line
      // simply omits the city, as it did when the column was free text and empty.
      .leftJoin(cities, eq(cities.id, clinics.cityId))
      .where(and(notDeleted(clinicInvoices.deletedAt), eq(clinicInvoices.id, id)))
      .limit(1);
    if (!row) return null;
    const payments = await db
      .select({
        occurredAt: clinicPayments.occurredAt,
        amount: clinicPayments.amount,
        kind: clinicPayments.kind,
        method: clinicPayments.method,
        reference: clinicPayments.reference,
      })
      .from(clinicPayments)
      .where(and(eq(clinicPayments.invoiceId, row.id), notDeleted(clinicPayments.deletedAt)))
      .orderBy(asc(clinicPayments.occurredAt));
    return {
      label: `${invoicePrefix}${row.invoiceNo}`,
      invoiceNo: row.invoiceNo,
      amount: row.amount,
      taxLabel: row.taxLabel,
      taxRate: row.taxRate === null ? null : Number(row.taxRate),
      taxAmount: row.taxAmount,
      total: row.amount + row.taxAmount,
      paid: Number(row.paid),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      dueOn: row.dueOn,
      feeLines: parseFeeLines(row.feeLines),
      subscriptionAmount: Math.max(0, row.amount - row.feeAmount + row.discountAmount),
      discountAmount: row.discountAmount,
      discountOn: row.discountOn,
      payments,
      note: row.note,
      issuedAt: row.issuedAt,
      issuedByName: row.issuedByName,
      clinic: {
        name: row.name,
        ownerName: row.ownerName,
        ownerEmail: row.ownerEmail,
        ownerPhone: row.ownerPhone,
        city: row.city,
        country: row.country,
        address: row.address,
        assignedTo: row.assignedTo,
      },
    };
  });
}

/** ISO helper re-exported for the action layer's period defaults. */
export { isoDate };
