/**
 * Unit tests for the medical-history allergy gate (pure, no DB).
 * Run: `npm run test:unit` (chained) or `tsx scripts/test-medical-history.ts`.
 */
import { allergyConflicts, asMedicalHistory, describeMedication } from "../src/core/lib/medical-history";
import type { Allergy } from "../src/core/lib/medical-history";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const pen: Allergy[] = [{ substance: "Penicillin" }];
const latex: Allergy[] = [{ substance: "Latex" }];

console.log("Allergy gate:");
check("penicillin allergy conflicts with amoxicillin (class)", allergyConflicts(pen, "Amoxicillin"), ["Penicillin"]);
check("penicillin allergy conflicts with Augmentin", allergyConflicts(pen, "Augmentin 625mg"), ["Penicillin"]);
check("penicillin allergy does NOT conflict with metronidazole", allergyConflicts(pen, "Metronidazole"), []);
check("direct substance match (aspirin)", allergyConflicts([{ substance: "Aspirin" }], "Aspirin 75"), ["Aspirin"]);
check("NSAID allergy conflicts with ibuprofen", allergyConflicts([{ substance: "NSAIDs" }], "Ibuprofen 400"), ["NSAIDs"]);
check("latex allergy does not conflict with a drug", allergyConflicts(latex, "Paracetamol"), []);
check("empty allergies → no conflict", allergyConflicts([], "Amoxicillin"), []);

console.log("\nNormalisation:");
check("asMedicalHistory fills defaults", asMedicalHistory(null), {
  allergies: [], conditions: [], medications: [], smoking: "", alcohol: "", notes: "",
});

// Medication details (2026-10-14) and the bounds on what the browser may store.
console.log("\nMedications:");
const meds = asMedicalHistory({
  medications: [
    { name: "Warfarin", dose: "5 mg", form: "oral", frequency: "od", durationValue: 2, durationUnit: "years", ongoing: true },
    { name: "Old entry", dose: "10 mg" },
    { name: "Bad", form: "<script>", frequency: "hourly", durationValue: -3, durationUnit: "decades", ongoing: "yes", extra: "x" },
  ],
}).medications;
check("a full entry comes through", meds[0], {
  name: "Warfarin", dose: "5 mg", form: "oral", frequency: "od", durationValue: 2, durationUnit: "years", ongoing: true,
});
check("an entry saved before the new fields still works", meds[1], { name: "Old entry", dose: "10 mg" });
check("unknown type / frequency / unit / junk keys are dropped", meds[2], { name: "Bad" });
check("details read naturally", describeMedication(meds[0]), "Tablet / capsule (oral) · Once daily (1-0-0) · for 2 years");
check("one unit is singular", describeMedication({ name: "x", durationValue: 1, durationUnit: "weeks" }), "for 1 week");
const typed = asMedicalHistory({ medications: [{ name: "Lipigey", frequency: "other", frequencyOther: "2-2-2" }] }).medications[0];
check("a typed pattern is kept with Other", typed.frequencyOther, "2-2-2");
check("…and shown as written", describeMedication(typed), "2-2-2");
check(
  "a typed pattern without Other is dropped",
  asMedicalHistory({ medications: [{ name: "x", frequency: "bd", frequencyOther: "2-2-2" }] }).medications[0].frequencyOther,
  undefined,
);
check("lists are capped at 50", asMedicalHistory({ medications: Array.from({ length: 80 }, () => ({ name: "m" })) }).medications.length, 50);
check("long text is cut", asMedicalHistory({ notes: "n".repeat(5000) }).notes?.length, 2000);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
