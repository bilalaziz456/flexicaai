import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics, patients, visits } from "@/core/db/schema";
import { getClinicWorkspace } from "@/config/modules";
import { saveClinicFile } from "@/core/integrations/storage";
import { runScribe } from "@/core/ai/scribe-engine";
import { MissingApiKeyError, AiParseError } from "@/core/ai/prompt-runner";

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
  const clinicId = user.clinicId;

  const form = await request.formData();
  const audio = form.get("audio");
  const patientId = form.get("patientId");
  if (!(audio instanceof File) || typeof patientId !== "string") {
    return NextResponse.json(
      { error: "audio file and patientId are required." },
      { status: 400 },
    );
  }

  // Tenant guard: the patient must belong to THIS doctor's clinic.
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
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

    const { transcript, note } = await runScribe({
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

    return NextResponse.json({
      visitId: visit.id,
      transcript,
      note,
      drugWarnings,
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
