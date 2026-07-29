import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, invoices, patients, users } from "@/core/db/schema";
import { appointmentBillNetSql } from "@/core/finance/receivables";

/**
 * Invoices — CORE (Finance). One live invoice per appointment. The number is a
 * per-clinic sequential integer that RESETS each calendar year (allocated by locking
 * the clinic row `SELECT … FOR UPDATE` and bumping `next_invoice_no`, so two
 * receptionists issuing at once never collide). Rendered `<prefix><YYYY>-<7-digit>`,
 * e.g. "INV-2026-0000005". The bill amount is NOT stored — it's derived from
 * `computeBill` at render time (see core/billing/bill.ts).
 */

type Actor = { id: string; name: string };

/** Printable invoice number — `<prefix><YYYY>-<7-digit>` (numbers reset per year). */
export function formatInvoiceNo(
  prefix: string | null | undefined,
  year: number,
  no: number,
): string {
  return `${prefix ?? ""}${year}-${String(no).padStart(7, "0")}`;
}

export type IssuedInvoice = {
  id: string;
  invoiceNo: number;
  label: string; // e.g. "INV-2026-0000005"
  issuedAt: Date;
};

/** The live invoice for an appointment, if one has been issued. */
export async function getInvoiceForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<IssuedInvoice | null> {
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNo: invoices.invoiceNo,
      invoiceYear: invoices.invoiceYear,
      issuedAt: invoices.issuedAt,
      prefix: clinics.invoicePrefix,
    })
    .from(invoices)
    .innerJoin(clinics, eq(clinics.id, invoices.clinicId))
    .where(
      byClinic(
        invoices.clinicId,
        clinicId,
        notDeleted(invoices.deletedAt),
        eq(invoices.appointmentId, appointmentId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const year = row.invoiceYear ?? row.issuedAt.getFullYear();
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    label: formatInvoiceNo(row.prefix, year, row.invoiceNo),
    issuedAt: row.issuedAt,
  };
}

export type InvoiceListRow = {
  id: string;
  label: string; // e.g. "INV-2026-0000042"
  invoiceNo: number;
  issuedAt: Date;
  issuedByName: string | null;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentId: string;
  amount: number; // derived bill (computeBill mirror), never stored
};
export type InvoiceList = { rows: InvoiceListRow[]; count: number; totalBilled: number };
export type InvoiceListFilters = { from?: Date; toExclusive?: Date; q?: string };

/**
 * The invoice register — every live invoice, newest number first, with the derived
 * bill amount (the shared `appointmentBillNetSql`, so it matches the printed invoice
 * and every other money view). Search matches invoice number OR patient name/phone;
 * an optional issued-date range narrows it. Clinic-scoped; for lookup + reprint.
 */
export async function getInvoicesList(
  clinicId: string,
  filters: InvoiceListFilters = {},
): Promise<InvoiceList> {
  const [clinic] = await db
    .select({ prefix: clinics.invoicePrefix, mrnPrefix: clinics.mrnPrefix })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const prefix = clinic?.prefix ?? "";
  const mrnPrefix = clinic?.mrnPrefix ?? "";

  const conds = [notDeleted(invoices.deletedAt)];
  if (filters.from) conds.push(gte(invoices.issuedAt, filters.from));
  if (filters.toExclusive) conds.push(lt(invoices.issuedAt, filters.toExclusive));
  if (filters.q) {
    const like = `%${filters.q}%`;
    // Match SQL's date to what formatMrn produces (server-local time), else the
    // YYYYMMDD part disagrees near midnight and a full-MRN search misses.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    conds.push(
      or(
        ilike(patients.fullName, like),
        ilike(patients.phone, like),
        // "Patient number" = the clinic's old/imported patient ref (kept for the desk).
        ilike(patients.externalRef, like),
        // Invoice # — the full label (prefix + year + 7-digit) so "INV-2026-0000005",
        // "2026-0000005" or a bare "5" all hit.
        sql`(${prefix} || ${invoices.invoiceYear}::text || '-' || lpad(${invoices.invoiceNo}::text, 7, '0')) ilike ${like}`,
        sql`${invoices.invoiceNo}::text ilike ${like}`,
        // MRN — the printable form (prefix + YYYYMMDD registration + 7-digit counter),
        // matched against the raw query so a full "KL-…" or a partial digit run hits,
        // and an invoice search (no "KL-") never false-matches it.
        sql`(${mrnPrefix} || to_char(${patients.createdAt} AT TIME ZONE ${tz}, 'YYYYMMDD') || lpad(${patients.mrn}::text, 7, '0')) ilike ${like}`,
      )!,
    );
  }

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNo: invoices.invoiceNo,
      invoiceYear: invoices.invoiceYear,
      issuedAt: invoices.issuedAt,
      issuedByName: invoices.issuedByName,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      appointmentId: appointments.id,
      amount: appointmentBillNetSql(),
    })
    .from(invoices)
    .innerJoin(appointments, eq(appointments.id, invoices.appointmentId))
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(invoices.clinicId, clinicId, and(...conds)))
    .orderBy(desc(invoices.invoiceNo));

  const list = rows.map((r) => ({
    id: r.id,
    label: formatInvoiceNo(prefix, r.invoiceYear ?? r.issuedAt.getFullYear(), r.invoiceNo),
    invoiceNo: r.invoiceNo,
    issuedAt: r.issuedAt,
    issuedByName: r.issuedByName,
    patientId: r.patientId,
    patientName: r.patientName,
    patientPhone: r.patientPhone,
    appointmentId: r.appointmentId,
    amount: Number(r.amount),
  }));
  return {
    rows: list,
    count: list.length,
    totalBilled: list.reduce((s, r) => s + r.amount, 0),
  };
}

/**
 * Issue (or return the existing) invoice for an appointment. Idempotent — a second
 * call returns the invoice already issued. Allocates the next per-clinic number
 * atomically. Clinic-scoped.
 */
export async function issueInvoice(
  clinicId: string,
  appointmentId: string,
  actor: Actor,
): Promise<{ error: string } | IssuedInvoice> {
  const existing = await getInvoiceForAppointment(clinicId, appointmentId);
  if (existing) return existing;

  const [appt] = await db
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt) return { error: "Appointment not found." };

  return db.transaction(async (tx) => {
    // Lock the clinic row so the number allocation serializes.
    const [c] = await tx
      .select({ next: clinics.nextInvoiceNo, prefix: clinics.invoicePrefix, year: clinics.invoiceYear })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for("update")
      .limit(1);
    if (!c) return { error: "Clinic not found." };

    // Reset the sequence to 1 on a new year (or first-ever issue).
    const currentYear = new Date().getFullYear();
    const allocated = c.year === currentYear ? c.next : 1;
    await tx
      .update(clinics)
      .set({ nextInvoiceNo: allocated + 1, invoiceYear: currentYear, updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));

    const [inv] = await tx
      .insert(invoices)
      .values({
        clinicId,
        appointmentId,
        patientId: appt.patientId,
        invoiceNo: allocated,
        invoiceYear: currentYear,
        issuedBy: actor.id,
        issuedByName: actor.name,
      })
      .returning({ id: invoices.id, issuedAt: invoices.issuedAt });

    return {
      id: inv.id,
      invoiceNo: allocated,
      label: formatInvoiceNo(c.prefix, currentYear, allocated),
      issuedAt: inv.issuedAt,
    };
  });
}
