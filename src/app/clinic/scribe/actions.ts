"use server";

import { medicineFormulary } from "@/core/clinical/medicines";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import {
  approveDraftRow,
  createTypedNote,
  discardDraftRow,
  getAppointmentDoctorId,
  getVisitForPrescription,
  loadDraftRow,
  patientBelongsToClinic,
  searchScribePatients,
} from "@/core/clinical/scribe";
import { logActivity } from "@/core/audit/log";
import { notify } from "@/core/notifications/in-app";
import {
  approveWaitingNoteRow,
  discardReturnedNoteRow,
  loadNoteForReview,
  noteNeedsTreatingApproval,
  resolveTreatingDoctor,
  resubmitReturnedNoteRow,
  returnWaitingNoteRow,
} from "@/core/clinical/note-approval";
import { getScribeRunStatus, retryScribeRun, runScribeJob } from "@/core/ai/scribe-job";
import { scribeModuleConfig } from "@/config/module-scribe";
import { after } from "next/server";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import type { AppointmentStatus } from "@/core/appointments/status";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import { serverEnv } from "@/core/lib/env";
import { isPublicLinkingEnabled, signToken } from "@/core/lib/signed-link";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { scheduleRecall } from "@/core/recall";
import { clinicalRecordFor, clinicalSchemasFor, getClinicWorkspace } from "@/config/modules";
import { parseClinicalChart, parseClinicalNote } from "@/core/clinical/note-schema";
import { getPatientAllergies } from "@/core/patients/medical-history";
import { noteWarnings } from "@/core/ai/note-warnings";
import { report } from "@/core/observability";
import { createPrescriptionFromVisit } from "@/core/patients/prescriptions";
import { displayStaffName } from "@/core/types/auth";

/**
 * Scribe actions — CLAUDE.md §8: AI output is a DRAFT until a clinician approves it.
 * Every query is scoped to the caller's own clinic_id.
 *
 * Authorization is the PERMISSION, not the role. These used to demand
 * `requireRole("doctor")`, a strict equality check, while the page that calls them
 * (`/clinic/scribe`) admits the whole workspace — so a clinic admin, who holds every
 * permission by default, could record a note and then be silently redirected when
 * they pressed Approve, stranding the draft forever. In this market the clinic owner
 * usually IS the practising dentist, so the role was the wrong question to ask.
 * `requireWorkspace()` establishes the clinic; `can()` decides what may be done.
 */

/**
 * Advance your OWN queue patient: Call in (→ in_progress) or Complete (→ completed).
 * Authorization is ownership — the appointment must be assigned to the signed-in
 * user — so no extra `appointments:edit` grant is needed to run your own room, and
 * an owner-dentist seeing patients under their own name gets the same controls.
 * The shared transition records the sale on completion. Clinic-scoped.
 */
