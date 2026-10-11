import "server-only";

import { parseDocNumber } from "@/core/billing/doc-number";
import { and, desc, eq, gte, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { patientSearchSql } from "@/core/patients/search-sql";
import { appointments, clinics, invoices, patientPayments, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import { formatInvoiceNo, formatReceiptNo } from "@/core/billing/invoice";
import { paymentKindId } from "@/core/db/vocabulary-seed";
import { asPaymentKindCode, asPaymentMethodCode } from "@/core/db/vocabulary-seed";

/** Clinic prefixes needed to reconstruct the searchable RCP #, INV # and MRN #. */
type SearchPrefixes = { receiptPrefix: string; invoicePrefix: string; mrnPrefix: string };
async function getSearchPrefixes(clinicId: string): Promise<SearchPrefixes> {
  const [c] = await db
    .select({ receiptPrefix: clinics.receiptPrefix, invoicePrefix: clinics.invoicePrefix, mrnPrefix: clinics.mrnPrefix })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return { receiptPrefix: c?.receiptPrefix ?? "", invoicePrefix: c?.invoicePrefix ?? "", mrnPrefix: c?.mrnPrefix ?? "" };
}

/**
 * Payments ledger (Finance) — CORE read of the money-in/out subledger across the
 * whole clinic, for the standalone `/clinic/payments` report + its CSV. One row per
 * live `patient_payments` entry, joined to the patient and (via the appointment) the
 * doctor, filterable by date/patient/method/kind/doctor. Clinic-scoped; the per-visit
 * void/refund UI stays on the appointment detail — this is a read-only register.
 */

export type PaymentLedgerRow = {
  id: string;
  kind: string;
  amount: number; // positive; refund is money out
  method: string | null;
  reference: string | null;
  note: string | null;
  occurredAt: Date;
  createdByName: string | null;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentId: string | null;
  doctorName: string | null;
  receiptLabel: string | null; // the RCP # of the payment's visit (null for unallocated advances)
  /** The INV # of the payment's visit — every payment is shown against its invoice.
   *  Null for an unallocated advance, or a visit with no invoice yet. */
  invoiceLabel: string | null;
  invoiceVoided: boolean;
};

export type PaymentLedgerFilters = {
  from?: Date;
  toExclusive?: Date;
  q?: string; // patient name / phone search
  method?: string;
  kind?: string;
  doctorId?: string;
  limit?: number;
  offset?: number;
};

export type PaymentLedger = {
  rows: PaymentLedgerRow[];
  total: number; // matching row count (for pagination)
  totals: { in: number; out: number; net: number };
};

/** `refund` is money OUT; everything else is money in. Kept in sync with daybook. */
const OUT_KINDS = new Set(["refund"]);

function conds(clinicId: string, f: PaymentLedgerFilters, px: SearchPrefixes, extra?: SQL) {
  const parts = [notDeleted(patientPayments.deletedAt)];
  if (f.from) parts.push(gte(patientPayments.occurredAt, f.from));
  if (f.toExclusive) parts.push(lt(patientPayments.occurredAt, f.toExclusive));
  // Narrowed, not cast: a filter for a value that does not exist should drop the
  // condition rather than be sent to the database.
  const method = asPaymentMethodCode(f.method);
  if (method) parts.push(eq(patientPayments.method, method));
  const kind = asPaymentKindCode(f.kind);
  if (kind) parts.push(eq(patientPayments.kind, kind));
  if (f.doctorId) parts.push(eq(appointments.doctorId, f.doctorId));
  if (f.q) {
    parts.push(
      or(
        // Who the patient is — name, phone, the clinic's own ref, MRN — shared with
        // receivables and the invoice register, so one search cannot find a patient
        // on one screen and miss them on another (`core/patients/search-sql.ts`).
        patientSearchSql(f.q, px.mrnPrefix, { mrn: !parseDocNumber(f.q) }),
        // What this SCREEN owns: the RCP number on the payment's visit and the
        // INVOICE number it is held against — both matched EXACTLY (`doc-number.ts`),
        // so "0000002" finds number 2 and not 20–29, 120… A term naming one series
        // ("RCP…" / "INV…") searches only that one.
        ...docNumberConds(f.q, px),
      )!,
    );
  }
  if (extra) parts.push(extra);
  return byClinic(patientPayments.clinicId, clinicId, and(...parts));
}

function docNumberConds(q: string, px: SearchPrefixes): SQL[] {
  const doc = parseDocNumber(q);
  if (!doc) return [];
  const upper = q.toUpperCase();
  const namedInv = Boolean(px.invoicePrefix) && upper.includes(px.invoicePrefix.toUpperCase());
  const namedRcp = Boolean(px.receiptPrefix) && upper.includes(px.receiptPrefix.toUpperCase());
  const out: SQL[] = [];
  if (!namedInv || namedRcp) {
    out.push(and(eq(appointments.receiptNo, doc.no), doc.year ? eq(appointments.receiptYear, doc.year) : undefined)!);
  }
  if (!namedRcp || namedInv) {
    out.push(and(eq(invoices.invoiceNo, doc.no), doc.year ? eq(invoices.invoiceYear, doc.year) : undefined)!);
  }
  return out;
}

export async function getPaymentsLedger(
  clinicId: string,
  filters: PaymentLedgerFilters = {},
): Promise<PaymentLedger> {
  // Always needed now (the RCP # is shown on every row), and reused for search.
  const px = await getSearchPrefixes(clinicId);
  const where = conds(clinicId, filters, px);

  const [rows, [{ total }], [sums]] = await Promise.all([
    db
      .select({
        id: patientPayments.id,
        kind: patientPayments.kind,
        amount: patientPayments.amount,
        method: patientPayments.method,
        reference: patientPayments.reference,
        note: patientPayments.note,
        occurredAt: patientPayments.occurredAt,
        createdByName: patientPayments.createdByName,
        patientId: patients.id,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        appointmentId: patientPayments.appointmentId,
        receiptNo: appointments.receiptNo,
        receiptYear: appointments.receiptYear,
        invoiceNo: invoices.invoiceNo,
        invoiceYear: invoices.invoiceYear,
        invoiceIssuedAt: invoices.issuedAt,
        invoiceVoidedAt: invoices.voidedAt,
        doctorPrefix: users.prefix,
        doctorFullName: users.fullName,
        doctorUsername: users.username,
      })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      // The visit's LIVE invoice — at most one (partial unique), so no row doubles.
      .leftJoin(invoices, and(eq(invoices.appointmentId, appointments.id), isNull(invoices.deletedAt)))
      .leftJoin(users, eq(users.id, appointments.doctorId))
      .where(where)
      .orderBy(desc(patientPayments.occurredAt))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      // The visit's LIVE invoice — at most one (partial unique), so no row doubles.
      .leftJoin(invoices, and(eq(invoices.appointmentId, appointments.id), isNull(invoices.deletedAt)))
      .where(where),
    // Money in = payment + advance + advance_applied; out = refund. Net = in − out.
    db
      .select({
        moneyIn: sql<number>`coalesce(sum(case when ${patientPayments.kind} = ${paymentKindId("refund")} then 0 else ${patientPayments.amount} end), 0)::int`,
        moneyOut: sql<number>`coalesce(sum(case when ${patientPayments.kind} = ${paymentKindId("refund")} then ${patientPayments.amount} else 0 end), 0)::int`,
      })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      // The visit's LIVE invoice — at most one (partial unique), so no row doubles.
      .leftJoin(invoices, and(eq(invoices.appointmentId, appointments.id), isNull(invoices.deletedAt)))
      .where(where),
  ]);

  const moneyIn = Number(sums?.moneyIn ?? 0);
  const moneyOut = Number(sums?.moneyOut ?? 0);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      note: r.note,
      occurredAt: r.occurredAt,
      createdByName: r.createdByName,
      patientId: r.patientId,
      patientName: r.patientName,
      patientPhone: r.patientPhone,
      appointmentId: r.appointmentId,
      doctorName:
        r.doctorFullName || r.doctorUsername
          ? displayStaffName(r.doctorPrefix, r.doctorFullName, r.doctorUsername ?? "")
          : null,
      receiptLabel:
        r.receiptNo != null
          ? formatReceiptNo(px.receiptPrefix, r.receiptYear ?? r.occurredAt.getFullYear(), r.receiptNo)
          : null,
      ...invoiceOf(r, px),
    })),
    total: Number(total),
    totals: { in: moneyIn, out: moneyOut, net: moneyIn - moneyOut },
  };
}

