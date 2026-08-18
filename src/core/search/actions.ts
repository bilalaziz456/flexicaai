"use server";

import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, invoices, patients } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { formatInvoiceNo, formatReceiptNo } from "@/core/billing/invoice";
import { formatMrn, mrnDigits, mrnMatchesSql } from "@/core/patients/mrn";

/**
 * Global search — the top-bar box, reachable from every panel.
 *
 * Each result TYPE carries its own permission check. That is the whole security
 * story here: until now the page was the gate (you couldn't see invoices without
 * reaching /clinic/invoices), and a search box that reaches across entities
 * bypasses that gate. A blanket `requireWorkspace` would be wrong — holding
 * `patients:view` says nothing about billing.
 *
 * Returns ids, not links. The caller knows which panel it is mounted in and
 * builds its own hrefs, so nothing about routing has to be trusted from the
 * client.
 */

export type SearchHit =
  | {
      kind: "patient";
      id: string;
      label: string;
      /** Phone / MRN — whatever identifies them at the desk. */
      detail: string;
    }
  | {
      kind: "invoice" | "receipt";
      /** The appointment the document belongs to; every panel can route to it. */
      appointmentId: string;
      /** Printable number, e.g. "INV-2026-0000005". */
      label: string;
      detail: string;
    };

/** Cap per type — this is a jump-to box, not a report. */
const LIMIT = 6;

/**
 * A document number in a term: "INV-2026-0000005", "2026-5", or bare digits.
 * Returns the year when the term carries one, so "0000005" still matches
 * invoice 5 in any year while a full paste pins the right one.
 */
function parseDocNumber(q: string): { year: number | null; no: number } | null {
  const paired = /(\d{4})\s*-\s*(\d{1,7})/.exec(q);
  if (paired) return { year: Number(paired[1]), no: Number(paired[2]) };
  const digits = q.replace(/\D/g, "");
  // A bare number only — anything longer is an MRN or a phone, not a doc number.
  if (digits && digits.length <= 7) return { year: null, no: Number(digits) };
  return null;
}

export async function globalSearch(query: string): Promise<SearchHit[]> {
  const user = await getCurrentUser();
  const q = query.trim();
  // Two characters is the floor: one letter matches most of the patient list and
  // makes every keystroke a table scan for nothing.
  if (!user?.clinicId || q.length < 2) return [];
  const clinicId = user.clinicId;

  const [clinic] = await db
    .select({
      mrnPrefix: clinics.mrnPrefix,
      invoicePrefix: clinics.invoicePrefix,
      receiptPrefix: clinics.receiptPrefix,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const doc = parseDocNumber(q);
  const upper = q.toUpperCase();
  // A term carrying one prefix shouldn't dredge up the other series.
  const invPrefix = (clinic?.invoicePrefix ?? "").toUpperCase();
  const rcpPrefix = (clinic?.receiptPrefix ?? "").toUpperCase();
  const namedInvoice = Boolean(invPrefix) && upper.includes(invPrefix);
  const namedReceipt = Boolean(rcpPrefix) && upper.includes(rcpPrefix);
  const wantInvoice = !namedReceipt || namedInvoice;
  const wantReceipt = !namedInvoice || namedReceipt;

  const canPatients = can(user, "patients", "view");
  const canBilling = can(user, "billing", "view");

  const [patientRows, invoiceRows, receiptRows] = await Promise.all([
    canPatients ? searchPatients(clinicId, q) : Promise.resolve([]),
    canBilling && doc && wantInvoice
      ? searchInvoices(clinicId, doc)
      : Promise.resolve([]),
    canBilling && doc && wantReceipt
      ? searchReceipts(clinicId, doc)
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const p of patientRows) {
    const mrn = formatMrn(clinic?.mrnPrefix, p.mrn, p.createdAt);
    hits.push({
      kind: "patient",
      id: p.id,
      label: p.fullName,
      detail: [p.phone, mrn].filter(Boolean).join(" · "),
    });
  }
  // `invoice_year` / `receipt_year` were added after the numbers themselves
  // (migrations 0072/0073), so fall back to the document's own date the way the
  // invoice and receipt pages already do.
  for (const r of invoiceRows) {
    hits.push({
      kind: "invoice",
      appointmentId: r.appointmentId,
      label: formatInvoiceNo(
        clinic?.invoicePrefix,
        r.year ?? r.issuedAt.getFullYear(),
        r.no,
      ),
      detail: r.patientName,
    });
  }
  for (const r of receiptRows) {
    if (r.no == null) continue;
    hits.push({
      kind: "receipt",
      appointmentId: r.appointmentId,
      label: formatReceiptNo(
        clinic?.receiptPrefix,
        r.year ?? r.scheduledAt.getFullYear(),
        r.no,
      ),
      detail: r.patientName,
    });
  }
  return hits;
}

/** Name, phone, or MRN — the same three the patients list matches. */
function searchPatients(clinicId: string, q: string) {
  const conds = [
    ilike(patients.fullName, `%${q}%`),
    ilike(patients.phone, `%${q}%`),
  ];
  const digits = mrnDigits(q);
  // Same predicate the patients list uses, so a term that finds a patient there
  // finds the same patient here.
  if (digits) conds.push(mrnMatchesSql(digits));
  return db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      mrn: patients.mrn,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(
      byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), or(...conds)),
    )
    .orderBy(desc(patients.createdAt))
    .limit(LIMIT);
}

function searchInvoices(clinicId: string, doc: { year: number | null; no: number }) {
  return db
    .select({
      appointmentId: invoices.appointmentId,
      no: invoices.invoiceNo,
      year: invoices.invoiceYear,
      issuedAt: invoices.issuedAt,
      patientName: patients.fullName,
    })
    .from(invoices)
    .innerJoin(patients, eq(invoices.patientId, patients.id))
    .where(
      byClinic(
        invoices.clinicId,
        clinicId,
        notDeleted(invoices.deletedAt),
        and(
          eq(invoices.invoiceNo, doc.no),
          doc.year ? eq(invoices.invoiceYear, doc.year) : undefined,
        ),
      ),
    )
    .orderBy(desc(invoices.issuedAt))
    .limit(LIMIT);
}

/** Receipt numbers live on the appointment, not in a table of their own. */
function searchReceipts(clinicId: string, doc: { year: number | null; no: number }) {
  return db
    .select({
      appointmentId: appointments.id,
      no: appointments.receiptNo,
      year: appointments.receiptYear,
      scheduledAt: appointments.scheduledAt,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        and(
          isNotNull(appointments.receiptNo),
          eq(appointments.receiptNo, doc.no),
          doc.year ? eq(appointments.receiptYear, doc.year) : undefined,
        ),
      ),
    )
    .orderBy(desc(appointments.scheduledAt))
    .limit(LIMIT);
}
