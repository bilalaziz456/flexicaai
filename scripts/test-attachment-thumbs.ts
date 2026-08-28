/**
 * Clinical attachments keep the ORIGINAL and gain a thumbnail (2026-08-28).
 *
 * The patient gallery rendered every attachment at full size into a ~150px square, so
 * ten 6 MB phone photos meant ~60 MB fetched to draw ten thumbnails — on every visit
 * to that patient. Uploads now carry a small JPEG made in the browser, and the grid
 * asks for that instead.
 *
 * **The original is never resized**, and that is the point rather than an oversight:
 * these are diagnostic images a clinician may compare months apart, so shrinking one
 * on the way in would silently destroy detail. The thumbnail is an addition, never a
 * replacement — asserted below by reading both files back and checking the original
 * is byte-identical to what went in.
 *
 * The other half is the FALLBACK. Rows uploaded before this existed have no
 * thumbnail, and neither will a file the browser cannot decode, so every reader has
 * to cope with a NULL `thumb_key`. A gallery that 404s on historical x-rays would be
 * a far worse bug than the one this fixes.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-attachment-thumbs.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinicalAttachments, clinics, patients, users } from "../src/core/db/schema";
import { createAttachment, getAttachmentForServe } from "../src/core/patients/attachments";
import { readFileByKey } from "../src/core/integrations/storage";

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

const TAG = `thumb${Date.now()}`;
let clinicId = "";
let patientId = "";
let actorId = "";

/** Stand-ins for the bytes — the store does not care what they are. */
const ORIGINAL = Buffer.from(`${TAG}-ORIGINAL-full-resolution-diagnostic-bytes`.repeat(50));
const THUMB = Buffer.from(`${TAG}-thumb`);

async function cleanup() {
  if (!clinicId) return;
  await db.delete(clinicalAttachments).where(eq(clinicalAttachments.clinicId, clinicId));
  await db.delete(patients).where(eq(patients.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

async function main() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });
  [{ id: actorId }] = await db
    .insert(users)
    .values({ clinicId, username: `${TAG}_dr`, passwordHash: "x", role: "doctor", fullName: `${TAG} Dr` })
    .returning({ id: users.id });
  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Patient` })
    .returning({ id: patients.id });

  const actor = { id: actorId, name: "Test Dr" };

  console.log("An upload WITH a thumbnail keeps both:");
  const withThumb = await createAttachment(
    clinicId,
    { patientId, kind: "xray", data: ORIGINAL, ext: "jpg", mime: "image/jpeg", thumb: THUMB },
    actor,
  );
  check("it was created", "id" in withThumb, true);
  const a = await getAttachmentForServe(clinicId, (withThumb as { id: string }).id);
  check("a thumb key was stored", Boolean(a?.thumbKey), true);
  check("and it is NOT the original's key", a?.thumbKey === a?.storageKey, false);

  // The load-bearing assertion: the original is untouched.
  const storedOriginal = await readFileByKey(a!.storageKey);
  check("the ORIGINAL is byte-identical to what was uploaded", storedOriginal.equals(ORIGINAL), true);
  const storedThumb = await readFileByKey(a!.thumbKey!);
  check("the thumbnail is stored separately", storedThumb.equals(THUMB), true);
  check("and it is smaller than the original", storedThumb.length < storedOriginal.length, true);

  console.log("\nAn upload WITHOUT one still works — the fallback path:");
  const noThumb = await createAttachment(
    clinicId,
    { patientId, kind: "document", data: ORIGINAL, ext: "pdf", mime: "application/pdf" },
    actor,
  );
  const b = await getAttachmentForServe(clinicId, (noThumb as { id: string }).id);
  check("the row exists", Boolean(b), true);
  check("thumb key is NULL, not an empty string", b?.thumbKey, null);
  check("the original still reads back", (await readFileByKey(b!.storageKey)).equals(ORIGINAL), true);

  // This mirrors the route: `?thumb=1` uses the thumb only when there IS one, and
  // otherwise serves the original rather than 404ing on every historical row.
  const pick = (row: { storageKey: string; thumbKey: string | null }, wantsThumb: boolean) =>
    wantsThumb && row.thumbKey ? row.thumbKey : row.storageKey;
  check("?thumb=1 on a row with one → the thumb", pick(a!, true), a!.thumbKey);
  check("?thumb=1 on a row WITHOUT one → the original", pick(b!, true), b!.storageKey);
  check("no ?thumb → always the original", pick(a!, false), a!.storageKey);

  console.log("\nAn empty thumb buffer is treated as none, not as a file:");
  const emptyThumb = await createAttachment(
    clinicId,
    { patientId, kind: "xray", data: ORIGINAL, ext: "jpg", mime: "image/jpeg", thumb: Buffer.alloc(0) },
    actor,
  );
  const c = await getAttachmentForServe(clinicId, (emptyThumb as { id: string }).id);
  check("no zero-byte thumbnail was written", c?.thumbKey, null);

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      await cleanup();
    } catch {
      /* the seed clinic may not exist yet */
    }
  })
  .finally(async () => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
