import "server-only";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { clinics, patients } from "@/core/db/schema";
import { byClinic } from "@/core/db/tenant";
import type { Tx } from "@/core/db/tx";
import { formatMrnLabel, mrnDigits, parseStartingMrn } from "@/core/patients/mrn-series";
import { db } from "@/core/db";

/**
 * Patient MRN (Medical Record Number) — CORE, specialty-agnostic. Each patient gets
 * the next number in the clinic's SERIES (`core/patients/mrn-series.ts`), and the
 * printed form — "FA-100023" — is STORED on the patient (`patients.mrn_label`): it is
 * written on their card and file, so changing the clinic's series later must never
 * relabel anyone (owner's call, 2026-10-13).
 */

/**
 * Takes the next `count` MRNs for a clinic, inside the caller's transaction. Locks the
 * clinic row, so two registrations racing cannot both read the same next number — an
 * MRN is written on a physical file, and a duplicate is not a cosmetic problem.
 *
 * A number already HELD by a patient (an older series the clinic moved away from and
 * back to, an import) is skipped rather than reused; the unique index would refuse it
 * anyway, and skipping beats failing a registration at the desk.
 */
export async function allocateMrns(
  tx: Tx,
  clinicId: string,
  count: number,
): Promise<{ mrn: number; label: string }[]> {
  if (count <= 0) return [];
  const [c] = await tx
    .select({ prefix: clinics.mrnPrefix, width: clinics.mrnWidth, next: clinics.nextMrn })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .for("update")
    .limit(1);
  const prefix = c?.prefix ?? "";
  const width = c?.width ?? 6;
  let n = Number(c?.next ?? 1);

  const out: { mrn: number; label: string }[] = [];
  while (out.length < count) {
    // Ask in batches of what is still needed (plus a little), so a run of collisions
    // costs one query per batch rather than one per number.
    const batch = Array.from({ length: count - out.length + 5 }, (_, i) => n + i);
    const labels = batch.map((x) => formatMrnLabel(prefix, width, x));
    const taken = new Set(
      (
        await tx
          .select({ label: patients.mrnLabel })
          .from(patients)
          .where(byClinic(patients.clinicId, clinicId, inArray(patients.mrnLabel, labels)))
      ).map((r) => r.label),
    );
    for (let i = 0; i < batch.length && out.length < count; i++) {
      if (!taken.has(labels[i])) out.push({ mrn: batch[i], label: labels[i] });
    }
    n = batch[batch.length - 1] + 1;
    if (out.length === count) n = out[out.length - 1].mrn + 1;
  }
  await tx.update(clinics).set({ nextMrn: n, updatedAt: new Date() }).where(eq(clinics.id, clinicId));
  return out;
}

/**
 * The highest number a clinic has already given in a series (same prefix, digits
 * only after it), or null when it has given none. A new starting MRN must be above
 * it, so a series moved back to cannot hand out a number again.
 */
export async function highestMrnInSeries(
  exec: Pick<Tx, "select">,
  clinicId: string,
  prefix: string,
): Promise<number | null> {
  const [row] = await exec
    .select({ max: sql<string | null>`max(${patients.mrn})` })
    .from(patients)
    .where(
      byClinic(
        patients.clinicId,
        clinicId,
        and(
          sql`left(${patients.mrnLabel}, ${prefix.length}) = ${prefix}`,
          sql`substr(${patients.mrnLabel}, ${prefix.length + 1}) ~ '^[0-9]+$'`,
        ),
      ),
    );
  return row?.max == null ? null : Number(row.max);
}


/**
 * SQL predicate for the quick searches: the term is the MRN's NUMBER ("42",
 * "0000042") — matched exactly, in any series — or appears in the printed MRN
 * ("FA-1000", a pasted "GS-00000042").
 */
export function mrnMatchesSql(term: string): SQL {
  const digits = mrnDigits(term);
  const byNumber = /^\d+$/.test(term.trim()) && digits.length <= 15 ? sql`${patients.mrn} = ${Number(digits)}` : sql`false`;
  return sql`(${byNumber} or ${patients.mrnLabel} ilike ${`%${term.trim()}%`})`;
}

/**
 * Sets the clinic's MRN series from a STARTING MRN ("GS-00000001"). Only the NEXT
 * patients are affected — every existing patient keeps the MRN printed on their card.
 *
 * Refused when the start is not above the highest number the clinic has already given
 * in that same prefix: going back from GS to "FA-100001" after FA-100001…FA-100230
 * were issued would hand those numbers out again. The error names the first free one.
 * A no-op when it is already the clinic's next MRN.
 */
export async function setClinicMrnSeries(
  clinicId: string,
  startingMrn: string,
): Promise<{ ok: true; changed: boolean } | { error: string }> {
  const series = parseStartingMrn(startingMrn);
  if ("error" in series) return series;
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ prefix: clinics.mrnPrefix, width: clinics.mrnWidth, next: clinics.nextMrn })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for("update")
      .limit(1);
    if (!c) return { error: "Clinic not found." };
    if (c.prefix === series.prefix && c.width === series.width && Number(c.next) === series.start) {
      return { ok: true, changed: false } as const;
    }
    const highest = await highestMrnInSeries(tx, clinicId, series.prefix);
    if (highest !== null && series.start <= highest) {
      const free = formatMrnLabel(series.prefix, series.width, highest + 1);
      return {
        error: `${formatMrnLabel(series.prefix, series.width, series.start)} is already used — patients up to ${formatMrnLabel(series.prefix, series.width, highest)} exist. Start at ${free} or higher.`,
      };
    }
    await tx
      .update(clinics)
      .set({ mrnPrefix: series.prefix, mrnWidth: series.width, nextMrn: series.start, updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));
    return { ok: true, changed: true } as const;
  });
}
