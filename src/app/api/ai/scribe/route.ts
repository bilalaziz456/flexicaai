import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiRequireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, visits } from "@/core/db/schema";
import { clinicalSchemasFor, getClinicWorkspace } from "@/config/modules";
import { parseClinicalNote } from "@/core/clinical/note-schema";
import { saveClinicFile } from "@/core/integrations/storage";
import { runScribe, AiTimeoutError } from "@/core/ai/scribe-engine";
import { recordScribeUsage } from "@/core/ai/usage";
import { MissingApiKeyError, AiParseError } from "@/core/ai/prompt-runner";
import { getPatientAllergies } from "@/core/patients/medical-history";
import { noteWarnings } from "@/core/ai/note-warnings";
import { aiScribeByUser, throttle, tooManyRequests } from "@/core/security/rate-limit";

/** Cap the audio upload — bounds memory + the paid Whisper call. A few minutes of
 *  compressed audio is well under this; a huge upload is rejected before buffering. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * This route runs TWO paid, slow provider calls back to back (Whisper, then Claude),
 * so it needs far more than a default request budget: real dictation is minutes of
 * audio. 300s is the ceiling the provider timeouts are budgeted against (Whisper
 * 120s + Claude 90s × 2 attempts) — raising either means raising this too, see the
 * SCRIBE TIME BUDGET note in `core/ai/scribe-engine/index.ts`.
 *
 * ⚠ ON THE LINUX DEPLOYMENT THIS EXPORT DOES NOTHING BY ITSELF. `maxDuration` is a
 * hint consumed by serverless platforms; a plain `next start` has no such limit. The
 * real ceiling is **nginx's `proxy_read_timeout`, which defaults to 60 SECONDS** —
 * well inside a normal dictation, so the doctor would get a 504 mid-note while the
 * audio is already stored and the AI already billed. nginx must be raised to match:
 *
 *   location /api/ai/scribe {
 *     proxy_read_timeout 300s;
 *     proxy_send_timeout 300s;
 *     client_max_body_size 25m;   # matches MAX_AUDIO_BYTES below
 *   }
 *
 * Kept as an export so the number lives next to the budget it belongs to, and so a
 * future move to a serverless host is already correct. (CLAUDE.md §2a.)
 */
export const maxDuration = 300;

/**
 * POST /api/ai/scribe — CORE, specialty-agnostic voice scribe (CLAUDE.md §8).
 * Doctor uploads audio (+ patientId); we transcribe (Whisper) and generate a
 * structured note (Claude) using the CLINIC'S ENABLED MODULE prompt, then save
 * a DRAFT visit. The doctor reviews/edits/approves it separately — never
 * auto-finalized. Every query is scoped to the doctor's own clinic_id.
 */
export async function POST(request: Request) {
  // Generating a note is a clinical authoring action, gated on the PERMISSION and
  // not on the `doctor` role (CLAUDE.md §8). This used to require
  // `role === "doctor"`, which locked out the clinic owner who is the practising
  // dentist — the common case in this market. They could open /clinic/scribe and
  // record (that page gates on `clinical`), then got a 401 from this route.
  //
  // Going through the shared guard also means a paused clinic can't reach the PAID
  // AI providers: it was blocked from every page but not from this route.
  const auth = await apiRequireWorkspace("clinical", "create");
  if (!auth.ok) return auth.response;
  const { user, clinicId } = auth;

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

    // The model is an untrusted producer too: it returns free-form JSON that the
    // prompt only ASKED to be shaped a certain way. Validate before it becomes a
    // draft, so a malformed note is a clean, retryable 502 rather than a record that
    // renders wrong — or not at all — later (ADR-007).
    const parsedNote = parseClinicalNote(
      note,
      clinicalSchemasFor(clinic?.modulesEnabled ?? []).noteSchema,
    );
    if (!parsedNote.ok) {
      return NextResponse.json(
        { error: `The AI returned a note we can't store: ${parsedNote.error}`, retryable: true },
        { status: 502 },
      );
    }

    // Flag prescribed drugs that are not in the module formulary, and any that
    // conflict with a recorded allergy (CLAUDE.md §8). Warnings for the doctor, not
    // a hard block. Shared with the resume-a-draft path so the two can't drift.
    const allergies = await getPatientAllergies(clinicId, patientId);
    const { drugWarnings, allergyWarnings } = noteWarnings(
      parsedNote.value,
      workspace.drugFormulary,
      allergies,
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
        note: parsedNote.value,
        aiDraft: parsedNote.value, // frozen original for the flywheel
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
    // A provider stalled past its budget (Whisper) or past the SDK timeout (Claude).
    // 504 + `retryable` so the client can offer "Try again" on the SAME recording
    // rather than making the doctor dictate it a second time.
    if (e instanceof AiTimeoutError) {
      return NextResponse.json(
        {
          error: "The AI service took too long to respond. Your recording was saved — please try again.",
          retryable: true,
        },
        { status: 504 },
      );
    }
    const message = e instanceof Error ? e.message : "Scribe failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
