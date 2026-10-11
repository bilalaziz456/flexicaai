"use server";

import { clinicHasFeature } from "@/core/lib/features";
import { parseDocNumber } from "@/core/billing/doc-number";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, invoices, patients } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { formatInvoiceNo } from "@/core/billing/invoice";
import { formatMrn, mrnDigits, mrnMatchesSql } from "@/core/patients/mrn";
import { patientPhoneMatchSql } from "@/core/patients/search-sql";

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
      // Invoices only: the separate receipt is gone — the invoice is the patient's
      // paper and carries every payment (owner's call, 2026-10-12).
      kind: "invoice";
      /** The appointment the document belongs to; every panel can route to it. */
      appointmentId: string;
      /** Printable number, e.g. "INV-100005". */
      label: string;
      detail: string;
    };

/** Cap per type — this is a jump-to box, not a report. */
const LIMIT = 6;


export type SearchResult = {
  hits: SearchHit[];
  /** Whether the box may offer "Create patient" when nothing matches. Decided here,
   *  beside the other permission checks, so the client never guesses at the ACL. */
  canCreatePatient: boolean;
  /** Whether a patient hit may offer "Book appointment". */
  canBookAppointment: boolean;
  /** Whether a patient hit may offer "Create invoice" (billing + booking, with the
   *  `sales` feature — the same gates as the Invoices page's New invoice). */
  canCreateInvoice: boolean;
  /** Whether an invoice hit may offer "Edit invoice". */
  canEditInvoice: boolean;
};

export async function globalSearch(query: string): Promise<SearchResult> {
  const user = await getCurrentUser();
  const q = query.trim();
  // Two characters is the floor: one letter matches most of the patient list and
  // makes every keystroke a table scan for nothing.
  if (!user?.clinicId || q.length < 2) {
    return { hits: [], canCreatePatient: false, canBookAppointment: false, canCreateInvoice: false, canEditInvoice: false };
  }
  const clinicId = user.clinicId;

  const [clinic] = await db
    .select({
      mrnPrefix: clinics.mrnPrefix,
      invoicePrefix: clinics.invoicePrefix,
      featuresEnabled: clinics.featuresEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const doc = parseDocNumber(q, clinic?.invoicePrefix);

  const canPatients = can(user, "patients", "view");
  const canBilling = can(user, "billing", "view");

  const [patientRows, invoiceRows] = await Promise.all([
    canPatients ? searchPatients(clinicId, q) : Promise.resolve([]),
    canBilling && doc ? searchInvoices(clinicId, doc) : Promise.resolve([]),
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
  for (const r of invoiceRows) {
    hits.push({
      kind: "invoice",
      appointmentId: r.appointmentId,
      label: formatInvoiceNo(clinic?.invoicePrefix, r.no),
      detail: r.patientName,
    });
  }
  return {
    hits,
    canCreatePatient: can(user, "patients", "create"),
    canBookAppointment: can(user, "appointments", "create"),
    canCreateInvoice:
      clinicHasFeature(clinic?.featuresEnabled, "sales") &&
      can(user, "billing", "create") &&
      can(user, "appointments", "create"),
    canEditInvoice: clinicHasFeature(clinic?.featuresEnabled, "sales") && can(user, "appointments", "edit"),
  };
}

/** Name, phone, or MRN — the same three the patients list matches. */
function searchPatients(clinicId: string, q: string) {
  const conds = [
    ilike(patients.fullName, `%${q}%`),
    patientPhoneMatchSql(q),
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

