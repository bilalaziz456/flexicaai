import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { patients, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { clinicalSchemasFor, getClinicWorkspace } from "@/config/modules";
import { parseClinicalNote } from "@/core/clinical/note-schema";
import { readFileByKey } from "@/core/integrations/storage";
import { runScribe, AiTimeoutError } from "@/core/ai/scribe-engine";
import { recordScribeUsage } from "@/core/ai/usage";
import { MissingApiKeyError, AiParseError } from "@/core/ai/prompt-runner";
import { getClinic } from "@/core/clinics/get-clinic";
import { report, reportEvent } from "@/core/observability";

/**
 * The scribe run, as a JOB rather than a request (delta D-08 / ADR-020).
 *
 * WHY THIS MOVED. `POST /api/ai/scribe` used to hold the doctor's request open for the
 * whole Whisper + Claude round trip — minutes of real dictation — on a single-node
 * server. The timeouts made that survivable, not correct: nginx's `proxy_read_timeout`
 * had to be raised to 300s to stop it 504-ing mid-note, one slow provider tied up a
 * connection for the duration, and if anything dropped the run there was NO resume
 * path — the audio was stored and the APIs already billed, with nothing to show for it.
 *
 * Now the request stores the audio, creates the visit as `transcribing` and returns.
 * This fills it in afterwards.
 *
 * WHAT THAT COSTS, said plainly: the work is no longer tied to a request, so nothing
 * retries it if the process dies mid-run. That is what `recoverStalledScribes` is for,
 * and why `transcribe_started_at` exists — a job nobody is waiting on fails silently
 * unless something goes looking.
 */

/** A run older than this with no result is presumed dead (see the budget in §5). */
export const SCRIBE_STALL_MINUTES = 15;

/**
 * Runs the AI for one `transcribing` visit and lands the result on it.
 *
 * Never throws: it is invoked from `after()`, where nothing is waiting to catch. Every
 * outcome is written to the visit instead, because the visit IS the status board — the
 * doctor is watching that row, not a log.
 *
 * Idempotent by CLAIM: the first statement moves the row out of `transcribing` only if
 * it is still there, so a double invocation (a retry racing the recovery sweep) does
 * the paid work once. Claiming BEFORE the provider call is deliberate — the failure we
 * are protecting against is paying twice, not writing twice.
 */
export async function runScribeJob(visitId: string): Promise<void> {
  const claimed = await unscoped("scribe job runs outside a request", async () => {
    const [row] = await db
      .update(visits)
      .set({ transcribeStartedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(visits.id, visitId),
          eq(visits.status, "transcribing"),
          // A run already claimed by someone else has a start time; leave it alone.
          isNull(visits.transcribeStartedAt),
        ),
      )
      .returning({
        id: visits.id,
        clinicId: visits.clinicId,
        patientId: visits.patientId,
        audioKey: visits.audioKey,
        module: visits.module,
      });
    return row ?? null;
  });

  if (!claimed) return; // already claimed, already finished, or gone

  await finishScribeRun(claimed);
}

type ClaimedRun = {
  id: string;
  clinicId: string;
  patientId: string;
  audioKey: string | null;
  module: string | null;
};

async function finishScribeRun(run: ClaimedRun): Promise<void> {
  const startedAt = Date.now();
  try {
    if (!run.audioKey) throw new Error("The recording is missing.");

    const clinic = await getClinic(run.clinicId);
    const modulesEnabled = clinic?.modulesEnabled ?? [];
    const workspace = getClinicWorkspace(modulesEnabled);
    const scribePrompt = run.module ? workspace.scribePrompts[run.module] : undefined;
    if (!scribePrompt) throw new Error("This clinic has no module with a scribe configured.");

    const audio = await readFileByKey(run.audioKey);
    const ext = run.audioKey.split(".").pop()?.toLowerCase() || "webm";

    const { transcript, note, usage } = await runScribe({
      audio: Buffer.from(audio),
      filename: `recording.${ext}`,
      scribePrompt,
    });

    // The model is an untrusted producer: it returns free-form JSON the prompt only
    // ASKED to be shaped a certain way. Validate before it becomes a draft (ADR-007).
    const parsed = parseClinicalNote(note, clinicalSchemasFor(modulesEnabled).noteSchema);
    if (!parsed.ok) throw new Error(`The AI returned a note we can't store: ${parsed.error}`);

    await unscoped("scribe job writes its result", () =>
      db
        .update(visits)
        .set({
          status: "draft",
          transcript,
          note: parsed.value,
          aiDraft: parsed.value, // frozen original for the flywheel
          transcribeError: null,
          updatedAt: new Date(),
        })
        .where(eq(visits.id, run.id)),
    );

    // Meter the paid calls for serving cost. Best-effort, but reported — unrecorded
    // usage understates cost and makes margins look better than they are.
    await recordScribeUsage({ clinicId: run.clinicId, visitId: run.id, usage });

    reportEvent("scribe completed", {
      op: "ai.scribeJob",
      severity: "info",
      clinicId: run.clinicId,
      ids: { visitId: run.id },
      extra: { ms: Date.now() - startedAt },
    });
  } catch (e) {
    await failRun(run, e, Date.now() - startedAt);
  }
}

/** Message shown to the doctor. Deliberately about what to DO, not about the provider. */
function doctorFacingReason(e: unknown): string {
  if (e instanceof MissingApiKeyError) return "The AI service is not configured yet.";
  if (e instanceof AiTimeoutError) return "The AI service took too long. Your recording was kept.";
  if (e instanceof AiParseError) return "The AI returned an unreadable note.";
  return e instanceof Error ? e.message : "The scribe failed.";
}

async function failRun(run: ClaimedRun, e: unknown, ms: number): Promise<void> {
  // NOT the transcript or the note — those are the most sensitive text in the system
  // (CLAUDE.md §10). Ids and a reason only.
  report(e, { op: "ai.scribeJob", clinicId: run.clinicId, ids: { visitId: run.id }, extra: { ms } });
  try {
    await unscoped("scribe job records its failure", () =>
      db
        .update(visits)
        .set({ status: "failed", transcribeError: doctorFacingReason(e), updatedAt: new Date() })
        .where(eq(visits.id, run.id)),
    );
  } catch (writeError) {
    // If even this fails the visit stays `transcribing` — which is precisely the case
    // the recovery sweep exists to catch, so it is not lost, only delayed.
    report(writeError, { op: "ai.scribeJob.fail", ids: { visitId: run.id } });
  }
}

/**
 * Marks runs the process died in the middle of as failed, so the doctor can retry.
 *
 * It does NOT re-run them automatically. Re-running spends real money on a provider
 * without anyone asking, and a run that stalled once may stall again — a loop that
 * bills every sweep is a worse failure than a note that waits for a human to press a
 * button. The audio is kept, so retrying costs the doctor one click and no re-dictation.
 */
export async function recoverStalledScribes(
  now = new Date(),
): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - SCRIBE_STALL_MINUTES * 60_000);
  const rows = await unscoped("recover stalled scribe runs across clinics", () =>
    db
      .update(visits)
      .set({
        status: "failed",
        transcribeError: "The transcription stopped unexpectedly. Your recording was kept.",
        updatedAt: new Date(),
      })
      // COALESCE, not a plain comparison on `transcribe_started_at`. A visit whose
      // `after()` callback never ran — the process died between the INSERT and the
      // job — has a NULL start time, and `null < cutoff` is NULL, so it would never
      // match and would sit in `transcribing` forever. That is precisely the case
      // this sweep exists for, so it falls back to when the visit was created.
      .where(
        and(
          eq(visits.status, "transcribing"),
          sql`coalesce(${visits.transcribeStartedAt}, ${visits.createdAt}) < ${cutoff}`,
        ),
      )
      .returning({ id: visits.id }),
  );
  if (rows.length > 0) {
    reportEvent("recovered stalled scribe runs", {
      op: "ai.scribeRecover",
      severity: "warn",
      extra: { recovered: rows.length },
    });
  }
  return { recovered: rows.length };
}

