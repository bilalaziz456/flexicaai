import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiRequireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, visits } from "@/core/db/schema";
import { getClinicWorkspace } from "@/config/modules";
import { saveClinicFile } from "@/core/integrations/storage";
import { runScribeJob } from "@/core/ai/scribe-job";
import { report } from "@/core/observability";
import { aiScribeByUser, throttle, tooManyRequests } from "@/core/security/rate-limit";

/** Cap the audio upload — bounds memory + the paid Whisper call. A few minutes of
 *  compressed audio is well under this; a huge upload is rejected before buffering. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * The request no longer waits for the AI (delta D-08 / ADR-020), so this is now only
 * the budget for storing an upload — seconds, not minutes. It stays declared because
 * the number belongs next to the route it bounds, and a future serverless host would
 * read it.
 *
 * ⚠ WHAT THIS CHANGES FOR nginx: `proxy_read_timeout` no longer has to be raised to
 * 300s for this route, because nothing here holds a connection open across two
 * provider calls. **`client_max_body_size 25m` is still required** — it must match
 * `MAX_AUDIO_BYTES` below, or a normal dictation is rejected at the proxy before the
 * app ever sees it. (CLAUDE.md §2a.)
 */
export const maxDuration = 60;

/**
 * POST /api/ai/scribe — CORE, specialty-agnostic voice scribe (CLAUDE.md §8).
 *
 * ACCEPTS the recording and returns **202** immediately: the audio is stored and a
 * visit is created in `transcribing`. `core/ai/scribe-job.ts` then transcribes
 * (Whisper) and structures the note (Claude) with the CLINIC'S ENABLED MODULE prompt,
 * landing it as a DRAFT the doctor reviews and approves — never auto-finalized.
 *
 * Everything up to and including storing the audio is still synchronous and still
 * validated here, because those are the failures worth telling the caller about
 * straight away: no permission, wrong clinic's patient, no module, file too large.
 * Every query is scoped to the doctor's own clinic_id.
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

    // THE REQUEST ENDS HERE (delta D-08 / ADR-020). The visit exists the moment the
    // recording is stored — it has the patient, the doctor and the audio; only the
    // note is missing — so it is created in `transcribing` and the AI fills it in
    // afterwards. The doctor gets an answer in milliseconds instead of minutes, and
    // a run that dies leaves a row someone can see and retry rather than a lost
    // upload and a billed API call.
    const [visit] = await db
      .insert(visits)
      .values({
        clinicId,
        patientId,
        doctorId: user.id,
        module: moduleId,
        status: "transcribing",
        audioKey,
      })
      .returning({ id: visits.id });

    // `after` runs the callback once the response is flushed (Next 16, sanctioned for
    // Route Handlers). The job never throws and writes every outcome to the visit, so
    // there is nothing here to catch — see `core/ai/scribe-job.ts`.
    after(() => runScribeJob(visit.id));

    // 202: accepted, not done. The client polls `getScribeRunStatus` until it leaves
    // `transcribing`.
    return NextResponse.json({ visitId: visit.id, status: "transcribing" }, { status: 202 });
  } catch (e) {
    // Only the SYNCHRONOUS part can fail here now — storing the audio and creating the
    // row. Everything the AI can do wrong is the job's business and lands on the visit.
    report(e, { op: "ai.scribe.accept", clinicId, ids: { patientId } });
    const message = e instanceof Error ? e.message : "Could not start the scribe.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
