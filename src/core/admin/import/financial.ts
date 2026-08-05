import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { importBatches, importedTransactions, patients, users } from "@/core/db/schema";
import { parseImportFile, pick, type ImportRow } from "./parse";
import { applyMapping, resolveMapping } from "./fields";
import {
  normalizePhone,
  parseAmount,
  parseImportDate,
  summarize,
  type ImportEntity,
  type ImportPreview,
  type ImportResult,
  type RowResult,
} from "./types";

/**
 * Financial-history archive import (docs/financial-archive-plan.md). Parses a clinic's
 * old bills / receipts / expenses / doctor-payouts into the read-only
 * `imported_transactions` table. Same shape as patients.ts (validate → analyze →
 * preview/commit → batch), but ALL four passes write ONE table with a `type` stamp; the
 * `raw` jsonb keeps the original row verbatim. NOTHING here feeds a live report — the one
 * bridge is the opt-in `opening_balance` derivation on the payments commit.
 */

/** ImportEntity → the transaction `type` stored (payment splits to refund on a negative). */
const TYPE_OF: Partial<Record<ImportEntity, string>> = {
  fin_invoice: "invoice",
  fin_payment: "payment",
  fin_expense: "expense",
  fin_payout: "doctor_payout",
};

type TxnInput = {
  type: string;
  txnDate: string | null;
  amount: number; // always positive; `type` carries direction
  patientId: string | null;
  patientName: string | null;
  externalPatientRef: string | null;
  doctorId: string | null;
  doctorName: string | null;
  description: string | null;
  reference: string | null;
  method: string | null;
  raw: Record<string, string>;
  /** Match keys resolved in analyze (not stored). */
  _patientKey: string | null;
};

/** Strip a leading title so "Dr Bilal Aziz" matches a stored "Bilal Aziz". */
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/^(dr|dr\.|doctor|mr|mr\.|mrs|mrs\.|miss|ms|ms\.)\s+/i, "").replace(/\s+/g, " ");
}

/** Validate + normalise ONE row for a given entity (no DB — that's `analyze`). */
function validateRow(entity: ImportEntity, row: ImportRow): RowResult<TxnInput> {
  const type = TYPE_OF[entity]!;
  const warnings: string[] = [];
  const raw = { ...row };

  // Date (shared).
  const dateKey = entity === "fin_invoice" ? "invoice_date" : entity === "fin_payment" ? "payment_date" : entity === "fin_expense" ? "expense_date" : "payout_date";
  const rawDate = pick(row, dateKey, "date");
  let txnDate: string | null = null;
  if (rawDate) {
    txnDate = parseImportDate(rawDate);
    if (!txnDate) warnings.push(`Unrecognised date "${rawDate}", left blank`);
  } else {
    warnings.push("No date, left blank");
  }

  // Amount (shared, required). Invoices may give gross+discount instead of net.
  const rawAmount = pick(row, "amount", "net", "total", "paid");
  let amount: number | null = rawAmount ? parseAmount(rawAmount) : null;
  if (amount == null && entity === "fin_invoice") {
    const gross = parseAmount(pick(row, "gross"));
    const disc = parseAmount(pick(row, "discount")) ?? 0;
    if (gross != null) amount = gross - disc;
  }
  if (amount == null) return { kind: "error", reason: "Missing or unreadable amount" };

  // Payments: a negative amount is a refund; everything else is stored positive.
  let effType = type;
  if (entity === "fin_payment" && amount < 0) {
    effType = "refund";
    warnings.push("Negative amount, recorded as a refund");
  }
  if (amount < 0) amount = Math.abs(amount);
  if (amount === 0) warnings.push("Amount is 0");

  const method = pick(row, "method", "mode") || null;
  let description = pick(row, "description", "category", "note", "particulars", "details") || null;
  // Expenses: fold the vendor into the description so it stays visible (there is no
  // dedicated vendor column; the original is still kept in `raw`).
  if (entity === "fin_expense") {
    const vendor = pick(row, "vendor", "payee", "supplier");
    if (vendor) description = description ? `${description}: ${vendor}` : vendor;
  }

  // Reference = their old document number, per entity.
  const reference =
    pick(row, entity === "fin_invoice" ? "invoice_no" : entity === "fin_payment" ? "receipt_no" : "reference") || null;

  // Who it concerns.
  let patientName: string | null = null;
  let externalPatientRef: string | null = null;
  let doctorName: string | null = null;
  if (entity === "fin_invoice" || entity === "fin_payment") {
    patientName = pick(row, "patient_name", "name") || null;
    externalPatientRef = pick(row, "external_ref", "patient_id", "mrn") || null;
    const rawPhone = pick(row, "phone", "mobile", "contact");
    if (!patientName && !externalPatientRef && !rawPhone) {
      return { kind: "error", reason: "No patient (need old no., phone, or name)" };
    }
    // Stash a phone into raw for matching in analyze.
    if (rawPhone) raw.__phone = normalizePhone(rawPhone).phone ?? "";
  } else if (entity === "fin_payout") {
    doctorName = pick(row, "doctor", "doctor_name", "name") || null;
    if (!doctorName) return { kind: "error", reason: "Missing doctor name" };
  }

  return {
    kind: "ready",
    warnings,
    data: {
      type: effType,
      txnDate,
      amount,
      patientId: null,
      patientName,
      externalPatientRef,
      doctorId: null,
      doctorName,
      description,
      reference,
      method,
      raw,
      _patientKey: null,
    },
  };
}