/** What the client polls while a run is in flight. Clinic-scoped and author-only. */
export async function getScribeRunStatus(
  clinicId: string,
  doctorId: string,
  visitId: string,
): Promise<{ status: string; error: string | null } | null> {
  const [row] = await db
    .select({ status: visits.status, error: visits.transcribeError })
    .from(visits)
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.id, visitId), eq(visits.doctorId, doctorId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Puts a FAILED run back in the queue, reusing the audio already on disk.
 *
 * The whole reason the recording is stored before the AI is called is so a failure
 * costs the doctor a click rather than another dictation. Author-only and
 * clinic-scoped, like every other draft operation (ADR-007) — and only from `failed`,
 * so this can never disturb a run that is still going or a note already written.
 */
export async function retryScribeRun(
  clinicId: string,
  doctorId: string,
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .update(visits)
    .set({
      status: "transcribing",
      transcribeStartedAt: null,
      transcribeError: null,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(
          eq(visits.id, visitId),
          eq(visits.status, "failed"),
          eq(visits.doctorId, doctorId),
        ),
      ),
    )
    .returning({ id: visits.id });

  if (!row) return { error: "That recording is not waiting to be retried." };
  return { ok: true };
}

/** Runs still in flight or failed, for the doctor's own workspace. */
export async function listScribeRuns(clinicId: string, doctorId: string) {
  return db
    .select({
      id: visits.id,
      status: visits.status,
      error: visits.transcribeError,
      startedAt: visits.transcribeStartedAt,
      createdAt: visits.createdAt,
      patientName: patients.fullName,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.doctorId, doctorId), inArray(visits.status, ["transcribing", "failed"])),
      ),
    )
    .orderBy(desc(visits.createdAt))
    .limit(20);
}
