/**
 * The typed note's empty form (2026-11-18): it opens on fields to type into, and what
 * is left empty never reaches the record. Pure — no database.
 *   npx tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-note-template.ts
 */
import { GENERIC_BLANK_NOTE, blankNoteFrom, pruneEmptyNote } from "@/core/clinical/note-template";
import { parseClinicalNote } from "@/core/clinical/note-schema";
import { dentalBlankNote, dentalNoteSchema } from "@/modules/dental/note-schema";
import { asPrescriptionItems, itemToNoteDrug, noteDrugToItem } from "@/core/lib/prescription-items";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

console.log("The blank note:");
ok("dental opens with a diagnosis box", "diagnosis" in dentalBlankNote);
ok("dental opens with a clinical notes box", "clinicalNotes" in dentalBlankNote);
ok("no treatment performed / plan (owner, 2026-11-18)", !("treatmentPerformed" in dentalBlankNote) && !("treatmentPlan" in dentalBlankNote));
ok("medicines are not note fields (they are prescription rows)", !("prescriptions" in dentalBlankNote));
ok("no module → the generic note", blankNoteFrom(undefined).diagnosis === null && "clinicalNotes" in GENERIC_BLANK_NOTE);
const a = blankNoteFrom(dentalBlankNote);
(a.findings as Record<string, unknown>[])[0].finding = "Caries";
ok("a copy — editing one form never changes the template", (dentalBlankNote.findings as Record<string, unknown>[])[0].finding === null);

console.log("Saved untouched:");
const untouched = parseClinicalNote(pruneEmptyNote(blankNoteFrom(dentalBlankNote)), dentalNoteSchema);
ok("is valid", untouched.ok, untouched);
if (untouched.ok) {
  ok("no empty finding row", (untouched.value.findings as unknown[]).length === 0);
  ok("an untouched next visit is no recall", untouched.value.nextVisit === null);
}

console.log("Filled in:");
const filled = blankNoteFrom(dentalBlankNote);
filled.diagnosis = "Irreversible pulpitis 36";
filled.clinicalNotes = "Access opening done.\nReview in a week.";
filled.findings = [{ tooth: "36", finding: "Deep caries" }, { tooth: null, finding: "  " }];
filled.nextVisit = { reason: "RCT completion", afterDays: "7" };
const r = parseClinicalNote(pruneEmptyNote(filled), dentalNoteSchema);
ok("is valid", r.ok, r);
if (r.ok) {
  ok("keeps the diagnosis", r.value.diagnosis === "Irreversible pulpitis 36");
  ok("keeps the clinical notes", r.value.clinicalNotes === "Access opening done.\nReview in a week.");
  ok("drops the blank finding row", (r.value.findings as unknown[]).length === 1);
  const nv = r.value.nextVisit as { afterDays: unknown };
  ok("after days typed as text is stored as a number", nv.afterDays === 7, nv);
}
const bad = blankNoteFrom(dentalBlankNote);
bad.nextVisit = { reason: "Review", afterDays: "next week" };
const rb = parseClinicalNote(pruneEmptyNote(bad), dentalNoteSchema);
ok("after days that is not a number is refused", !rb.ok, rb);

console.log("Prescription rows <-> the note:");
const line = { name: "Augmentin 625mg", dose: "1 tab", form: "oral", frequency: "bd", instruction: "after_meal", durationValue: 5, durationUnit: "days", note: "with water" };
const nd = itemToNoteDrug(line as never);
ok("the note keeps drug / dosage / duration for every reader", nd.drug === "Augmentin 625mg" && nd.duration === "5 days" && Boolean(nd.dosage?.startsWith("1 tab")), nd);
const back = noteDrugToItem(nd);
ok("the patient's prescription gets the FULL line back", back?.frequency === "bd" && back?.form === "oral" && back?.durationValue === 5 && back?.note === "with water", back);
ok("one day reads '1 day'", itemToNoteDrug({ name: "X", durationValue: 1, durationUnit: "days" }).duration === "1 day");
ok("an AI draft's line still converts", noteDrugToItem({ drug: "Ibuprofen", dosage: "400mg", duration: "3 days" })?.durationValue === 3);
const fromForm = asPrescriptionItems([line, { name: "" }]).map(itemToNoteDrug);
ok("an empty medicine row is dropped", fromForm.length === 1);
const withRx = parseClinicalNote({ ...pruneEmptyNote(blankNoteFrom(dentalBlankNote)), prescriptions: fromForm }, dentalNoteSchema);
ok("a note with prescription rows is valid", withRx.ok, withRx);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
