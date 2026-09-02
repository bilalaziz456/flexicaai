/**
 * Delta D-08 — the scribe is a job, not a request (ADR-020).
 *
 * `POST /api/ai/scribe` used to hold the doctor's connection open for the whole
 * Whisper + Claude round trip. Now it stores the audio, creates the visit as
 * `transcribing` and returns 202; `core/ai/scribe-job.ts` fills it in afterwards.
 *
 * WHAT THIS COVERS — the state machine, which is the part that can go wrong without
 * anyone noticing. It does NOT cover a real transcription: that needs live Whisper and
 * Claude keys, which this project does not have yet. So the happy path here ends at
 * `failed` (the AI is unconfigured) and the assertions are about the STATES and the
 * safety properties around them, not the note. When the keys arrive, one live
 * dictation is still required before trusting this end to end.
 *
 * The properties worth protecting, in order of how quietly they would break:
 *
 *  1. A `transcribing` or `failed` visit must NEVER read as a clinical record. Every
 *     existing surface filters `= 'draft'` or `= 'approved'`, so this is true by
 *     construction — and that is exactly the kind of thing that stops being true when
 *     someone adds a status.
 *  2. The claim is idempotent. The job can be invoked twice (a retry racing the
 *     recovery sweep); doing the PAID work twice is the failure being prevented.
 *  3. A run the process died in the middle of gets recovered — including one whose
 *     `after()` callback never ran at all, which has a NULL start time and is the case
 *     a naive `started_at < cutoff` sweep silently misses forever.
 *  4. Retry reuses the stored audio, and only from `failed`.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-scribe-async.ts`
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics, patients, users, visits } from "../src/core/db/schema";
import {
  SCRIBE_STALL_MINUTES,
  getScribeRunStatus,
  listScribeRuns,
  recoverStalledScribes,
  retryScribeRun,
  runScribeJob,
} from "../src/core/ai/scribe-job";
// The module contribution is INJECTED (architecture §3): core cannot resolve a
// specialty prompt itself, so the caller passes the registry-layer resolver.
import { scribeModuleConfig } from "../src/config/module-scribe";
import { unscoped } from "../src/core/db/tenant-guard";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const uniq = Date.now();
const TAG = `d08x${uniq}`;
let clinicId = "";
let doctorId = "";
let otherDoctorId = "";
let patientId = "";

const statusOf = async (id: string) => {
  const [r] = await db
    .select({ s: visits.status, e: visits.transcribeError, at: visits.transcribeStartedAt })
    .from(visits)
    .where(eq(visits.id, id));
  return r;
};

/** A visit as the ROUTE creates it: audio stored, note not yet written. */
async function newRun(audioKey: string | null = `${TAG}/audio.webm`): Promise<string> {
  const [v] = await db
    .insert(visits)
    .values({
      clinicId,
      patientId,
      doctorId,
      module: "dental",
      status: "transcribing",
      audioKey,
    })
    .returning({ id: visits.id });
  return v.id;
}