export async function advanceMyQueue(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<void> {
  const user = await requireWorkspace();
  // A doctor may only push a patient forward through the two in-room states.
  if (status !== "in_progress" && status !== "completed") return;

  const apptDoctorId = await getAppointmentDoctorId(user.clinicId, appointmentId);
  if (apptDoctorId !== user.id) return; // only your own patients (undefined = not here)

  const changed = await applyAppointmentStatus(user.clinicId, appointmentId, status);
  if (changed) {
    revalidatePath("/doctor");
    revalidatePath("/clinic");
    // Completing a visit realises revenue + shares — refresh the finance views.
    if (status === "completed") revalidateFinance();
  }
}

/**
 * The patient's current specialty chart (e.g. the dental odontogram), for the
 * in-scribe editor. Module-agnostic; gated by `clinical:view`. Null when no chart.
 */
export async function loadPatientChart(patientId: string): Promise<unknown> {
  const user = await requireWorkspace();
  if (!can(user, "clinical", "view")) return null;
  const clinicRow = await getClinic(user.clinicId);
  const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  return clinicalRecord ? clinicalRecord.loadChart(user.clinicId, patientId) : null;
}

/**
 * Reopen one of your own unapproved drafts for review.
 *
 * A scribe session that ends before approval (tab closed, called away) leaves the
 * draft in the database with nothing pointing at it — approve and discard both act
 * on whatever the workspace happens to be holding in memory. This is the way back
 * in: it returns the same shape the scribe route returns, so the existing review
 * screen can pick the draft up as though it had just been dictated.
 *
 * Own drafts only. An unapproved note belongs to whoever dictated it until they sign
 * it off, so nobody else can open, edit or approve it — not another doctor, and not
 * the clinic admin. Returns null if it is not yours, already approved, or discarded.
 *
 * ONE exception (delta D-18): a caller holding `handover:view` may also open a draft
 * whose author can no longer log in. Without it those drafts are unreachable by
 * everyone and their clinical content is silently lost — see `draftAccessCondition`.
 */
/**
 * The clinic's voice scribe is switched on. Checked by every authoring step, not just
 * hidden in the UI: a draft open in a tab when the account manager turns it off must
 * not be approved, discarded or re-run (a re-run is paid). `getClinic` is
 * request-cached, so this costs no extra query on a page that already read the clinic.
 */
async function voiceScribeOn(clinicId: string): Promise<boolean> {
  const clinic = await getClinic(clinicId);
  return clinicHasFeature(clinic?.featuresEnabled, "voice_scribe");
}

const SCRIBE_OFF = "Voice scribe is switched off for this clinic.";

export async function loadDraft(visitId: string): Promise<{
  visitId: string;
  transcript: string;
  note: Record<string, unknown>;
  drugWarnings: string[];
  allergyWarnings: string[];
  patient: { id: string; fullName: string; phone: string | null };
} | null> {
  const user = await requireWorkspace();
  if (!can(user, "scribe", "create")) return null;
  if (!(await voiceScribeOn(user.clinicId))) return null;
  const canHandover = can(user, "handover", "view");

  const row = await loadDraftRow(user.clinicId, user.id, visitId, canHandover);
  if (!row) return null;

  const note = (row.note ?? {}) as Record<string, unknown>;

  // Warnings aren't stored on the visit, so recompute them against the formulary and
  // the patient's allergies as they stand NOW — a drug the clinic has since removed,
  // or an allergy recorded after the dictation, has to show before this is approved.
  const clinicRow = await getClinic(user.clinicId);
  const allergies = await getPatientAllergies(user.clinicId, row.patientId);
  // The module's formulary plus the medicine lists (2026-10-19), so a medicine the
  // super admin or this clinic has listed is not flagged as unknown.
  const { drugWarnings, allergyWarnings } = noteWarnings(
    note,
    [
      ...getClinicWorkspace(clinicRow?.modulesEnabled ?? []).drugFormulary,
      ...(await medicineFormulary(user.clinicId)),
    ],
    allergies,
  );

  return {
    visitId: row.id,
    transcript: row.transcript ?? "",
    note,
    drugWarnings,
    allergyWarnings,
    patient: {
      id: row.patientId,
      fullName: row.patientName,
      phone: row.patientPhone,
    },
  };
}

/** Approve a draft: save the (edited) note + chart and mark it approved. */
export async function approveVisit(
  visitId: string,
  note: Record<string, unknown>,
  chart?: unknown,
): Promise<{ ok: true; waiting?: boolean } | { error: string }> {
  const user = await requireWorkspace();
  // Approving the AI's draft is part of the voice scribe (`scribe:create`); writing a
  // note by hand is `clinical:create` — see saveTypedNote.
  if (!can(user, "scribe", "create")) {
    return { error: "You don't have permission to use the voice scribe." };
  }
  if (!(await voiceScribeOn(user.clinicId))) return { error: SCRIBE_OFF };

  // BOTH arguments come straight from the browser and both land in `jsonb`. This is
  // the moment a draft becomes the legal record, so it is the one place that must not
  // trust its input: without this, arbitrary client-supplied structure (and any
  // amount of it) was written into a medical note. Validation follows the CLINIC's
  // enabled module — core never names a specialty (ADR-007, CLAUDE.md §9).
  //
  // WHY THIS CAN'T STRAND EXISTING RECORDS: this only matches `status = 'draft'` (the
  // other writer, a typed note, only INSERTS a new row), so an already-approved note is never
  // re-validated — nothing in the archive can be made unsaveable by tightening the
  // shape. The exposure is limited to open drafts, and a draft that somehow can't
  // satisfy the schema can still be discarded (`discardDraft` takes no note) and
  // re-dictated. The schema is also permissive by construction: only the fields the
  // app actually reads are type-checked.
  // One lookup, used twice: to pick the validation shapes here, and the clinical
  // record contract further down.
  const clinicRow = await getClinic(user.clinicId);
  const modulesEnabled = clinicRow?.modulesEnabled ?? [];
  const schemas = clinicalSchemasFor(modulesEnabled);

  const parsedNote = parseClinicalNote(note, schemas.noteSchema);
  if (!parsedNote.ok) return { error: parsedNote.error };
  const parsedChart = parseClinicalChart(chart, schemas.chartSchema);
  if (!parsedChart.ok) return { error: parsedChart.error };

  // Recorded for another doctor's patient: once its author approves the AI's draft it
  // may still wait for that doctor (note-approval.ts), holding its chart change.
  const draftRow = await loadDraftRow(user.clinicId, user.id, visitId, can(user, "handover", "view"));
  const waits = draftRow ? await noteNeedsTreatingApproval(user.clinicId, draftRow.treatingDoctorId, user.id) : false;

  const updated = await approveDraftRow(
    user.clinicId,
    user.id,
    visitId,
    parsedNote.value,
    can(user, "handover", "create"),
    waits ? { pendingChart: parsedChart.value ?? null } : null,
  );

  // One query, so "not yours" and "not there" are indistinguishable here — say both
  // rather than a misleading "not found" to someone looking at a real draft.
  if (!updated) return { error: "Draft not found, or it belongs to another clinician." };

  if (waits && draftRow?.treatingDoctorId) {
    await askTreatingDoctor(user, draftRow.treatingDoctorId, visitId, updated.patientId);
    revalidatePath("/clinic/scribe");
    return { ok: true, waiting: true };
  }

  await finishApprovedNote(user, {
    visitId,
    patientId: updated.patientId,
    module: updated.module,
    modulesEnabled,
    note: parsedNote.value,
    chart: parsedChart.value,
  });

  revalidatePath("/clinic/scribe");
  revalidatePath("/doctor");
  return { ok: true };
}

/**
 * What happens once a note counts — the same for an approved AI draft and a typed
 * note, so the two can never drift: the specialty record and chart, the note's
 * medicines as a printable prescription, and a recall from its next visit.
 */
async function finishApprovedNote(
  user: Awaited<ReturnType<typeof requireWorkspace>>,
  v: {
    visitId: string;
    patientId: string;
    module: string | null;
    modulesEnabled: string[];
    note: Record<string, unknown>;
    chart: unknown;
  },
): Promise<void> {
  // Persist the specialty structured record + fold the living chart (e.g. the dental
  // odontogram), via the enabled module's contract. App-level resolution, like the
  // recall capture below — core stays specialty-agnostic. Best-effort: the chart is
  // always recomputable, so a hiccup here must not fail the approval.
  try {
    const clinicalRecord = clinicalRecordFor(v.modulesEnabled);
    if (clinicalRecord) {
      await clinicalRecord.saveRecord(user.clinicId, {
        visitId: v.visitId,
        patientId: v.patientId,
        note: v.note,
        // The doctor's chart from the in-scribe editor, sent only when they changed
        // it; without it the module keeps the patient's chart as it was. Validated above.
        chart: v.chart,
      });
    }
  } catch (e) {
    // Non-fatal — the chart can be rebuilt from records later. Still CLINICAL data
    // that did not persist when the doctor pressed Approve, so it must be visible.
    report(e, {
      op: "clinical.saveModuleRecord",
      clinicId: user.clinicId,
      userId: user.id,
      ids: { visitId: v.visitId, patientId: v.patientId, module: v.module },
    });
  }

  // The note's medicines become a prescription the desk can print (with or without
  // the letterhead), download, edit and delete — the signed note is not touched
  // (owner's call, 2026-10-24). Best-effort: a failure here must not undo an approval,
  // but a doctor would look for that prescription, so it is reported.
  try {
    await createPrescriptionFromVisit(user.clinicId, v.visitId, {
      id: user.id,
      name: displayStaffName(user.prefix, user.fullName, user.username),
    });
  } catch (e) {
    report(e, { op: "clinical.prescriptionFromNote", clinicId: user.clinicId, ids: { visitId: v.visitId } });
  }

  // Capture a recall from the note's nextVisit ({ reason, afterDays }) — the
  // scribe extracts it; approving schedules it (CLAUDE.md §10). Reading the note
  // shape is fine here (app-level), not in /core.
  const nextVisit = v.note.nextVisit;
  if (nextVisit && typeof nextVisit === "object") {
    const nv = nextVisit as { reason?: unknown; afterDays?: unknown };
    const afterDays = Number(nv.afterDays);
    if (Number.isFinite(afterDays) && afterDays > 0) {
      await scheduleRecall({
        clinicId: user.clinicId,
        patientId: v.patientId,
        sourceVisitId: v.visitId,
        module: v.module,
        reason: typeof nv.reason === "string" ? nv.reason : null,
        afterDays,
      });
    }
  }
}

/**
 * Write a clinical note by hand (owner, 2026-11-14) — with the voice scribe switched
 * off, or a doctor who would rather type. `clinical:create`, not `scribe:create`: no
 * recording, no AI, so it is stored approved and signed by its author in one step.
 * Validated against the enabled module's note and chart shapes like an approval, and
 * finished the same way (chart, prescription, recall).
 *
 * The allergy and medicine checks the scribe's review shows run here too; a note that
 * trips one comes back with them, and is saved only once the clinician confirms.
 */
export async function saveTypedNote(
  patientId: string,
  note: Record<string, unknown>,
  chart: unknown,
  confirmWarnings: boolean,
  /** The appointment it is for (it then belongs to that appointment's doctor), or —
   *  with none — the doctor whose patient it is (default: the author). */
  forWhom: { appointmentId?: string | null; doctorId?: string | null } = {},
): Promise<{ ok: true; waiting?: boolean } | { error: string } | { warnings: { drugWarnings: string[]; allergyWarnings: string[] } }> {
  const user = await requireWorkspace();
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to write clinical notes." };
  }
  if (typeof patientId !== "string" || !(await patientBelongsToClinic(user.clinicId, patientId))) {
    return { error: "Patient not found." };
  }

  const clinicRow = await getClinic(user.clinicId);
  const modulesEnabled = clinicRow?.modulesEnabled ?? [];
  // The specialty the note belongs to — the same choice the scribe route makes.
  const moduleId = modulesEnabled[0];
  if (!moduleId) return { error: "This clinic has no specialty enabled." };
  const schemas = clinicalSchemasFor(modulesEnabled);
  const parsedNote = parseClinicalNote(note, schemas.noteSchema);
  if (!parsedNote.ok) return { error: parsedNote.error };
  const parsedChart = parseClinicalChart(chart, schemas.chartSchema);
  if (!parsedChart.ok) return { error: parsedChart.error };

  if (!confirmWarnings) {
    const allergies = await getPatientAllergies(user.clinicId, patientId);
    const warnings = noteWarnings(
      parsedNote.value,
      [...getClinicWorkspace(modulesEnabled).drugFormulary, ...(await medicineFormulary(user.clinicId))],
      allergies,
    );
    if (warnings.drugWarnings.length > 0 || warnings.allergyWarnings.length > 0) {
      return { warnings };
    }
  }

  const treating = await resolveTreatingDoctor(user.clinicId, {
    patientId,
    authorId: user.id,
    appointmentId: forWhom.appointmentId ?? null,
    chosenDoctorId: forWhom.doctorId ?? null,
  });
  if ("error" in treating) return { error: treating.error };
  const waits = await noteNeedsTreatingApproval(user.clinicId, treating.treatingDoctorId, user.id);

  const created = await createTypedNote({
    clinicId: user.clinicId,
    patientId,
    authorId: user.id,
    module: moduleId,
    note: parsedNote.value,
    appointmentId: treating.appointmentId,
    treatingDoctorId: treating.treatingDoctorId,
    waitForApproval: waits,
    pendingChart: parsedChart.value ?? null,
  });

  await logActivity({
    action: "create",
    entity: "visit",
    entityId: created.id,
    summary: waits ? "Wrote a clinical note for another doctor's approval" : "Wrote a clinical note",
    metadata: { patientId, typed: true, waiting: waits },
  });

  if (waits) {
    await askTreatingDoctor(user, treating.treatingDoctorId, created.id, patientId);
    revalidatePath("/clinic/scribe");
    revalidatePath(`/clinic/patients/${patientId}`);
    return { ok: true, waiting: true };
  }

  await finishApprovedNote(user, {
    visitId: created.id,
    patientId: created.patientId,
    module: created.module,
    modulesEnabled,
    note: parsedNote.value,
    chart: parsedChart.value,
  });

  revalidatePath("/clinic/scribe");
  revalidatePath(`/clinic/patients/${patientId}`);
  return { ok: true };
}

