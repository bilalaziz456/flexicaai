import "server-only";

import { and, asc, desc, eq, gte, isNotNull, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import {
  dentalCharts,
  dentalRecords,
  type ChartTeeth,
  type ChartTooth,
  type ToothFinding,
  type ToothProcedure,
} from "@/modules/dental/db/schema";
import {
  diffTeeth,
  isBlankTooth,
  reduceChart,
  toothHistory,
} from "@/modules/dental/chart-logic";
import { seedFromNote } from "@/modules/dental/seed-from-note";
import { isRootTreated, isToothNumber, statusLabel } from "@/modules/dental/tooth-status";
import type { ChartItemHistoryEntry, ModuleTrash } from "@/core/types/module";
import { patients } from "@/core/db/schema";

/**
 * Dental records + living chart — MODULE data layer (server-only). The living
 * `dental_charts` is always recomputed from the patient's LIVE records after any
 * write, so it can never drift (mirrors the Sales re-snapshot pattern). All
 * clinic-scoped.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The living odontogram for a patient (or {} if none charted yet). */
export async function getPatientChart(
  clinicId: string,
  patientId: string,
): Promise<ChartTeeth> {
  const [row] = await db
    .select({ teeth: dentalCharts.teeth })
    .from(dentalCharts)
    .where(byClinic(dentalCharts.clinicId, clinicId, eq(dentalCharts.patientId, patientId)))
    .limit(1);
  return (row?.teeth ?? {}) as ChartTeeth;
}

/** A patient's dental records, newest first (baseline included). Live only. */
export async function listDentalRecords(clinicId: string, patientId: string) {
  return db
    .select()
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .orderBy(desc(dentalRecords.isBaseline), desc(dentalRecords.createdAt));
}

/** The dental record attached to a visit, if any (live). */
export async function getRecordForVisit(clinicId: string, visitId: string) {
  const [row] = await db
    .select()
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.visitId, visitId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Recompute + upsert the living chart from the patient's LIVE records (baseline
 * first, then oldest→newest). Call inside the same transaction as any record write.
 */
export async function recomputeChart(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<void> {
  const rows = await tx
    .select({
      chartAfter: dentalRecords.chartAfter,
      isBaseline: dentalRecords.isBaseline,
      createdAt: dentalRecords.createdAt,
    })
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .orderBy(asc(dentalRecords.createdAt));

  const teeth = reduceChart(
    rows.map((r) => ({
      chartAfter: r.chartAfter,
      isBaseline: r.isBaseline,
      at: r.createdAt.getTime(),
    })),
  );

  await tx
    .insert(dentalCharts)
    .values({ clinicId, patientId, teeth })
    .onConflictDoUpdate({
      target: dentalCharts.patientId,
      set: { teeth, updatedAt: new Date() },
    });
}

export type SaveDentalRecordInput = {
  patientId: string;
  visitId?: string | null;
  isBaseline?: boolean;
  /** 'treatment' for a record that belongs to no visit. */
  kind?: string | null;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
  findings?: ToothFinding[] | null;
  proceduresDone?: ToothProcedure[] | null;
  chartAfter: ChartTeeth;
};

/**
 * Upsert a patient's dental record (per visit, or the baseline) and re-fold the
 * living chart — atomic. A visit's record is keyed by `visitId`; the baseline by
 * `(patient, is_baseline)`. Used by the visit-approval hook and the intake baseline.
 */
export async function saveDentalRecord(
  clinicId: string,
  input: SaveDentalRecordInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // Find the existing record to update (per-visit, or the live baseline).
    const existing = input.visitId
      ? await tx
          .select({ id: dentalRecords.id })
          .from(dentalRecords)
          .where(
            byClinic(
              dentalRecords.clinicId,
              clinicId,
              notDeleted(dentalRecords.deletedAt),
              eq(dentalRecords.visitId, input.visitId),
            ),
          )
          .limit(1)
      : input.isBaseline
        ? await tx
            .select({ id: dentalRecords.id })
            .from(dentalRecords)
            .where(
              byClinic(
                dentalRecords.clinicId,
                clinicId,
                notDeleted(dentalRecords.deletedAt),
                eq(dentalRecords.isBaseline, true),
                eq(dentalRecords.patientId, input.patientId),
              ),
            )
            .limit(1)
        : [];

    const values = {
      kind: input.kind ?? null,
      chiefComplaint: input.chiefComplaint ?? null,
      diagnosis: input.diagnosis ?? null,
      findings: input.findings ?? null,
      proceduresDone: input.proceduresDone ?? null,
      chartAfter: input.chartAfter,
      updatedAt: new Date(),
    };

    let id: string;
    if (existing[0]) {
      await tx
        .update(dentalRecords)
        .set(values)
        .where(eq(dentalRecords.id, existing[0].id));
      id = existing[0].id;
    } else {
      const [row] = await tx
        .insert(dentalRecords)
        .values({
          clinicId,
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          isBaseline: input.isBaseline ?? false,
          ...values,
        })
        .returning({ id: dentalRecords.id });
      id = row.id;
    }

    await recomputeChart(tx, clinicId, input.patientId);
    return { id };
  });
}

