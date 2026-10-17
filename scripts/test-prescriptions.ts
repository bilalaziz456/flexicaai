/**
 * Typed prescriptions on the clinic's letterhead (owner's call, 2026-10-14):
 *  - the record — created, edited, refused when the doctor or appointment is not the
 *    clinic's / the patient's, moved to Trash and restored;
 *  - the lines — checked and bounded like the medical history's medications;
 *  - the PDF — A4, on a letterhead PDF or image, on the plain header without one, on
 *    the pad (no background), and continued onto a second page when long.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-prescriptions.ts`
 */
import { eq, sql } from "drizzle-orm";
import { PDFDocument, rgb } from "pdf-lib";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, prescriptions, users } from "@/core/db/schema";
import {
  createPrescription,
  listPrescriptions,
  softDeletePrescription,
  updatePrescription,
} from "@/core/patients/prescriptions";
import { asPrescriptionItems, checkPrescription } from "@/core/lib/prescription-items";
import { A4_H, A4_W, generateLetterheadPrescriptionPdf } from "@/core/lib/letterhead-pdf";
import { buildLetterheadPrescriptionPdf } from "@/core/clinics/letterhead";
import { listClinicTrash, restoreForClinic } from "@/core/trash";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function pages(pdf: Uint8Array) {
  const d = await PDFDocument.load(pdf);
  return d.getPages().map((p) => p.getSize());
}