type WorkspaceUser = Awaited<ReturnType<typeof requireWorkspace>>;

/** Tell the patient's doctor a note waits for them. Best-effort, like every notice. */
async function askTreatingDoctor(user: WorkspaceUser, doctorId: string, visitId: string, patientId: string) {
  try {
    await notify(user.clinicId, doctorId, {
      type: "clinical.note_approval_needed",
      title: "A clinical note is waiting for your approval",
      body: `${displayStaffName(user.prefix, user.fullName, user.username)} wrote a note for your patient.`,
      entity: "visit",
      entityId: visitId,
      link: `/clinic/scribe?review=${visitId}`,
      actor: { userId: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
      metadata: { patientId },
    });
  } catch (e) {
    report(e, { op: "clinical.noteApprovalNotify", clinicId: user.clinicId, ids: { visitId } });
  }
}

/** Approving or sending back is the patient's doctor's, and needs a note grant. */
function mayReviewNotes(user: WorkspaceUser) {
  return can(user, "clinical", "create") || can(user, "scribe", "create");
}

/**
 * Open a note waiting for you (you are the patient's doctor) or one sent back to you
 * (you wrote it), with the allergy and medicine checks as they stand now.
 */
export async function loadNoteToReview(visitId: string): Promise<{
  visitId: string;
  mode: "approve" | "returned";
  note: Record<string, unknown>;
  chart: unknown;
  /** The writer proposed a chart change (it rides with the note until approved). */
  chartProposed: boolean;
  reviewNote: string | null;
  transcript: string | null;
  hasAudio: boolean;
  drugWarnings: string[];
  allergyWarnings: string[];
  patient: { id: string; fullName: string; phone: string | null };
  /** The writer (approve mode) or the patient's doctor (returned mode). */
  otherName: string;
} | null> {
  const user = await requireWorkspace();
  if (!mayReviewNotes(user)) return null;
  if (typeof visitId !== "string") return null;
  const row = await loadNoteForReview(user.clinicId, visitId, user.id);
  if (!row) return null;
  const note = (row.note ?? {}) as Record<string, unknown>;
  const clinicRow = await getClinic(user.clinicId);
  const { drugWarnings, allergyWarnings } = noteWarnings(
    note,
    [...getClinicWorkspace(clinicRow?.modulesEnabled ?? []).drugFormulary, ...(await medicineFormulary(user.clinicId))],
    await getPatientAllergies(user.clinicId, row.patientId),
  );
  const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  // The chart the author proposed, else the patient's chart as it is now.
  const chart = row.pendingChart ?? (clinicalRecord ? await clinicalRecord.loadChart(user.clinicId, row.patientId) : null);
  return {
    visitId: row.id,
    mode: row.status === "pending_approval" ? "approve" : "returned",
    note,
    chart,
    chartProposed: row.pendingChart != null,
    reviewNote: row.reviewNote,
    transcript: row.transcript,
    hasAudio: Boolean(row.hasAudio),
    drugWarnings,
    allergyWarnings,
    patient: { id: row.patientId, fullName: row.patientName, phone: row.patientPhone },
    otherName:
      row.status === "pending_approval"
        ? displayStaffName(row.authorPrefix, row.authorName, row.authorUsername ?? "A colleague")
        : displayStaffName(row.treatingPrefix, row.treatingName, row.treatingUsername ?? "The patient's doctor"),
  };
}

/** The patient's doctor approves a note someone else wrote (with any edits). */
export async function approveWaitingNote(
  visitId: string,
  note: Record<string, unknown>,
  chart?: unknown,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!mayReviewNotes(user)) return { error: "You don't have permission to approve clinical notes." };
  const clinicRow = await getClinic(user.clinicId);
  const modulesEnabled = clinicRow?.modulesEnabled ?? [];
  const schemas = clinicalSchemasFor(modulesEnabled);
  const parsedNote = parseClinicalNote(note, schemas.noteSchema);
  if (!parsedNote.ok) return { error: parsedNote.error };
  const parsedChart = parseClinicalChart(chart, schemas.chartSchema);
  if (!parsedChart.ok) return { error: parsedChart.error };

  const row = await approveWaitingNoteRow(user.clinicId, visitId, user.id, parsedNote.value);
  if (!row) return { error: "Note not found, or it is not waiting for you." };

  await finishApprovedNote(user, {
    visitId,
    patientId: row.patientId,
    module: row.module,
    modulesEnabled,
    note: parsedNote.value,
    chart: parsedChart.value,
  });
  await logActivity({ action: "update", entity: "visit", entityId: visitId, summary: "Approved a clinical note written by a colleague", metadata: { patientId: row.patientId } });
  if (row.authorId && row.authorId !== user.id) {
    try {
      await notify(user.clinicId, row.authorId, {
        type: "clinical.note_approved",
        title: "Your clinical note was approved",
        body: `${displayStaffName(user.prefix, user.fullName, user.username)} approved it.`,
        entity: "visit",
        entityId: visitId,
        link: `/clinic/patients/${row.patientId}#clinical-history`,
        actor: { userId: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
      });
    } catch (e) {
      report(e, { op: "clinical.noteApprovedNotify", clinicId: user.clinicId, ids: { visitId } });
    }
  }
  revalidatePath("/clinic/scribe");
  revalidatePath(`/clinic/patients/${row.patientId}`);
  return { ok: true };
}

/** The patient's doctor sends a note back to whoever wrote it, saying why. */
export async function sendNoteBack(visitId: string, reason: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!mayReviewNotes(user)) return { error: "You don't have permission to review clinical notes." };
  const why = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  if (!why) return { error: "Say what needs changing." };
  const row = await returnWaitingNoteRow(user.clinicId, visitId, user.id, why);
  if (!row) return { error: "Note not found, or it is not waiting for you." };
  await logActivity({ action: "update", entity: "visit", entityId: visitId, summary: "Sent a clinical note back to its author", metadata: { patientId: row.patientId } });
  if (row.authorId) {
    try {
      await notify(user.clinicId, row.authorId, {
        type: "clinical.note_returned",
        title: "A clinical note was sent back to you",
        body: why,
        entity: "visit",
        entityId: visitId,
        link: `/clinic/scribe?review=${visitId}`,
        actor: { userId: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
      });
    } catch (e) {
      report(e, { op: "clinical.noteReturnedNotify", clinicId: user.clinicId, ids: { visitId } });
    }
  }
  revalidatePath("/clinic/scribe");
  return { ok: true };
}

/** The author sends a returned note again, corrected. */
export async function resubmitNote(
  visitId: string,
  note: Record<string, unknown>,
  chart?: unknown,
): Promise<{ ok: true; waiting?: boolean } | { error: string }> {
  const user = await requireWorkspace();
  if (!mayReviewNotes(user)) return { error: "You don't have permission to write clinical notes." };
  const row0 = await loadNoteForReview(user.clinicId, visitId, user.id);
  if (!row0 || row0.status !== "returned") return { error: "Note not found." };
  const clinicRow = await getClinic(user.clinicId);
  const modulesEnabled = clinicRow?.modulesEnabled ?? [];
  const schemas = clinicalSchemasFor(modulesEnabled);
  const parsedNote = parseClinicalNote(note, schemas.noteSchema);
  if (!parsedNote.ok) return { error: parsedNote.error };
  const parsedChart = parseClinicalChart(chart, schemas.chartSchema);
  if (!parsedChart.ok) return { error: parsedChart.error };

  // The doctor may have switched approval off since: then it is signed now.
  const waits = await noteNeedsTreatingApproval(user.clinicId, row0.treatingDoctorId, user.id);
  const row = await resubmitReturnedNoteRow(user.clinicId, visitId, user.id, {
    note: parsedNote.value,
    pendingChart: parsedChart.value ?? null,
    approveNow: !waits,
  });
  if (!row) return { error: "Note not found." };
  if (waits && row.treatingDoctorId) {
    await askTreatingDoctor(user, row.treatingDoctorId, visitId, row.patientId);
  } else {
    await finishApprovedNote(user, {
      visitId,
      patientId: row.patientId,
      module: row.module,
      modulesEnabled,
      note: parsedNote.value,
      chart: parsedChart.value,
    });
  }
  await logActivity({ action: "update", entity: "visit", entityId: visitId, summary: "Corrected a clinical note that was sent back", metadata: { patientId: row.patientId } });
  revalidatePath("/clinic/scribe");
  revalidatePath(`/clinic/patients/${row.patientId}`);
  return { ok: true, waiting: waits };
}

/** The author bins a note that was sent back (Trash). */
export async function discardReturnedNote(visitId: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!mayReviewNotes(user)) return { error: "You don't have permission to write clinical notes." };
  if (!(await discardReturnedNoteRow(user.clinicId, visitId, user.id))) return { error: "Note not found." };
  await logActivity({ action: "delete", entity: "visit", entityId: visitId, summary: "Discarded a clinical note that was sent back" });
  revalidatePath("/clinic/scribe");
  return { ok: true };
}

