import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { clinicalNoteVersions, prescriptions, recalls, users, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { createPrescriptionFromVisit } from "@/core/patients/prescriptions";
import { MAX_PRESCRIPTION_ITEMS } from "@/core/lib/prescription-items";
import { medicineItems, nextVisitOf } from "@/core/clinical/note-edit-rules";

/**
 * Editing a SAVED clinical note (owner, 2026-11-19) — dictated or typed, by anyone in
 * the clinic holding `clinical:edit`. The action checks the permission and validates
 * the note; this module owns the rows.
 *
 * Only an APPROVED note is edited here. A draft, a note waiting for its doctor and a
 * returned one each have their own path (review, approve, resubmit), and an imported
 * note is the old system's record, kept as it came.
 */

const editor = alias(users, "note_editor");

/** A saved note to edit: its current text and what the form needs to show. */
export async function loadSavedNote(clinicId: string, visitId: string) {
  const [row] = await db
    .select({
      id: visits.id,
      patientId: visits.patientId,
      note: visits.note,
      visitDate: visits.visitDate,
      imported: visits.imported,
      editedAt: visits.editedAt,
      editedByName: editor.fullName,
      editedByPrefix: editor.prefix,
    })
    .from(visits)
    .leftJoin(editor, eq(editor.id, visits.editedBy))
    .where(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.id, visitId), eq(visits.status, "approved")))
    .limit(1);
  if (!row || row.imported) return null;
  return row;
}

/**
 * Replace a saved note's text, keeping the one it replaces. One transaction, and the
 * row is locked while it runs, so two people saving at once each keep the other's
 * version rather than one silently disappearing.
 */
export async function replaceSavedNote(
  clinicId: string,
  visitId: string,
  note: Record<string, unknown>,
  by: { id: string; name: string },
): Promise<{ patientId: string; module: string | null; before: Record<string, unknown> | null; base: Date } | null> {
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({
        patientId: visits.patientId,
        module: visits.module,
        note: visits.note,
        imported: visits.imported,
        approvedAt: visits.approvedAt,
        visitDate: visits.visitDate,
      })
      .from(visits)
      .where(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.id, visitId), eq(visits.status, "approved")))
      .for("update")
      .limit(1);
    if (!cur || cur.imported) return null;
    const now = new Date();
    await tx.insert(clinicalNoteVersions).values({
      clinicId,
      visitId,
      note: cur.note,
      editedBy: by.id,
      editedByName: by.name,
      editedAt: now,
    });
    await tx
      .update(visits)
      .set({ note, editedAt: now, editedBy: by.id, updatedAt: now })
      .where(byClinic(visits.clinicId, clinicId, eq(visits.id, visitId)));
    return { patientId: cur.patientId, module: cur.module, before: cur.note, base: cur.approvedAt ?? cur.visitDate };
  });
}

/**
 * After the medicines of a saved note were edited, the patient's prescription made
 * from it follows (it is the same prescription, 2026-11-18):
 *   • still live → its lines become the note's (all removed → it goes to Trash);
 *   • never made (the note had no medicines) → made now;
 *   • deleted by someone → left deleted: that was a decision about the prescription,
 *     and editing the note does not overrule it.
 */
export async function syncPrescriptionWithNote(
  clinicId: string,
  visitId: string,
  note: Record<string, unknown>,
  actor: { id: string; name: string },
): Promise<"updated" | "created" | "removed" | "kept-deleted" | "none"> {
  const [rx] = await db
    .select({ id: prescriptions.id, deletedAt: prescriptions.deletedAt })
    .from(prescriptions)
    .where(byClinic(prescriptions.clinicId, clinicId, eq(prescriptions.visitId, visitId)))
    .limit(1);
  const items = medicineItems(note.prescriptions).slice(0, MAX_PRESCRIPTION_ITEMS);
  if (!rx) {
    if (items.length === 0) return "none";
    return (await createPrescriptionFromVisit(clinicId, visitId, actor)) ? "created" : "none";
  }
  if (rx.deletedAt) return "kept-deleted";
  const now = new Date();
  if (items.length === 0) {
    await db
      .update(prescriptions)
      .set({ ...softDeleteValues(actor.id, newDeleteGroup()), updatedAt: now })
      .where(byClinic(prescriptions.clinicId, clinicId, notDeleted(prescriptions.deletedAt), eq(prescriptions.id, rx.id)));
    return "removed";
  }
  await db
    .update(prescriptions)
    .set({ items, updatedAt: now })
    .where(byClinic(prescriptions.clinicId, clinicId, notDeleted(prescriptions.deletedAt), eq(prescriptions.id, rx.id)));
  return "updated";
}

