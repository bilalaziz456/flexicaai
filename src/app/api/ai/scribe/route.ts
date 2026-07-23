import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, visits } from "@/core/db/schema";
import { getClinicWorkspace } from "@/config/modules";
import { saveClinicFile } from "@/core/integrations/storage";
import { runScribe } from "@/core/ai/scribe-engine";
import { recordScribeUsage } from "@/core/ai/usage";
import { MissingApiKeyError, AiParseError } from "@/core/ai/prompt-runner";
import { getPatientAllergies } from "@/core/patients/medical-history";
import { allergyConflicts } from "@/core/lib/medical-history";
import { aiScribeByUser, throttle, tooManyRequests } from "@/core/security/rate-limit";

/** Cap the audio upload — bounds memory + the paid Whisper call. A few minutes of
 *  compressed audio is well under this; a huge upload is rejected before buffering. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * POST /api/ai/scribe — CORE, specialty-agnostic voice scribe (CLAUDE.md §8).
 * Doctor uploads audio (+ patientId); we transcribe (Whisper) and generate a
 * structured note (Claude) using the CLINIC'S ENABLED MODULE prompt, then save
 * a DRAFT visit. The doctor reviews/edits/approves it separately — never
 * auto-finalized. Every query is scoped to the doctor's own clinic_id.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "doctor" || !user.clinicId) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  // Generating a note is a clinical authoring action.
  if (!can(user, "clinical", "create")) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const clinicId = user.clinicId;

  // Throttle before reading the (large) upload or hitting the PAID AI APIs — bounds
  // spend if a client loops. Per doctor.
  const gate = throttle(aiScribeByUser, `scribe:${user.id}`);
  if (!gate.ok) return tooManyRequests(gate.retryAfterMs);

  // Reject an oversized upload from the Content-Length header BEFORE parsing the body,
  // so a huge request never gets buffered (a clean 413, not a parse 500).
  const declaredBytes = Number(request.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio is too large (max 25 MB)." }, { status: 413 });
  }

  const form = await request.formData();
  const audio = form.get("audio");
  const patientId = form.get("patientId");
  if (!(audio instanceof File) || typeof patientId !== "string") {
    return NextResponse.json(
      { error: "audio file and patientId are required." },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio is too large (max 25 MB)." },
      { status: 413 },
    );
  }

  // Tenant guard: the patient must belong to THIS doctor's clinic.
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.clinicId, clinicId),
        notDeleted(patients.deletedAt),
      ),
    )
    .limit(1);
  if (!patient) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  // Resolve the clinic's enabled module + its scribe prompt (module-agnostic:
  // core reads modules_enabled, never hardcodes "dental").
  const [clinic] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const moduleId = clinic?.modulesEnabled?.[0];
  const workspace = getClinicWorkspace(clinic?.modulesEnabled ?? []);
  const scribePrompt = moduleId ? workspace.scribePrompts[moduleId] : undefined;
  if (!moduleId || !scribePrompt) {
    return NextResponse.json(
      { error: "This clinic has no module with a scribe configured." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const ext = (audio.name.split(".").pop() || audio.type.split("/").pop() || "webm").toLowerCase();

  try {
    // Keep the audio for the accuracy flywheel / re-transcription.
    const audioKey = await saveClinicFile(clinicId, "audio", buffer, ext);

    const { transcript, note, usage } = await runScribe({
      audio: buffer,
      filename: audio.name || `recording.${ext}`,
      scribePrompt,
    });

    // Flag prescribed drugs not in the module formulary (CLAUDE.md §8) — a
    // warning for the doctor, not a hard block.
    const formulary = workspace.drugFormulary;
    const known = new Set(
      formulary.flatMap((d) => [d.name, ...d.brands]).map((s) => s.toLowerCase()),
    );
    const prescriptions = Array.isArray(note.prescriptions)
      ? (note.prescriptions as { drug?: string }[])
      : [];
    const drugWarnings = prescriptions
      .map((p) => p?.drug)
      .filter(
        (drug): drug is string =>
          typeof drug === "string" && !known.has(drug.toLowerCase()),
      );

    // Allergy gate: flag any prescribed drug that conflicts with a recorded allergy
    // (direct or by drug class). A prominent warning for the doctor, not a hard block.
    const allergies = await getPatientAllergies(clinicId, patientId);
    const allergyWarnings = prescriptions
      .map((p) => p?.drug)
      .filter((drug): drug is string => typeof drug === "string")
      .flatMap((drug) => {
        const hits = allergyConflicts(allergies, drug);
        return hits.length ? [`${drug} — allergy: ${hits.join(", ")}`] : [];
      });

    const [visit] = await db
      .insert(visits)
      .values({
        clinicId,
        patientId,
        doctorId: user.id,
        module: moduleId,
        status: "draft",
        transcript,
        note,
        aiDraft: note, // frozen original for the flywheel
        audioKey,
      })
      .returning({ id: visits.id });

    // Meter the paid AI calls for precise serving cost (best-effort, never blocks).
    await recordScribeUsage({ clinicId, visitId: visit.id, usage });

    return NextResponse.json({
      visitId: visit.id,
      transcript,
      note,
      drugWarnings,
      allergyWarnings,
    });
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AiParseError) {
      return NextResponse.json(
        { error: "The AI returned an unreadable note. Please try again." },
        { status: 502 },
      );
    }
    const message = e instanceof Error ? e.message : "Scribe failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
