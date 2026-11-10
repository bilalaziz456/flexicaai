import "server-only";

import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import { clinicInvoices, clinicPayments, cities,
  clinics, companySettings } from "@/core/db/schema";
import { clinicPaymentKindId } from "@/core/db/vocabulary-seed";
import { invoiceTax, localIsoDate, type InvoiceStatusFilter } from "@/core/admin/invoice-status";
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
};

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
  };
}

/** Saves the tax defaults and the registration numbers. Empty NTN/STRN = not printed. */
export async function setCompanyInvoiceTaxSettings(input: {
  taxLabel: string;
  taxRate: number;
  ntn: string | null;
  strn: string | null;
}): Promise<void> {
  await getCompanyInvoiceSettings(); // makes sure the row exists
  await db.update(companySettings).set({
    taxLabel: input.taxLabel.trim() || "Sales tax",
    taxRate: String(input.taxRate),
    ntn: input.ntn?.trim() || null,
    strn: input.strn?.trim() || null,
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
  /** Before tax. */
  amount: number;
  tax?: InvoiceTaxInput;
  note: string | null;
};

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
    // Due when the period starts (advance billing, like the balance), plus the same
    // grace the clinic's subscription gets — so an invoice is never "overdue" on a day
    // the clinic itself is not yet late.
    const dueOn =
      input.dueOn || addDaysIso(input.periodStart ?? isoDate(new Date()), Math.max(0, clinic.graceDays ?? 0));

    return db.transaction(async (tx) => {
      // Lock the singleton settings row so number allocation serializes.
      let [cfg] = await tx.select().from(companySettings).for("update").limit(1);
      if (!cfg) [cfg] = await tx.insert(companySettings).values({}).returning();
      const allocated = cfg.nextInvoiceNo;
      await tx.update(companySettings).set({ nextInvoiceNo: allocated + 1, updatedAt: new Date() }).where(eq(companySettings.id, cfg.id));

      const [inv] = await tx
        .insert(clinicInvoices)
        .values({
          clinicId: input.clinicId,
          invoiceNo: allocated,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueOn,
          amount: Math.max(0, Math.round(input.amount)),
          ...taxColumns(Math.max(0, Math.round(input.amount)), input.tax ?? null),
          note: input.note?.slice(0, 500) || null,
          issuedBy: actor.id,
          issuedByName: actor.name,
        })
        .returning({ id: clinicInvoices.id });

      return { id: inv.id, invoiceNo: allocated, label: `${cfg.invoicePrefix}${allocated}` };
    });
  });
}

export type ClinicInvoiceRow = {
  id: string;
  clinicId: string;
  invoiceNo: number;
  label: string;
  clinicName: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  /** Before tax. */
  amount: number;
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
          periodStart: clinicInvoices.periodStart,
          periodEnd: clinicInvoices.periodEnd,
          dueOn: clinicInvoices.dueOn,
          amount: clinicInvoices.amount,
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
      outstanding: Number(agg?.outstanding ?? 0),
      overdueCount: Number(agg?.overdueCount ?? 0),
      overdueAmount: Number(agg?.overdueAmount ?? 0),
    };
    return {
      rows: rows.map(({ deletedAt, ...r }) => ({
        ...r,
        taxRate: r.taxRate === null ? null : Number(r.taxRate),
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
      .where(and(eq(clinicPayments.id, paymentId), eq(clinicPayments.clinicId, clinicId), notDeleted(clinicPayments.deletedAt)))
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
  /** Before tax. */
  amount: number;
  tax: InvoiceTaxInput;
  note: string | null;
};

type InvoiceFields = {
  amount: number;
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

    const amount = Math.max(0, Math.round(input.amount));
    const taxCols = taxColumns(amount, input.tax);
    const after: InvoiceFields = {
      amount,
      tax: taxText(taxCols.taxLabel, taxCols.taxRate),
      taxAmount: taxCols.taxAmount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueOn:
        input.dueOn ||
        addDaysIso(input.periodStart ?? isoDate(new Date()), Math.max(0, cur.graceDays ?? 0)),
      note: input.note?.trim() || null,
    };
    await db
      .update(clinicInvoices)
      .set({
        amount: after.amount,
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
    const before: InvoiceFields = {
      amount: cur.amount,
      tax: taxText(cur.taxLabel, cur.taxRate),
      taxAmount: cur.taxAmount,
      periodStart: cur.periodStart,
      periodEnd: cur.periodEnd,
      dueOn: cur.dueOn,
      note: cur.note,
    };
    return { ok: true, label: `${invoicePrefix}${cur.invoiceNo}`, clinicId: cur.clinicId, before, after };
  });
}

export async function voidClinicInvoice(id: string, actorId: string): Promise<boolean> {
  return unscoped("admin: void clinic invoice", async () => {
    const res = await db
      .update(clinicInvoices)
      .set(softDeleteValues(actorId, newDeleteGroup()))
      .where(and(notDeleted(clinicInvoices.deletedAt), eq(clinicInvoices.id, id)))
      .returning({ id: clinicInvoices.id });
    return res.length > 0;
  });
}

export async function restoreClinicInvoice(id: string): Promise<boolean> {
  return unscoped("admin: restore clinic invoice", async () => {
    const res = await db
      .update(clinicInvoices)
      .set(restoreValues())
      .where(eq(clinicInvoices.id, id))
      .returning({ id: clinicInvoices.id });
    return res.length > 0;
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