/**
 * Persist a visit's dental record on approval and fold the chart — the module's
 * `clinicalRecord.saveRecord`. Core calls this after approving a visit (it never
 * imports a dental table). `chart` is the doctor's confirmed odontogram when the
 * in-visit editor was used; otherwise the chart is auto-derived from the note
 * (current chart overlaid with the scribe's suggested edits). Findings/procedures
 * are snapshotted from the note for the timeline.
 */
export async function saveRecordOnApprove(
  clinicId: string,
  input: { visitId: string; patientId: string; note: unknown; chart?: unknown | null },
): Promise<void> {
  const n = (input.note && typeof input.note === "object" ? input.note : {}) as {
    chiefComplaint?: string | null;
    diagnosis?: string | null;
    findings?: { tooth?: string | null; finding?: string }[];
    treatmentPerformed?: string[];
  };
  const findings: ToothFinding[] = (Array.isArray(n.findings) ? n.findings : []).map((f) => ({
    tooth: f.tooth ?? null,
    condition: f.finding ?? "",
  }));
  const proceduresDone: ToothProcedure[] = (Array.isArray(n.treatmentPerformed) ? n.treatmentPerformed : []).map(
    (p) => ({ tooth: null, procedure: p }),
  );

  let chartAfter: ChartTeeth;
  if (input.chart && typeof input.chart === "object") {
    chartAfter = input.chart as ChartTeeth;
  } else {
    const current = await getPatientChart(clinicId, input.patientId);
    chartAfter = { ...current, ...seedFromNote(input.note) };
  }

  await saveDentalRecord(clinicId, {
    patientId: input.patientId,
    visitId: input.visitId,
    chiefComplaint: n.chiefComplaint ?? null,
    diagnosis: n.diagnosis ?? null,
    findings,
    proceduresDone,
    chartAfter,
  });
}

/**
 * Per-visit tooth changes for the clinical timeline — keyed by `visitId`, each a
 * list of human lines ("16: Caries → Root canal"). Computed by diffing each record's
 * `chart_after` against the previous frame (baseline first). The baseline itself has
 * no visit, so it seeds the starting state but isn't in the map.
 */