/** Parse + validate + resolve patient/doctor matches + dedup. Clinic-scoped. */
async function analyze(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  override?: Record<string, string> | null,
): Promise<{
  headers: string[];
  mapping: Record<string, string>;
  total: number;
  results: { row: number; res: RowResult<TxnInput> }[];
}> {
  const { rows, headers } = await parseImportFile(filename, buf);
  const mapping = resolveMapping(entity, headers, override);
  const mapped = applyMapping(rows, mapping);

  const needsPatient = entity === "fin_invoice" || entity === "fin_payment";
  const needsDoctor = entity === "fin_payout";

  // Match maps (only load what this entity needs).
  const byRef = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  const nameDup = new Set<string>();
  if (needsPatient) {
    const rowsP = await db
      .select({ id: patients.id, externalRef: patients.externalRef, phone: patients.phone, fullName: patients.fullName })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)));
    for (const p of rowsP) {
      if (p.externalRef) byRef.set(p.externalRef.trim().toLowerCase(), p.id);
      if (p.phone) byPhone.set(p.phone, p.id);
      const nk = p.fullName.trim().toLowerCase();
      if (byName.has(nk)) nameDup.add(nk);
      else byName.set(nk, p.id);
    }
  }
  const docByName = new Map<string, string>();
  const docDup = new Set<string>();
  if (needsDoctor) {
    const rowsD = await db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.role, "doctor")));
    for (const d of rowsD) {
      for (const cand of [d.fullName ? normName(d.fullName) : "", d.username ? normName(d.username) : ""]) {
        if (!cand) continue;
        if (docByName.has(cand)) docDup.add(cand);
        else docByName.set(cand, d.id);
      }
    }
  }

  // Existing archive references for dedup (only where a reference is a natural key).
  const dedupByRef = entity === "fin_invoice" || entity === "fin_payment" || entity === "fin_payout";
  const existingRefs = new Set<string>();
  if (dedupByRef) {
    const refRows = await db
      .select({ reference: importedTransactions.reference, type: importedTransactions.type })
      .from(importedTransactions)
      .where(byClinic(importedTransactions.clinicId, clinicId, notDeleted(importedTransactions.deletedAt)));
    for (const r of refRows) if (r.reference) existingRefs.add(`${r.type}:${r.reference.trim().toLowerCase()}`);
  }
  const seenRefs = new Set<string>();

  const results = mapped.map((row, i) => {
    let res = validateRow(entity, row);
    if (res.kind === "ready") {
      const d = res.data;
      // Resolve patient.
      if (needsPatient) {
        const refKey = d.externalPatientRef?.trim().toLowerCase();
        const phone = d.raw.__phone;
        const nameKey = d.patientName?.trim().toLowerCase();
        let id: string | undefined;
        if (refKey && byRef.has(refKey)) id = byRef.get(refKey);
        else if (phone && byPhone.has(phone)) id = byPhone.get(phone);
        else if (nameKey && byName.has(nameKey) && !nameDup.has(nameKey)) id = byName.get(nameKey);
        if (id) d.patientId = id;
        else res.warnings.push("Patient not found, archived unlinked");
        if (nameKey && nameDup.has(nameKey) && !d.patientId) {
          // ambiguous name; keep unlinked (already warned)
        }
      }
      // Resolve doctor.
      if (needsDoctor && d.doctorName) {
        const nk = normName(d.doctorName);
        if (docByName.has(nk) && !docDup.has(nk)) d.doctorId = docByName.get(nk)!;
        else res.warnings.push(docDup.has(nk) ? "Two doctors share this name, archived unlinked" : "Doctor not found, archived unlinked");
      }
      // Dedup on the old document number (within file + against existing archive).
      if (dedupByRef && d.reference) {
        const key = `${d.type}:${d.reference.trim().toLowerCase()}`;
        if (existingRefs.has(key) || seenRefs.has(key)) {
          res = { kind: "duplicate", reason: `Already imported (ref ${d.reference})` };
        } else {
          seenRefs.add(key);
        }
      }
    }
    return { row: i + 2, res }; // +2: 1-based rows + header line
  });

  return { headers, mapping, total: mapped.length, results };
}

