"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { appointments, clinics, patients, visits } from "@/core/db/schema";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import type { AppointmentStatus } from "@/core/appointments/status";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import { serverEnv } from "@/core/lib/env";
import { isPublicLinkingEnabled, signToken } from "@/core/lib/signed-link";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { scheduleRecall } from "@/core/recall";
import { clinicalRecordFor, getClinicWorkspace } from "@/config/modules";
import { getPatientAllergies } from "@/core/patients/medical-history";
import { noteWarnings } from "@/core/ai/note-warnings";

/**
 * Doctor actions on scribe drafts — CLAUDE.md §8: AI output is a DRAFT until the
 * doctor approves it. All queries are scoped to the doctor's own clinic_id.
 */

/**
 * Advance the doctor's OWN queue patient: Call in (→ in_progress) or Complete
 * (→ completed). Authorization is ownership — the appointment must belong to the
 * signed-in doctor — so no extra `appointments:edit` grant is needed to run their
 * own room. The shared transition records the sale on completion. Clinic-scoped.
 */
export async function advanceMyQueue(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<void> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return;
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
  const user = await requireRole("doctor");
  if (!user.clinicId || !can(user, "clinical", "view")) return null;
  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  return clinicalRecord ? clinicalRecord.loadChart(user.clinicId, patientId) : null;
}

/**
 * Reopen one of the doctor's own unapproved drafts for review.
 *
 * A scribe session that ends before approval (tab closed, called away) leaves the
 * draft in the database with nothing pointing at it — approve and discard both act
 * on whatever the workspace happens to be holding in memory. This is the way back
 * in: it returns the same shape the scribe route returns, so the existing review
 * screen can pick the draft up as though it had just been dictated.
 *
 * Own drafts only. An unapproved note is the author's until they sign it off, so
 * another doctor cannot open, edit or approve it. Returns null if it is not yours,
 * already approved, or discarded.
 */
export async function loadDraft(visitId: string): Promise<{
  visitId: string;
  transcript: string;
  note: Record<string, unknown>;
  drugWarnings: string[];
  allergyWarnings: string[];
  patient: { id: string; fullName: string; phone: string | null };
} | null> {
  const user = await requireRole("doctor");
  if (!user.clinicId || !can(user, "clinical", "create")) return null;

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
        eq(visits.doctorId, user.id),
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
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };
  // Approving finalises a clinical note — an authoring action.
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to save clinical notes." };
  }

  const [updated] = await db
    .update(visits)
    .set({
      note,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
        notDeleted(visits.deletedAt),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, module: visits.module });

  if (!updated) return { error: "Draft not found." };

  // Persist the specialty structured record + fold the living chart (e.g. the dental
  // odontogram), via the enabled module's contract. App-level resolution, like the
  // recall capture below — core stays specialty-agnostic. Best-effort: the chart is
  // always recomputable, so a hiccup here must not fail the approval.
  try {
    const [clinicRow] = await db
      .select({ modulesEnabled: clinics.modulesEnabled })
      .from(clinics)
      .where(eq(clinics.id, user.clinicId))
      .limit(1);
    const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
    if (clinicalRecord) {
      await clinicalRecord.saveRecord(user.clinicId, {
        visitId,
        patientId: updated.patientId,
        note,
        // The doctor's confirmed chart from the in-scribe editor (else the module
        // derives it from the note).
        chart: chart ?? undefined,
      });
    }
  } catch {
    // Non-fatal — the chart can be rebuilt from records later.
  }

  // Capture a recall from the note's nextVisit ({ reason, afterDays }) — the
  // scribe extracts it; approving schedules it (CLAUDE.md §10). Reading the note
  // shape is fine here (app-level), not in /core.
  const nextVisit = note.nextVisit;
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

/** Discard a draft the doctor doesn't want to keep. */
export async function discardDraft(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };
  if (!can(user, "clinical", "create")) {
    return { error: "You don't have permission to modify clinical drafts." };
  }

  const result = await db
    .update(visits)
    .set(softDeleteValues(user.id, newDeleteGroup()))
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
        notDeleted(visits.deletedAt),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) return { error: "Draft not found." };
  revalidatePath("/clinic/scribe");
  revalidatePath("/doctor");
  return { ok: true };
}

/** Search this clinic's patients by name/phone for the scribe picker. */
export async function searchPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return [];
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
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };
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