export async function visitChanges(
  clinicId: string,
  patientId: string,
): Promise<Record<string, string[]>> {
  const records = await listDentalRecords(clinicId, patientId);
  // Chronological, baseline first (listDentalRecords returns newest-first).
  const ordered = [...records].sort((a, b) => {
    if (a.isBaseline && !b.isBaseline) return -1;
    if (b.isBaseline && !a.isBaseline) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const out: Record<string, string[]> = {};
  let prev: ChartTeeth = {};
  for (const r of ordered) {
    const after = (r.chartAfter ?? {}) as ChartTeeth;
    if (r.visitId) {
      out[r.visitId] = diffTeeth(prev, after).map((c) => {
        // A visit can change the status, the root-treated state, or both — a root
        // canal on an already-crowned tooth moves no status at all.
        const parts: string[] = [];
        if (c.from !== c.to) {
          parts.push(
            `${c.from ? statusLabel(c.from) : "sound"} → ${c.to ? statusLabel(c.to) : "sound"}`,
          );
        }
        if (c.endoFrom !== c.endoTo) {
          parts.push(c.endoTo ? "root treated" : "root treatment cleared");
        }
        return `${c.tooth}: ${parts.join(", ")}`;
      });
    }
    prev = after;
  }
  return out;
}

/**
 * Save the patient's intake BASELINE (existing conditions, no visit) from the
 * "edit chart" flow, and re-fold the living chart. The module's `saveBaseline`.
 */
export async function saveBaseline(
  clinicId: string,
  patientId: string,
  chart: unknown,
): Promise<void> {
  await saveDentalRecord(clinicId, {
    patientId,
    isBaseline: true,
    visitId: null,
    chartAfter: (chart && typeof chart === "object" ? chart : {}) as ChartTeeth,
  });
}

/** The patient's live records as fold frames, for the pure history/amend logic. */
async function chartFrames(clinicId: string, patientId: string) {
  const records = await listDentalRecords(clinicId, patientId);
  return records.map((r) => ({
    id: r.id,
    visitId: r.visitId,
    isBaseline: r.isBaseline,
    kind: r.kind,
    at: r.createdAt.getTime(),
    chartAfter: (r.chartAfter ?? {}) as ChartTeeth,
  }));
}

/**
 * One tooth's own history, NEWEST FIRST — the module's `itemHistory`. Each entry is
 * already rendered to a human line, so core displays it without knowing it is a
 * tooth, and carries the state after it, so the edit form can be prefilled.
 *
 * Newest first because the question being asked of a chart is almost always "what
 * happened recently", and the tooth on the chart shows the latest entry.
 */
export async function toothHistoryFor(
  clinicId: string,
  patientId: string,
  tooth: string,
): Promise<ChartItemHistoryEntry[]> {
  const entries = toothHistory(await chartFrames(clinicId, patientId), tooth);
  return entries
    .map((e) => ({
      recordId: e.recordId ?? null,
      visitId: e.visitId ?? null,
      at: e.at,
      label: describeToothChange(e.before, e.after),
      source: e.isBaseline ? ("baseline" as const) : e.visitId ? ("visit" as const) : ("treatment" as const),
      state: e.after,
    }))
    .reverse();
}

/**
 * Correct one recorded treatment in place — the module's `editItemRecord`.
 *
 * Updates only this tooth within that record and re-folds, so a record covering
 * several teeth keeps the rest untouched. For fixing what was charted; removing it
 * is `deleteToothRecord`.
 */
export async function editToothRecord(
  clinicId: string,
  patientId: string,
  tooth: string,
  recordId: string,
  state: unknown,
): Promise<{ ok: true } | { error: string }> {
  if (!isToothNumber(tooth)) return { error: "That isn't a tooth." };
  const next = (state && typeof state === "object" ? state : null) as ChartTooth | null;
  if (!next?.status) return { error: "Choose what was done to the tooth." };

  const [row] = await db
    .select({ id: dentalRecords.id, chartAfter: dentalRecords.chartAfter, visitId: dentalRecords.visitId, isBaseline: dentalRecords.isBaseline })
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.id, recordId),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .limit(1);
  if (!row) return { error: "That entry no longer exists." };
  // A visit's record belongs to a clinical note a doctor approved. Editing it from a
  // tooth panel would alter a signed record without anyone opening the visit.
  if (row.visitId || row.isBaseline) return { error: "Only a recorded treatment can be edited here." };

  await db.transaction(async (tx) => {
    await tx
      .update(dentalRecords)
      .set({
        chartAfter: { ...((row.chartAfter ?? {}) as ChartTeeth), [tooth]: next },
        updatedAt: new Date(),
      })
      .where(eq(dentalRecords.id, recordId));
    await recomputeChart(tx, clinicId, patientId);
  });
  return { ok: true };
}

/**
 * Remove one recorded treatment — the module's `deleteItemRecord`.
 *
 * A SOFT delete: the record keeps its row and can be restored, and the chart re-folds
 * from what remains, so the tooth reverts to whatever the other records say. This
 * replaced an earlier design that appended a "correction" record to undo an entry —
 * that left the original in place, needed its own record kind, and let repeated
 * clicks pile up identical no-op rows. Removing the record says what was meant.
 */
export async function deleteToothRecord(
  clinicId: string,
  patientId: string,
  tooth: string,
  recordId: string,
  actorId: string,
): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .select({ visitId: dentalRecords.visitId, isBaseline: dentalRecords.isBaseline })
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.id, recordId),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .limit(1);
  if (!row) return { error: "That entry no longer exists." };
  if (row.visitId) return { error: "This came from a visit. Open the visit to change it." };
  if (row.isBaseline) return { error: "Edit existing conditions to change the intake chart." };

  const ok = await softDeleteDentalRecord(clinicId, recordId, actorId);
  return ok ? { ok: true } : { error: "That entry no longer exists." };
}

