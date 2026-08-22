"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { appointments, clinics, patients, visits } from "@/core/db/schema";
import { draftAccessCondition } from "@/core/clinical/drafts";
import { getScribeRunStatus, retryScribeRun, runScribeJob } from "@/core/ai/scribe-job";
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

  const [appt] = await db
    .select({ doctorId: appointments.doctorId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        user.clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt || appt.doctorId !== user.id) return; // only your own patients

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
  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
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
export async function loadDraft(visitId: string): Promise<{
  visitId: string;
  transcript: string;
  note: Record<string, unknown>;
  drugWarnings: string[];
  allergyWarnings: string[];
  patient: { id: string; fullName: string; phone: string | null };
} | null> {
  const user = await requireWorkspace();
  if (!can(user, "clinical", "create")) return null;
  const canHandover = can(user, "handover", "view");

  const [row] = await db
    .select({
      id: visits.id,
      transcript: visits.transcript,
      note: visits.note,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      byClinic(
        visits.clinicId,
        user.clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "draft"),
        draftAccessCondition(user.id, canHandover),
      ),
    )
    .limit(1);
  if (!row) return null;

  const note = (row.note ?? {}) as Record<string, unknown>;

  // Warnings aren't stored on the visit, so recompute them against the formulary and
  // the patient's allergies as they stand NOW — a drug the clinic has since removed,
  // or an allergy recorded after the dictation, has to show before this is approved.
  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const allergies = await getPatientAllergies(user.clinicId, row.patientId);
  const { drugWarnings, allergyWarnings } = noteWarnings(
    note,
    getClinicWorkspace(clinicRow?.modulesEnabled ?? []).drugFormulary,
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
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  // Approving finalises a clinical note — an authoring action.
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to save clinical notes." };
  }

  // BOTH arguments come straight from the browser and both land in `jsonb`. This is
  // the moment a draft becomes the legal record, so it is the one place that must not
  // trust its input: without this, arbitrary client-supplied structure (and any
  // amount of it) was written into a medical note. Validation follows the CLINIC's
  // enabled module — core never names a specialty (ADR-007, CLAUDE.md §9).
  //
  // WHY THIS CAN'T STRAND EXISTING RECORDS: this is the ONLY writer of `visits.note`,
  // and it only matches `status = 'draft'`, so an already-approved note is never
  // re-validated — nothing in the archive can be made unsaveable by tightening the
  // shape. The exposure is limited to open drafts, and a draft that somehow can't
  // satisfy the schema can still be discarded (`discardDraft` takes no note) and
  // re-dictated. The schema is also permissive by construction: only the fields the
  // app actually reads are type-checked.
  // One lookup, used twice: to pick the validation shapes here, and the clinical
  // record contract further down.
  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const modulesEnabled = clinicRow?.modulesEnabled ?? [];
  const schemas = clinicalSchemasFor(modulesEnabled);

  const parsedNote = parseClinicalNote(note, schemas.noteSchema);
  if (!parsedNote.ok) return { error: parsedNote.error };
  const parsedChart = parseClinicalChart(chart, schemas.chartSchema);
  if (!parsedChart.ok) return { error: parsedChart.error };

  const [updated] = await db
    .update(visits)
    .set({
      note: parsedNote.value,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        visits.clinicId,
        user.clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "draft"),
        // AUTHOR ONLY, plus the narrow `handover` exception. A draft belongs to
        // whoever dictated it (CLAUDE.md §8) — the same condition `loadDraft` applies
        // when opening one. Without it, anyone holding `clinical:create` could sign
        // off a colleague's note, and the record would then carry THEIR name in
        // `approved_by` over someone else's clinical judgement. The one relaxation is
        // an author who can no longer log in: that is not a colleague being
        // overridden, it is a note nobody could otherwise ever reach (D-18). The
        // dictating author stays on `doctor_id`, so the record still says who saw
        // the patient and who signed.
        draftAccessCondition(user.id, can(user, "handover", "create")),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, module: visits.module });

  // One query, so "not yours" and "not there" are indistinguishable here — say both
  // rather than a misleading "not found" to someone looking at a real draft.
  if (!updated) return { error: "Draft not found, or it belongs to another clinician." };

  // Persist the specialty structured record + fold the living chart (e.g. the dental
  // odontogram), via the enabled module's contract. App-level resolution, like the
  // recall capture below — core stays specialty-agnostic. Best-effort: the chart is
  // always recomputable, so a hiccup here must not fail the approval.
  try {
    const clinicalRecord = clinicalRecordFor(modulesEnabled);
    if (clinicalRecord) {
      await clinicalRecord.saveRecord(user.clinicId, {
        visitId,
        patientId: updated.patientId,
        note: parsedNote.value,
        // The doctor's confirmed chart from the in-scribe editor (else the module
        // derives it from the note). Validated above.
        chart: parsedChart.value,
      });
    }
  } catch (e) {
    // Non-fatal — the chart can be rebuilt from records later. Still CLINICAL data
    // that did not persist when the doctor pressed Approve, so it must be visible.
    report(e, {
      op: "clinical.saveModuleRecord",
      clinicId: user.clinicId,
      userId: user.id,
      ids: { visitId, patientId: updated.patientId, module: updated.module },
    });
  }

  // Capture a recall from the note's nextVisit ({ reason, afterDays }) — the
  // scribe extracts it; approving schedules it (CLAUDE.md §10). Reading the note
  // shape is fine here (app-level), not in /core.
  const nextVisit = parsedNote.value.nextVisit;
  if (nextVisit && typeof nextVisit === "object") {
    const nv = nextVisit as { reason?: unknown; afterDays?: unknown };
    const afterDays = Number(nv.afterDays);
    if (Number.isFinite(afterDays) && afterDays > 0) {
      await scheduleRecall({
        clinicId: user.clinicId,
        patientId: updated.patientId,
        sourceVisitId: visitId,
        module: updated.module,
        reason: typeof nv.reason === "string" ? nv.reason : null,
        afterDays,
      });
    }
  }

  revalidatePath("/clinic/scribe");
  revalidatePath("/doctor");
  return { ok: true };
}