/** Discard a draft you don't want to keep. Soft delete, so it lands in Trash. */
export async function discardDraft(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!can(user, "scribe", "create")) {
    return { error: "You don't have permission to modify clinical drafts." };
  }
  if (!(await voiceScribeOn(user.clinicId))) return { error: SCRIBE_OFF };

  const discarded = await discardDraftRow(
    user.clinicId,
    user.id,
    visitId,
    can(user, "handover", "delete"),
  );
  if (!discarded) {
    return { error: "Draft not found, or it belongs to another clinician." };
  }
  revalidatePath("/clinic/scribe");
  revalidatePath("/doctor");
  return { ok: true };
}

/** Search this clinic's patients by name/phone for the scribe picker. */
export async function searchPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const user = await requireWorkspace();
  // This was the one action here with no permission check, which did not matter while
  // only a doctor could reach it. Now that the whole workspace can, it needs its own.
  if (!can(user, "patients", "view")) return [];
  return searchScribePatients(user.clinicId, query);
}

/**
 * Sends an approved visit's prescription to the patient over WhatsApp. Builds a
 * signed, expiring public link to the PDF and delivers it via the module-agnostic
 * WhatsApp channel (AiSensy). Every attempt is logged in whatsapp_messages, so
 * even an unconfigured provider leaves an auditable record.
 */