/**
 * Record a treatment on ONE tooth, outside any visit — the module's
 * `recordItemTreatment`.
 *
 * Writes its OWN dated record every time, which is the whole point. The intake
 * baseline is a single row that each save overwrites, so charting a filling and then
 * a root canal through it left one entry reading "Sound → Root canal" and the filling
 * was simply gone. A treatment is an event, so it gets a record of its own and the
 * history accumulates.
 *
 * Only the treated tooth is written. The baseline writes the whole chart, which would
 * mean charting one tooth restated all thirty-two.
 */
export async function recordToothTreatment(
  clinicId: string,
  patientId: string,
  tooth: string,
  state: unknown,
): Promise<{ ok: true } | { error: string }> {
  if (!isToothNumber(tooth)) return { error: "That isn't a tooth." };
  const next = (state && typeof state === "object" ? state : null) as ChartTooth | null;
  if (!next?.status) return { error: "Choose what was done to the tooth." };

  const current = (await getPatientChart(clinicId, patientId))[tooth] ?? null;
  // Nothing changed — don't write a record that would read as a treatment.
  if (sameToothState(current, next)) return { error: "That is already this tooth's state." };

  await saveDentalRecord(clinicId, {
    patientId,
    visitId: null,
    isBaseline: false,
    kind: "treatment",
    chartAfter: { [tooth]: next } as ChartTeeth,
  });
  return { ok: true };
}

/** Whole-tooth equality, so a no-op save cannot become a history entry. */
function sameToothState(a: ChartTooth | null, b: ChartTooth | null): boolean {
  if (!a || !b) return isBlankTooth(a) && isBlankTooth(b);
  return (
    a.status === b.status &&
    isRootTreated(a) === isRootTreated(b) &&
    (a.note ?? "") === (b.note ?? "") &&
    [...(a.surfaces ?? [])].sort().join("") === [...(b.surfaces ?? [])].sort().join("")
  );
}

/** "Filled → Crown, root treated" — the human line for one history entry. */
function describeToothChange(before: ChartTooth | null, after: ChartTooth | null): string {
  const name = (t: ChartTooth | null) => (t && !isBlankTooth(t) ? statusLabel(t.status) : "Sound");
  const parts = [`${name(before)} → ${name(after)}`];
  const endoBefore = isRootTreated(before ?? undefined);
  const endoAfter = isRootTreated(after ?? undefined);
  if (endoBefore !== endoAfter) parts.push(endoAfter ? "root treated" : "root treatment cleared");
  const surfaces = after?.surfaces?.length ? after.surfaces.join("") : null;
  if (surfaces) parts.push(`surfaces ${surfaces}`);
  if ((after?.note ?? "") !== (before?.note ?? "") && after?.note?.trim()) {
    parts.push(`note "${after.note.trim()}"`);
  }
  return parts.join(", ");
}