async function main() {
  console.log("Lines are checked and bounded:");
  const items = asPrescriptionItems([
    { name: " Augmentin ", dose: "625 mg", form: "oral", frequency: "bd", durationValue: 5, durationUnit: "days", ongoing: true, note: "x" },
    { name: "" },
    { name: "Bad", form: "<b>", frequency: "other", frequencyOther: "2-2-2" },
  ]);
  ok("an empty line is dropped", items.length === 2);
  ok("names are trimmed; ongoing is not a prescription field; the note stays", items[0].name === "Augmentin" && !("ongoing" in items[0]) && items[0].note === "x");
  ok("an unknown type is dropped, a typed pattern kept", items[1].form === undefined && items[1].frequencyOther === "2-2-2");
  ok("at most 30 lines", asPrescriptionItems(Array.from({ length: 50 }, () => ({ name: "m" }))).length === 30);

  console.log("\nThe checks before saving (form and server):");
  const good = { doctorId: "d", prescribedOn: "2026-10-14", items: [{ name: "Augmentin" }], notes: "" };
  const today = "2026-10-14";
  ok("a complete prescription passes", checkPrescription(good, today).length === 0);
  ok("no doctor is refused", checkPrescription({ ...good, doctorId: "" }, today)[0]?.field === "doctor");
  ok("a future date is refused", checkPrescription({ ...good, prescribedOn: "2026-10-15" }, today)[0]?.field === "date");
  ok("an impossible date is refused", checkPrescription({ ...good, prescribedOn: "2026-02-31" }, today)[0]?.field === "date");
  ok("no medicine is refused", checkPrescription({ ...good, items: [{ name: "" }] }, today)[0]?.field === "items");
  const noName = checkPrescription({ ...good, items: [{ name: "Augmentin" }, { name: "", dose: "5 mg" }] }, today);
  ok("a filled row without a name is refused, on its own line", noName[0]?.field === "line" && noName[0]?.line === 1);
  ok("an empty spare row is ignored", checkPrescription({ ...good, items: [{ name: "Augmentin" }, { name: "" }] }, today).length === 0);
  ok("'Other' frequency needs the pattern", checkPrescription({ ...good, items: [{ name: "A", frequency: "other" }] }, today)[0]?.line === 0);

  console.log("\nThe PDF:");
  // A stand-in letterhead: an A4 page with a coloured header band.
  const lh = await PDFDocument.create();
  const lp = lh.addPage([A4_W, A4_H]);
  lp.drawRectangle({ x: 0, y: A4_H - 120, width: A4_W, height: 120, color: rgb(0.1, 0.4, 0.6) });
  const letterhead = { bytes: await lh.save(), kind: "pdf" as const };
  const base = {
    margins: { topMm: 50, bottomMm: 30, leftMm: 20, rightMm: 20 },
    clinic: { name: "Test Clinic", address: "Gulberg, Lahore" },
    patient: { name: "Sample", mrn: "FA-100001", ageGender: "34 yrs / Female" },
    date: new Date(),
    doctorName: "Dr. Test",
    items: [{ name: "Augmentin", dose: "625 mg", detail: "Tablet / capsule (oral) · Twice daily (1-0-1) · for 5 days" }],
    notes: "After meals.",
  };
  const onLetterhead = await pages(await generateLetterheadPrescriptionPdf({ ...base, letterhead }));
  ok("on a letterhead: one A4 page", onLetterhead.length === 1 && Math.round(onLetterhead[0].width) === 595 && Math.round(onLetterhead[0].height) === 842);
  ok("without a letterhead: the plain header, still A4", (await pages(await generateLetterheadPrescriptionPdf({ ...base, letterhead: null }))).length === 1);
  ok("on the pad: renders with no background", (await pages(await generateLetterheadPrescriptionPdf({ ...base, letterhead, pad: true }))).length === 1);
  const long = await pages(
    await generateLetterheadPrescriptionPdf({ ...base, letterhead, items: Array.from({ length: 40 }, (_, i) => ({ name: `Medicine ${i + 1}`, detail: "Twice daily (1-0-1)" })) }),
  );
  ok("a long prescription continues on another page", long.length >= 2, String(long.length));
  ok(
    "an unreadable letterhead falls back instead of failing",
    (await pages(await generateLetterheadPrescriptionPdf({ ...base, letterhead: { bytes: new Uint8Array([1, 2, 3]), kind: "pdf" } }))).length === 1,
  );

  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [c] = await db.insert(clinics).values({ name: `rx${Date.now()}`, modulesEnabled: ["dental"] }).returning({ id: clinics.id });
    const [other] = await db.insert(clinics).values({ name: `rx-other${Date.now()}`, modulesEnabled: ["dental"] }).returning({ id: clinics.id });
    const cid = c.id;
    try {
      const [doc] = await db.insert(users).values({ clinicId: cid, username: `rxd${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Rx Doc", prefix: "Dr" }).returning({ id: users.id });
      const [foreignDoc] = await db.insert(users).values({ clinicId: other.id, username: `rxf${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Elsewhere" }).returning({ id: users.id });
      const [pt] = await db.insert(patients).values({ clinicId: cid, fullName: "Rx Patient", mrnLabel: "FA-100009", mrn: 100009 }).returning({ id: patients.id });
      const [pt2] = await db.insert(patients).values({ clinicId: cid, fullName: "Other Patient" }).returning({ id: patients.id });
      const [otherAppt] = await db.insert(appointments).values({ clinicId: cid, patientId: pt2.id, scheduledAt: new Date() }).returning({ id: appointments.id });
      const actor = { id: doc.id, name: "Front Desk" };
      const input = {
        patientId: pt.id,
        appointmentId: null,
        doctorId: doc.id,
        prescribedOn: "2026-10-14",
        items,
        notes: "After meals.",
      };

      console.log("\nThe record:");
      ok("a doctor of another clinic is refused", "error" in (await createPrescription(cid, { ...input, doctorId: foreignDoc.id }, actor)));
      ok("another patient's appointment is refused", "error" in (await createPrescription(cid, { ...input, appointmentId: otherAppt.id }, actor)));
      const made = await createPrescription(cid, input, actor);
      ok("a valid prescription is saved", "id" in made, JSON.stringify(made));
      const id = "id" in made ? made.id : "";
      let list = await listPrescriptions(cid, pt.id);
      ok("it is listed, with the doctor's name and who typed it", list.length === 1 && list[0].doctorName === "Rx Doc" && list[0].createdByName === "Front Desk");
      ok("…and not for another clinic", (await listPrescriptions(other.id, pt.id)).length === 0);
      await updatePrescription(cid, id, { ...input, notes: "Review in a week." });
      list = await listPrescriptions(cid, pt.id);
      ok("an edit is saved", list[0].notes === "Review in a week.");

      const pdf = await buildLetterheadPrescriptionPdf(cid, id);
      ok("the PDF builds from the record (no letterhead yet)", Boolean(pdf && pdf.pdf.length > 500 && pdf.filename.includes("Rx Patient")));
      ok("…but not from another clinic", (await buildLetterheadPrescriptionPdf(other.id, id)) === null);

      console.log("\nTrash:");
      ok("delete moves it to Trash", await softDeletePrescription(cid, id, doc.id));
      ok("…so the list no longer shows it", (await listPrescriptions(cid, pt.id)).length === 0);
      const trash = await listClinicTrash(cid, 30);
      const item = trash.items.find((t) => t.entity === "prescription" && t.id === id);
      ok("Trash lists it as a prescription", Boolean(item), JSON.stringify(trash.items.map((t) => t.entity)));
      if (item) await restoreForClinic(cid, item.group);
      ok("Restore brings it back", (await listPrescriptions(cid, pt.id)).length === 1);
    } finally {
      for (const id of [cid, other.id]) {
        await db.execute(sql`delete from activity_logs where clinic_id = ${id}::uuid`);
        await db.delete(prescriptions).where(eq(prescriptions.clinicId, id));
        await db.delete(appointments).where(eq(appointments.clinicId, id));
        await db.delete(patients).where(eq(patients.clinicId, id));
        await db.delete(users).where(eq(users.clinicId, id));
        await db.delete(clinics).where(eq(clinics.id, id));
      }
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
