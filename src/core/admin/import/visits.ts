import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, importBatches, patients, users, visits } from "@/core/db/schema";
import { parseImportFile, pick, type ImportRow } from "./parse";
import { applyMapping, resolveMapping } from "./fields";
import { normalizePhone, parseImportDate, summarize, type ImportPreview, type ImportResult, type RowResult } from "./types";

/**
 * Clinical-notes history import (Phase 2) — brings a clinic's old visit notes in as
 * FREEFORM, imported, approved `visits` records (never re-run through the billing or
 * scribe engines). Each row is matched to a patient (external_ref → phone → exact
 * name) and, if it names a doctor we know, to that staff member. See docs/import-plan.md.
 */
type VisitInput = {
  patientId: string;
  doctorId: string | null;
  doctorName: string | null; // unmapped doctor name, kept for display
  visitDate: Date;
  summary: string;
};

type Lookups = {
  byExt: Map<string, string>;
  byPhone: Map<string, string>;
  byName: Map<string, string[]>;
  doctors: Map<string, string>;
  existing: Set<string>; // dedup keys of already-imported notes
  module: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function buildLookups(clinicId: string): Promise<Lookups> {
  const [pats, docs, ex, clinicRow] = await Promise.all([
    db
      .select({ id: patients.id, ext: patients.externalRef, phone: patients.phone, name: patients.fullName })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt))),
    db
      .select({ id: users.id, name: users.fullName, uname: users.username })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.role, "doctor"))),
    db
      .select({ pid: visits.patientId, vdate: visits.visitDate, summary: sql<string>`${visits.note}->>'summary'` })
      .from(visits)
      .where(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.imported, true))),
    db.select({ modules: clinics.modulesEnabled }).from(clinics).where(eq(clinics.id, clinicId)).limit(1),
  ]);

  const byExt = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of pats) {
    if (p.ext) byExt.set(p.ext.trim().toLowerCase(), p.id);
    if (p.phone) byPhone.set(p.phone, p.id);
    const k = p.name.trim().toLowerCase();
    const arr = byName.get(k) ?? [];
    arr.push(p.id);
    byName.set(k, arr);
  }
  const doctors = new Map<string, string>();
  for (const d of docs) {
    if (d.name) doctors.set(d.name.trim().toLowerCase(), d.id);
    doctors.set(d.uname.trim().toLowerCase(), d.id);
  }
  const existing = new Set(ex.map((r) => `${r.pid}|${ymd(r.vdate)}|${r.summary ?? ""}`));
  return { byExt, byPhone, byName, doctors, existing, module: clinicRow[0]?.modules?.[0] ?? null };
}

function validateRow(row: ImportRow, lk: Lookups): RowResult<VisitInput> {
  const warnings: string[] = [];

  // --- Patient: external_ref → phone → exact name ---
  const ext = pick(row, "external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "mrn");
  const rawPhone = pick(row, "phone", "mobile", "contact", "whatsapp");
  const name = pick(row, "patient_name", "patient", "name", "full_name");
  let patientId: string | undefined;
  if (ext) patientId = lk.byExt.get(ext.trim().toLowerCase());
  if (!patientId && rawPhone) {
    const { phone } = normalizePhone(rawPhone);
    if (phone) patientId = lk.byPhone.get(phone);
  }
  if (!patientId && name) {
    const matches = lk.byName.get(name.trim().toLowerCase());
    if (matches && matches.length === 1) patientId = matches[0];
    else if (matches && matches.length > 1)
      return { kind: "error", reason: `Ambiguous patient name "${name}" (${matches.length} matches) — add a phone or ID column` };
  }
  if (!patientId) return { kind: "error", reason: `Patient not found (${ext || rawPhone || name || "no identifier"})` };

  // --- Note text (combined) ---
  const parts: string[] = [];
  const dx = pick(row, "diagnosis", "dx");
  const tx = pick(row, "treatment", "procedure", "treatment_done", "work_done", "treatment_performed");
  const nt = pick(row, "note", "notes", "summary", "clinical_note", "details", "remarks", "comments");
  if (dx) parts.push(`Diagnosis: ${dx}`);
  if (tx) parts.push(`Treatment: ${tx}`);
  if (nt) parts.push(nt);
  const summary = parts.join("\n").slice(0, 5000);
  if (!summary) return { kind: "error", reason: "Missing note text (diagnosis / treatment / note)" };

  // --- Date (optional; defaults today with a warning) ---
  const rawDate = pick(row, "visit_date", "date", "visit", "seen_on", "visited_on");
  const d = parseImportDate(rawDate);
  let visitDate: Date;
  if (d) visitDate = new Date(`${d}T12:00:00`);
  else {
    visitDate = new Date();
    warnings.push(rawDate ? `Unrecognised date "${rawDate}" — using today` : "No visit date — using today");
  }

  // --- Doctor (optional; matched by name, else kept as text) ---
  let doctorId: string | null = null;
  let doctorName: string | null = null;
  const docRaw = pick(row, "doctor", "doctor_name", "dentist", "provider", "physician");
  if (docRaw) {
    const key = docRaw.trim().toLowerCase();
    doctorId = lk.doctors.get(key.replace(/^dr\.?\s+/, "")) ?? lk.doctors.get(key) ?? null;
    if (!doctorId) doctorName = docRaw;
  }

  // --- In-file + against-existing dedup ---
  const dupKey = `${patientId}|${ymd(visitDate)}|${summary}`;
  if (lk.existing.has(dupKey)) return { kind: "duplicate", reason: `A note for this patient on ${ymd(visitDate)} was already imported` };
  lk.existing.add(dupKey);

  return { kind: "ready", warnings, data: { patientId, doctorId, doctorName, visitDate, summary } };
}

async function analyze(clinicId: string, filename: string, buf: ArrayBuffer, override?: Record<string, string> | null) {
  const lk = await buildLookups(clinicId);
  const { rows, headers } = await parseImportFile(filename, buf);
  const mapping = resolveMapping("visits", headers, override);
  const mapped = applyMapping(rows, mapping);
  const results = mapped.map((row, i) => ({ row: i + 2, res: validateRow(row, lk) }));
  return { headers, mapping, total: mapped.length, results, module: lk.module };
}

export async function previewVisits(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  override?: Record<string, string> | null,
): Promise<ImportPreview> {
  const { headers, mapping, total, results } = await analyze(clinicId, filename, buf, override);
  return summarize("visits", headers, mapping, total, results);
}

export async function commitVisits(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
  override?: Record<string, string> | null,
): Promise<ImportResult> {
  const { results, module } = await analyze(clinicId, filename, buf, override);
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
        entity: "visits",
        filename,
        counts: { imported: ready.length, skipped, errored, warnings },
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning({ id: importBatches.id });

    const values = ready.map((v) => ({
      clinicId,
      patientId: v.patientId,
      doctorId: v.doctorId,
      module,
      status: "approved" as const,
      imported: true,
      importBatchId: batch.id,
      note: { imported: true, summary: v.summary, ...(v.doctorName ? { doctorName: v.doctorName } : {}) },
      visitDate: v.visitDate,
      approvedAt: v.visitDate,
    }));
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(visits).values(values.slice(i, i + 500));
    }
    return batch.id;
  });

  return { batchId, imported: ready.length, skipped, errored, warnings };
}