/**
 * After the next visit of a saved note was edited, the recall it scheduled follows,
 * counted from when the note was first saved (not from the edit — "review in 6
 * months" means six months from that visit):
 *   • a recall still waiting → moved to the new date and reason, or cancelled when
 *     the next visit was cleared;
 *   • none was ever made → made now;
 *   • one already sent → left alone; the patient has had that message.
 */
export async function syncRecallWithNote(
  clinicId: string,
  v: { visitId: string; patientId: string; module: string | null; base: Date },
  note: Record<string, unknown>,
): Promise<"moved" | "cancelled" | "created" | "left" | "none"> {
  const next = nextVisitOf(note);
  const rows = await db
    .select({ id: recalls.id, status: recalls.status })
    .from(recalls)
    .where(byClinic(recalls.clinicId, clinicId, notDeleted(recalls.deletedAt), eq(recalls.sourceVisitId, v.visitId)))
    .orderBy(desc(recalls.createdAt));
  const pending = rows.find((r) => r.status === "pending");
  const now = new Date();
  if (pending) {
    if (!next) {
      await db
        .update(recalls)
        .set({ status: "cancelled", updatedAt: now })
        .where(byClinic(recalls.clinicId, clinicId, eq(recalls.id, pending.id), eq(recalls.status, "pending")));
      return "cancelled";
    }
    await db
      .update(recalls)
      .set({ dueAt: new Date(v.base.getTime() + next.afterDays * 86_400_000), reason: next.reason, updatedAt: now })
      .where(byClinic(recalls.clinicId, clinicId, eq(recalls.id, pending.id), eq(recalls.status, "pending")));
    return "moved";
  }
  if (rows.length > 0) return "left";
  if (!next) return "none";
  await db.insert(recalls).values({
    clinicId,
    patientId: v.patientId,
    sourceVisitId: v.visitId,
    module: v.module,
    reason: next.reason,
    dueAt: new Date(v.base.getTime() + next.afterDays * 86_400_000),
    status: "pending",
  });
  return "created";
}

/** The earlier texts of a saved note, newest first (who replaced each, and when). */
export async function listNoteVersions(clinicId: string, visitId: string) {
  return db
    .select({
      id: clinicalNoteVersions.id,
      note: clinicalNoteVersions.note,
      editedByName: clinicalNoteVersions.editedByName,
      editedAt: clinicalNoteVersions.editedAt,
    })
    .from(clinicalNoteVersions)
    .innerJoin(visits, and(eq(visits.id, clinicalNoteVersions.visitId), isNull(visits.deletedAt)))
    .where(byClinic(clinicalNoteVersions.clinicId, clinicId, eq(clinicalNoteVersions.visitId, visitId)))
    .orderBy(desc(clinicalNoteVersions.editedAt));
}

/**
 * Move a SAVED note to Trash (owner, 2026-11-20) — dictated or typed, imported too.
 * One delete group carries the note, the prescription made from it and its recall
 * still waiting, so Restore brings back exactly that batch and a deleted note never
 * leaves a prescription or a reminder behind it. A recall already sent stays (the
 * patient had the message), and a prescription someone deleted earlier keeps its own
 * group. The tooth chart is left as it is — like an edit, it has its own editor.
 */
export async function trashSavedNote(
  clinicId: string,
  visitId: string,
  actorId: string,
): Promise<{ patientId: string; prescription: boolean; recalls: number } | null> {
  return db.transaction(async (tx) => {
    const group = newDeleteGroup();
    const [v] = await tx
      .update(visits)
      .set(softDeleteValues(actorId, group))
      .where(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.id, visitId), eq(visits.status, "approved")))
      .returning({ patientId: visits.patientId });
    if (!v) return null;
    const rx = await tx
      .update(prescriptions)
      .set(softDeleteValues(actorId, group, true))
      .where(byClinic(prescriptions.clinicId, clinicId, notDeleted(prescriptions.deletedAt), eq(prescriptions.visitId, visitId)))
      .returning({ id: prescriptions.id });
    const rc = await tx
      .update(recalls)
      .set(softDeleteValues(actorId, group, true))
      .where(byClinic(recalls.clinicId, clinicId, notDeleted(recalls.deletedAt), eq(recalls.sourceVisitId, visitId), eq(recalls.status, "pending")))
      .returning({ id: recalls.id });
    return { patientId: v.patientId, prescription: rx.length > 0, recalls: rc.length };
  });
}
