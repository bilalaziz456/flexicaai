/**
 * Clinical note + chart validation (D-06 / ADR-007) — pure, no DB.
 *
 * `visits.note` and the module chart are `jsonb` written from CLIENT input: the
 * doctor edits the AI draft in the browser and posts the whole object back. It used
 * to go straight into the medical record unchecked and unbounded.
 *
 * HALF THIS FILE IS ABOUT WHAT MUST STILL BE ACCEPTED. Over-strictness here is not a
 * safe failure — it would reject real records the moment a clinician opened one to
 * edit, and there is already more than one valid shape in the database (the scribe's,
 * and imported historical visits). So the rejections are asserted, and so is every
 * shape that must keep working.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-clinical-validation.ts`
 */
import {
  MAX_NOTE_BYTES,
  parseClinicalChart,
  parseClinicalNote,
} from "../src/core/clinical/note-schema";
import { dentalChartSchema, dentalNoteSchema } from "../src/modules/dental/note-schema";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}
const accepts = (v: unknown) => parseClinicalNote(v, dentalNoteSchema).ok;
const rejects = (v: unknown) => !parseClinicalNote(v, dentalNoteSchema).ok;

console.log("Real notes are accepted (the failure mode that would hurt most):");
{
  // Exactly what prompts/scribe.ts asks the model for.
  check(
    "the full scribe shape",
    accepts({
      chiefComplaint: "Pain upper left",
      findings: [{ tooth: "26", finding: "Deep caries" }],
      diagnosis: "Irreversible pulpitis 26",
      treatmentPerformed: ["Pulpotomy 26"],
      treatmentPlan: ["RCT 26", "Crown 26"],
      prescriptions: [{ drug: "Amoxicillin", dosage: "500mg TDS", duration: "5 days" }],
      nextVisit: { reason: "RCT", afterDays: 7 },
      flags: [],
    }),
    true,
  );
  // The importer writes this shape for pre-FlexicaAI history.
  check("an imported historical visit", accepts({ imported: true, summary: "Cleaning", doctorName: "Dr A" }), true);
  check("an empty note (nothing dictated yet)", accepts({}), true);
  // The prompt explicitly tells the model to use null when unsure.
  check("nulls where the model was unsure", accepts({ chiefComplaint: null, diagnosis: null, nextVisit: null }), true);
  // A model that adds a field the prompt didn't ask for: keep it, don't reject it and
  // don't silently drop it — it's the clinician's content either way.
  {
    const r = parseClinicalNote({ chiefComplaint: "x", periodontalNotes: "generalised bleeding" }, dentalNoteSchema);
    check("an unexpected extra field is accepted", r.ok, true);
    check("…and preserved, not stripped", r.ok && (r.value as Record<string, unknown>).periodontalNotes, "generalised bleeding");
  }
  check("long clinical prose", accepts({ diagnosis: "a".repeat(5000) }), true);
}

console.log("\nStructure is enforced where the app READS it:");
{
  // Each of these silently loses clinical content downstream if let through: the
  // prescription never prints, the recall is never scheduled.
  check("prescriptions must be a list, not a string", rejects({ prescriptions: "Amoxicillin 500mg" }), true);
  check("findings must be a list", rejects({ findings: "caries on 26" }), true);
  check("treatmentPlan must be a list of strings", rejects({ treatmentPlan: [{ step: "RCT" }] }), true);
  check("nextVisit.afterDays must be a number", rejects({ nextVisit: { reason: "RCT", afterDays: "seven" } }), true);
  check("…and a real one", rejects({ nextVisit: { reason: "RCT", afterDays: Number.NaN } }), true);
}

console.log("\nThe payload is bounded, whatever its shape:");
{
  check("a note must be an object", rejects("just a string"), true);
  check("…not an array", rejects([{ chiefComplaint: "x" }]), true);

  // Depth: nested past the limit rather than merely unusual.
  let deep: Record<string, unknown> = { end: true };
  for (let i = 0; i < 12; i++) deep = { nested: deep };
  check("absurd nesting is refused", rejects(deep), true);

  // Size: the real abuse vector, since this row is read on every patient render.
  const huge = { diagnosis: "x".repeat(MAX_NOTE_BYTES + 1000) };
  check("a note over the byte cap is refused", rejects(huge), true);

  check("too many fields", rejects(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, i]))), true);
  check("an over-long list", rejects({ flags: Array.from({ length: 900 }, () => "f") }), true);
}

console.log("\nWithout a module schema, the bounds still apply:");
{
  // A clinic whose specialty declares no shape must not become a bypass.
  check("a free-form note is allowed", parseClinicalNote({ anything: "goes" }).ok, true);
  check("…but not an oversized one", parseClinicalNote({ x: "y".repeat(MAX_NOTE_BYTES + 10) }).ok, false);
  check("…and not a non-object", parseClinicalNote(42).ok, false);
}

console.log("\nThe chart (a tooth chart, for dental):");
{
  const ok = parseClinicalChart({ "26": { status: "caries", surfaces: ["O"], endo: false } }, dentalChartSchema);
  check("a valid odontogram entry", ok.ok, true);
  check("an absent chart is fine (nothing to save)", parseClinicalChart(undefined, dentalChartSchema).ok, true);
  // The chart is rendered by iterating its KEYS, so a junk key would draw a phantom
  // tooth in a clinical diagram.
  check("a non-FDI key is refused", parseClinicalChart({ "99x": { status: "caries" } }, dentalChartSchema).ok, false);
  // An unknown status has no colour, no abbreviation and no clinical meaning.
  check("an unknown status is refused", parseClinicalChart({ "26": { status: "sparkly" } }, dentalChartSchema).ok, false);
  check("every real status is accepted", parseClinicalChart({ "11": { status: "root_canal" }, "12": { status: "implant" } }, dentalChartSchema).ok, true);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