/** Soft-delete a dental record and re-fold the chart (correction / discard). */
export async function softDeleteDentalRecord(
  clinicId: string,
  recordId: string,
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: dentalRecords.id, patientId: dentalRecords.patientId })
      .from(dentalRecords)
      .where(
        byClinic(
          dentalRecords.clinicId,
          clinicId,
          notDeleted(dentalRecords.deletedAt),
          eq(dentalRecords.id, recordId),
        ),
      )
      .limit(1);
    if (!row) return false;
    await tx
      .update(dentalRecords)
      .set(softDeleteValues(actorId, newDeleteGroup()))
      .where(and(eq(dentalRecords.clinicId, clinicId), eq(dentalRecords.id, recordId)));
    await recomputeChart(tx, clinicId, row.patientId);
    return true;
  });
}

// ─── Trash provider ─────────────────────────────────────────────────────────

/**
 * The module's Trash bundle. `/core` never imports a dental table, so the module
 * produces its own trashed rows and the app layer hands them to the core Trash.
 *
 * Only DIRECTLY deleted records are listed: a record hidden because its patient or
 * visit was trashed carries `deleted_by_cascade`, and is restored with that parent
 * rather than on its own — the same rule every core entity follows.
 */
export const dentalTrash: ModuleTrash = {
  async list(scope) {
    const where: (SQL | undefined)[] = [
      isNotNull(dentalRecords.deletedAt),
      eq(dentalRecords.deletedByCascade, false),
    ];
    if (scope.kind === "clinic") {
      where.push(eq(dentalRecords.clinicId, scope.clinicId), gte(dentalRecords.deletedAt, scope.cutoff));
    } else if (scope.clinicId) {
      where.push(eq(dentalRecords.clinicId, scope.clinicId));
    }

    const rows = await db
      .select({
        id: dentalRecords.id,
        group: dentalRecords.deleteGroup,
        clinicId: dentalRecords.clinicId,
        deletedAt: dentalRecords.deletedAt,
        deletedBy: dentalRecords.deletedBy,
        chartAfter: dentalRecords.chartAfter,
        patientName: patients.fullName,
      })
      .from(dentalRecords)
      .leftJoin(patients, eq(dentalRecords.patientId, patients.id))
      .where(and(...where))
      .orderBy(desc(dentalRecords.deletedAt));

    return rows.map((r) => {
      // Name the teeth it covered, so a row in Trash says what it was.
      const teeth = Object.keys((r.chartAfter ?? {}) as ChartTeeth);
      const what = teeth.length
        ? `${teeth.length === 1 ? "Tooth" : "Teeth"} ${teeth.sort().join(", ")}`
        : "Chart entry";
      return {
        id: r.id,
        group: r.group ?? r.id,
        label: r.patientName ? `${r.patientName} · ${what.toLowerCase()}` : what,
        detail: describeTrashedRecord((r.chartAfter ?? {}) as ChartTeeth),
        clinicId: r.clinicId,
        deletedAt: r.deletedAt as Date,
        deletedById: r.deletedBy,
      };
    });
  },

  async restore(group, clinicId) {
    const rows = await db
      .update(dentalRecords)
      .set(restoreValues())
      .where(
        clinicId
          ? and(eq(dentalRecords.deleteGroup, group), eq(dentalRecords.clinicId, clinicId))
          : eq(dentalRecords.deleteGroup, group),
      )
      .returning({ clinicId: dentalRecords.clinicId, patientId: dentalRecords.patientId });

    // The living chart is derived, so it has to be re-folded for every patient the
    // restore touched or the record would be back without being on the chart.
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.clinicId}:${r.patientId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await db.transaction((tx) => recomputeChart(tx, r.clinicId, r.patientId));
    }
  },

  async purge(group) {
    await db.delete(dentalRecords).where(eq(dentalRecords.deleteGroup, group));
  },
};

/** "Crown, root treated" — what a trashed record said, for the Trash row's detail. */
function describeTrashedRecord(chart: ChartTeeth): string | null {
  const states = Object.values(chart);
  if (!states.length) return null;
  return states
    .map((t) => `${statusLabel(t.status)}${isRootTreated(t) ? ", root treated" : ""}`)
    .join("; ");
}