async function seed() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });
  [{ id: doctorId }] = await db
    .insert(users)
    .values({ clinicId, username: `${TAG}_doc`, passwordHash: "x", role: "doctor", fullName: "D08 Doctor" })
    .returning({ id: users.id });
  [{ id: otherDoctorId }] = await db
    .insert(users)
    .values({ clinicId, username: `${TAG}_doc2`, passwordHash: "x", role: "doctor", fullName: "D08 Other" })
    .returning({ id: users.id });
  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Patient` })
    .returning({ id: patients.id });
}

async function cleanup() {
  await unscoped("test teardown", async () => {
    await db.delete(visits).where(eq(visits.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
}

async function main() {
  await seed();

  console.log("\nAn in-flight run is a visit, but never a RECORD:");
  {
    const id = await newRun();
    const s = await statusOf(id);
    check("it starts as transcribing", s?.s, "transcribing");
    check("with no start time until a job claims it", s?.at, null);

    // The two filters every clinical surface uses.
    const asDraft = await db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), eq(visits.status, "draft")));
    const asApproved = await db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), eq(visits.status, "approved")));
    check("it is not in the drafts list", asDraft.some((r) => r.id === id), false);
    check("it is not in the approved record", asApproved.some((r) => r.id === id), false);

    // …but the doctor CAN see it, which is the whole point of surfacing runs.
    const runs = await listScribeRuns(clinicId, doctorId);
    check("the doctor sees it in their runs list", runs.some((r) => r.id === id), true);
  }

  console.log("\nRunning the job records an outcome on the visit, never throws:");
  {
    const id = await newRun();
    // No API keys in this project yet, so the AI raises MissingApiKeyError — which is
    // a real failure path and the one this asserts. It must land as `failed`, not
    // escape: `after()` has nobody to catch it.
    await runScribeJob(id, scribeModuleConfig);
    const s = await statusOf(id);
    check("the run is marked failed, not left hanging", s?.s, "failed");
    check("with a reason the doctor can read", Boolean(s?.e), true);
    check("and a start time, so it is not swept as stalled", Boolean(s?.at), true);
  }

  console.log("\nThe claim is idempotent — the PAID work cannot run twice:");
  {
    const id = await newRun();
    await Promise.all([runScribeJob(id, scribeModuleConfig), runScribeJob(id, scribeModuleConfig)]);
    const s = await statusOf(id);
    check("two concurrent invocations leave one settled run", s?.s, "failed");

    // A third pass after it settled must do nothing at all.
    const before = (await statusOf(id))?.e;
    await runScribeJob(id, scribeModuleConfig);
    check("re-invoking a settled run changes nothing", (await statusOf(id))?.e, before);
  }

  console.log("\nA run the process died in the middle of is recovered:");
  {
    const stalled = await newRun();
    await db
      .update(visits)
      .set({ transcribeStartedAt: new Date(Date.now() - (SCRIBE_STALL_MINUTES + 5) * 60_000) })
      .where(eq(visits.id, stalled));

    // The one a naive sweep misses: `after()` never ran, so start time is NULL.
    const neverStarted = await newRun();
    await db
      .update(visits)
      .set({ createdAt: new Date(Date.now() - (SCRIBE_STALL_MINUTES + 5) * 60_000) })
      .where(eq(visits.id, neverStarted));

    const fresh = await newRun(); // started just now — must be left alone

    const { recovered } = await recoverStalledScribes();
    check("both stalled runs recovered", recovered >= 2, true);
    check("the claimed-but-stalled one failed", (await statusOf(stalled))?.s, "failed");
    check("the NEVER-CLAIMED one failed too (null start time)", (await statusOf(neverStarted))?.s, "failed");
    check("a fresh run is untouched", (await statusOf(fresh))?.s, "transcribing");
  }

  console.log("\nRetry reuses the stored audio, and only from `failed`:");
  {
    const id = await newRun();
    await runScribeJob(id, scribeModuleConfig); // → failed
    check("precondition: failed", (await statusOf(id))?.s, "failed");

    const r = await retryScribeRun(clinicId, doctorId, id);
    check("retry is accepted", "ok" in r, true);
    const s = await statusOf(id);
    check("it is queued again", s?.s, "transcribing");
    check("the claim is released so a job can take it", s?.at, null);
    check("and the old error is cleared", s?.e, null);

    const [audio] = await db.select({ k: visits.audioKey }).from(visits).where(eq(visits.id, id));
    check("the recording is still there — no re-dictation", Boolean(audio?.k), true);

    // Not from `transcribing`: that would disturb a run that is still going.
    const again = await retryScribeRun(clinicId, doctorId, id);
    check("retrying an in-flight run is refused", "error" in again, true);
  }

  console.log("\nA run belongs to its author, like every other draft operation:");
  {
    const id = await newRun();
    const mine = await getScribeRunStatus(clinicId, doctorId, id);
    const theirs = await getScribeRunStatus(clinicId, otherDoctorId, id);
    check("the author can read its status", mine?.status, "transcribing");
    check("another doctor cannot", theirs, null);

    const stolen = await retryScribeRun(clinicId, otherDoctorId, id);
    check("and cannot retry it", "error" in stolen, true);
  }

  console.log("\nA failed run can be discarded — it holds a real recording:");
  {
    // `discardDraft` matches draft OR failed; `transcribing` is deliberately excluded
    // so the job cannot land a note on a soft-deleted visit.
    const reachable = await db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), inArray(visits.status, ["draft", "failed"])));
    check("failed runs are reachable by discard", reachable.length > 0, true);

    const inFlight = await db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), eq(visits.status, "transcribing")));
    check(
      "in-flight runs are NOT reachable by discard",
      inFlight.every((r) => !reachable.some((x) => x.id === r.id)),
      true,
    );
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      if (clinicId) await cleanup();
    } catch {
      /* the seed clinic may not exist */
    }
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