/** Discard a draft you don't want to keep. Soft delete, so it lands in Trash. */
export async function discardDraft(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to modify clinical drafts." };
  }

  const result = await db
    .update(visits)
    .set(softDeleteValues(user.id, newDeleteGroup()))
    .where(
      byClinic(
        visits.clinicId,
        user.clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        // `failed` too (D-08): a run the AI could not complete leaves a real row with
        // a real recording, and the doctor must be able to bin it. `transcribing` is
        // deliberately NOT here — binning a run mid-flight would leave the job about
        // to write a note onto a soft-deleted visit.
        inArray(visits.status, ["draft", "failed"]),
        // AUTHOR ONLY — same rule as approving, and the same narrow `handover`
        // exception. Discarding is the more destructive of the two: it bins work
        // someone else dictated and has not yet reviewed. It still soft-deletes, so a
        // stranded draft binned by mistake is recoverable from Trash.
        draftAccessCondition(user.id, can(user, "handover", "delete")),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) {
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
  const q = query.trim();

  const { patients } = await import("@/core/db/schema");
  const { ilike, or, and: and2, desc } = await import("drizzle-orm");

  return db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
    })
    .from(patients)
    .where(
      q
        ? and2(
            eq(patients.clinicId, user.clinicId),
            notDeleted(patients.deletedAt),
            or(
              ilike(patients.fullName, `%${q}%`),
              ilike(patients.phone, `%${q}%`),
            ),
          )
        : and2(
            eq(patients.clinicId, user.clinicId),
            notDeleted(patients.deletedAt),
          ),
    )
    .orderBy(desc(patients.createdAt))
    .limit(20);
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

  const [row] = await db
    .select({
      clinicId: visits.clinicId,
      status: visits.status,
      patientId: visits.patientId,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      clinicName: clinics.name,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .innerJoin(clinics, eq(visits.clinicId, clinics.id))
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        notDeleted(visits.deletedAt),
      ),
    )
    .limit(1);

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
    templateParams: [row.patientName, row.clinicName],
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
  if (!can(user, "clinical", "create")) return null;
  return getScribeRunStatus(user.clinicId, user.id, visitId);
}

/** Retry a FAILED run on the audio already stored — no re-dictation (delta D-08). */
export async function retryScribe(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace();
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to modify clinical drafts." };
  }
  const r = await retryScribeRun(user.clinicId, user.id, visitId);
  if ("error" in r) return r;
  // Kick it off now; the recovery sweep is the backstop if this process dies.
  after(() => runScribeJob(visitId));
  revalidatePath("/clinic/scribe");
  return { ok: true };
}