/**
 * Streaming variant of `getPaymentsLedger` — yields the same rows (newest first) but
 * pages with a KEYSET cursor (`(occurred_at, id)` descending), one bounded batch at a
 * time, so a huge export never buffers the whole ledger. Used by the streaming CSV
 * export. Clinic-scoped; honours every list filter.
 */
export async function* iteratePaymentsLedger(
  clinicId: string,
  filters: PaymentLedgerFilters = {},
  batchSize = 5000,
): AsyncGenerator<PaymentLedgerRow> {
  const px = await getSearchPrefixes(clinicId);
  // Kept as its own function so its (concrete) result type doesn't depend on the
  // loop's cursor — otherwise the batch/cursor types infer circularly.
  const page = (keyset: SQL | undefined) =>
    db
      .select({
        id: patientPayments.id,
        kind: patientPayments.kind,
        amount: patientPayments.amount,
        method: patientPayments.method,
        reference: patientPayments.reference,
        note: patientPayments.note,
        occurredAt: patientPayments.occurredAt,
        // Full-precision timestamp text for the cursor (see the sales iterator): a JS
        // Date truncates to milliseconds, which would skip same-millisecond rows.
        cursorTs: sql<string>`${patientPayments.occurredAt}::text`,
        createdByName: patientPayments.createdByName,
        patientId: patients.id,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        appointmentId: patientPayments.appointmentId,
        receiptNo: appointments.receiptNo,
        receiptYear: appointments.receiptYear,
        invoiceNo: invoices.invoiceNo,
        invoiceYear: invoices.invoiceYear,
        invoiceIssuedAt: invoices.issuedAt,
        invoiceVoidedAt: invoices.voidedAt,
        doctorPrefix: users.prefix,
        doctorFullName: users.fullName,
        doctorUsername: users.username,
      })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      // The visit's LIVE invoice — at most one (partial unique), so no row doubles.
      .leftJoin(invoices, and(eq(invoices.appointmentId, appointments.id), isNull(invoices.deletedAt)))
      .leftJoin(users, eq(users.id, appointments.doctorId))
      .where(conds(clinicId, filters, px, keyset))
      .orderBy(desc(patientPayments.occurredAt), desc(patientPayments.id))
      .limit(batchSize);

  let cursor: { ts: string; id: string } | null = null;
  for (;;) {
    const keyset: SQL | undefined = cursor
      ? sql`(${patientPayments.occurredAt} < ${cursor.ts}::timestamptz or (${patientPayments.occurredAt} = ${cursor.ts}::timestamptz and ${patientPayments.id} < ${cursor.id}::uuid))`
      : undefined;

    const batch = await page(keyset);

    for (const r of batch) {
      yield {
        id: r.id,
        kind: r.kind,
        amount: r.amount,
        method: r.method,
        reference: r.reference,
        note: r.note,
        occurredAt: r.occurredAt,
        createdByName: r.createdByName,
        patientId: r.patientId,
        patientName: r.patientName,
        patientPhone: r.patientPhone,
        appointmentId: r.appointmentId,
        doctorName:
          r.doctorFullName || r.doctorUsername
            ? displayStaffName(r.doctorPrefix, r.doctorFullName, r.doctorUsername ?? "")
            : null,
        receiptLabel:
          r.receiptNo != null
            ? formatReceiptNo(px.receiptPrefix, r.receiptYear ?? r.occurredAt.getFullYear(), r.receiptNo)
            : null,
        ...invoiceOf(r, px),
      };
    }
    if (batch.length < batchSize) break;
    const lastRow = batch[batch.length - 1];
    cursor = { ts: lastRow.cursorTs, id: lastRow.id };
  }
}

function invoiceOf(
  r: { invoiceNo: number | null; invoiceYear: number | null; invoiceIssuedAt: Date | null; invoiceVoidedAt: Date | null },
  px: SearchPrefixes,
): { invoiceLabel: string | null; invoiceVoided: boolean } {
  if (r.invoiceNo == null) return { invoiceLabel: null, invoiceVoided: false };
  const year = r.invoiceYear ?? r.invoiceIssuedAt?.getFullYear() ?? new Date().getFullYear();
  return { invoiceLabel: formatInvoiceNo(px.invoicePrefix, year, r.invoiceNo), invoiceVoided: r.invoiceVoidedAt !== null };
}

/** Is this ledger kind money-out (a refund)? Exposed so the UI signs the amount. */
export function isMoneyOut(kind: string): boolean {
  return OUT_KINDS.has(kind);
}