/** Money totals of the ready rows, for the reconciliation footer. */
function computeTotals(entity: ImportEntity, ready: TxnInput[]): { label: string; amount: number }[] {
  const sum = (pred: (t: TxnInput) => boolean) => ready.filter(pred).reduce((a, t) => a + t.amount, 0);
  if (entity === "fin_invoice") return [{ label: "Billed", amount: sum(() => true) }];
  if (entity === "fin_payment")
    return [
      { label: "Money in", amount: sum((t) => t.type === "payment") },
      { label: "Refunds", amount: sum((t) => t.type === "refund") },
    ];
  if (entity === "fin_expense") return [{ label: "Expenses", amount: sum(() => true) }];
  return [{ label: "Doctor payouts", amount: sum(() => true) }];
}

export async function previewFinancial(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  override?: Record<string, string> | null,
): Promise<ImportPreview> {
  const { headers, mapping, total, results } = await analyze(clinicId, entity, filename, buf, override);
  const ready = results.flatMap((r) => (r.res.kind === "ready" ? [r.res.data] : []));
  return { ...summarize(entity, headers, mapping, total, results), totals: computeTotals(entity, ready) };
}

export async function commitFinancial(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
  override?: Record<string, string> | null,
  opts?: { deriveOpeningBalance?: boolean },
): Promise<ImportResult> {
  const { results } = await analyze(clinicId, entity, filename, buf, override);
  const ready = results.flatMap((r) => (r.res.kind === "ready" ? [r.res.data] : []));
  const skipped = results.filter((r) => r.res.kind === "duplicate").length;
  const errored = results.filter((r) => r.res.kind === "error").length;
  const warnings = results.filter((r) => r.res.kind === "ready" && r.res.warnings.length > 0).length;

  if (ready.length === 0) return { batchId: "", imported: 0, skipped, errored, warnings };

  const batchId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        clinicId,
        entity,
        filename,
        counts: { imported: ready.length, skipped, errored, warnings },
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning({ id: importBatches.id });

    const values = ready.map((t) => ({
      clinicId,
      type: t.type,
      txnDate: t.txnDate,
      amount: t.amount,
      patientId: t.patientId,
      patientName: t.patientName,
      externalPatientRef: t.externalPatientRef,
      doctorId: t.doctorId,
      doctorName: t.doctorName,
      description: t.description,
      reference: t.reference,
      method: t.method,
      raw: t.raw,
      importBatchId: batch.id,
    }));
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(importedTransactions).values(values.slice(i, i + 500));
    }

    // Opt-in bridge to live data: SET (never add) each affected patient's opening
    // balance to the archive-derived outstanding (Σinvoice − Σpayment + Σrefund),
    // clamped ≥ 0. Idempotent, so flat + derived paths can't stack. Payments pass only.
    if (opts?.deriveOpeningBalance && entity === "fin_payment") {
      await tx.execute(sql`
        UPDATE ${patients} AS p
        SET opening_balance = sub.bal, updated_at = now()
        FROM (
          SELECT patient_id,
            GREATEST(0, SUM(CASE WHEN type = 'invoice' THEN amount
                                 WHEN type = 'refund' THEN amount
                                 WHEN type = 'payment' THEN -amount
                                 ELSE 0 END))::int AS bal
          FROM ${importedTransactions}
          WHERE clinic_id = ${clinicId} AND deleted_at IS NULL AND patient_id IS NOT NULL
          GROUP BY patient_id
        ) AS sub
        WHERE p.id = sub.patient_id AND p.clinic_id = ${clinicId} AND p.deleted_at IS NULL
      `);
    }

    return batch.id;
  });

  return { batchId, imported: ready.length, skipped, errored, warnings };
}