export async function sendPrescriptionToWhatsApp(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!can(user, "prescriptions", "create")) {
    return { error: "You don't have permission to send prescriptions." };
  }

  // The clinic NAME came from a third join purely to label the message; `getClinic`
  // is request-cached, so asking for it separately costs nothing.
  const [row, clinicRow] = await Promise.all([
    getVisitForPrescription(user.clinicId, visitId),
    getClinic(user.clinicId),
  ]);

  if (!row) return { error: "Visit not found." };
  if (row.status !== "approved") return { error: "Approve the visit first." };
  if (!row.patientPhone) return { error: "This patient has no phone number." };
  if (!isPublicLinkingEnabled()) {
    return {
      error:
        "Public links are disabled (set LINK_SIGNING_SECRET to send prescriptions).",
    };
  }

  // 30-day signed link the patient can open from WhatsApp without a login.
  const token = signToken(visitId, Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (!token) return { error: "Could not create a secure link." };
  const url = `${serverEnv.APP_URL}/p/rx/${token}`;

  const result = await sendWhatsAppToPatient({
    clinicId: row.clinicId,
    patientId: row.patientId,
    phone: row.patientPhone,
    campaignName: serverEnv.AISENSY_RX_CAMPAIGN,
    userName: row.patientName,
    // Template body params — map these to your approved AiSensy template.
    templateParams: [row.patientName, clinicRow?.name ?? ""],
    media: { url, filename: "prescription.pdf" },
    body: `Prescription sent to ${row.patientName}`,
  });

  revalidatePath("/clinic/scribe");
  revalidatePath("/doctor");
  return result.ok ? { ok: true } : { error: result.error ?? "Send failed." };
}

/**
 * Poll target while a scribe run is in flight (delta D-08). Author-only and
 * clinic-scoped like every other draft operation — a status is a small leak, but it
 * still tells you a named patient was seen, so it follows the same rule.
 */
export async function getScribeStatus(
  visitId: string,
): Promise<{ status: string; error: string | null } | null> {
  const user = await requireWorkspace();
  if (!can(user, "scribe", "create")) return null;
  return getScribeRunStatus(user.clinicId, user.id, visitId);
}

/** Retry a FAILED run on the audio already stored — no re-dictation (delta D-08). */
export async function retryScribe(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!can(user, "scribe", "create")) {
    return { error: "You don't have permission to modify clinical drafts." };
  }
  if (!(await voiceScribeOn(user.clinicId))) return { error: SCRIBE_OFF };
  const r = await retryScribeRun(user.clinicId, user.id, visitId);
  if ("error" in r) return r;
  // Kick it off now; the recovery sweep is the backstop if this process dies.
  after(() => runScribeJob(visitId, scribeModuleConfig));
  revalidatePath("/clinic/scribe");
  return { ok: true };
}
