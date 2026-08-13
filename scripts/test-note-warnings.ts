/**
 * `core/ai/note-warnings.ts` — the formulary + allergy warnings shown above an AI
 * draft. Shared by the scribe route and the resume-a-draft path, so a regression
 * here changes what a doctor is warned about before prescribing.
 */

import { noteWarnings } from "@/core/ai/note-warnings";
import { getClinicWorkspace } from "@/config/modules";
import type { Allergy } from "@/core/lib/medical-history";

const formulary = getClinicWorkspace(["dental"]).drugFormulary;
let failed = 0;

function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

console.log(`dental formulary: ${formulary.length} drugs\n`);

// A drug the formulary knows, by generic name.
const known = formulary[0];
check(
  "known generic raises no warning",
  noteWarnings({ prescriptions: [{ drug: known.name }] }, formulary, []).drugWarnings,
  [],
);

// A brand name of that same drug is equally valid.
if (known.brands[0]) {
  check(
    "known brand raises no warning",
    noteWarnings({ prescriptions: [{ drug: known.brands[0] }] }, formulary, []).drugWarnings,
    [],
  );
}

// Case must not matter — the scribe transcribes free speech.
check(
  "matching is case-insensitive",
  noteWarnings({ prescriptions: [{ drug: known.name.toUpperCase() }] }, formulary, []).drugWarnings,
  [],
);

check(
  "unknown drug is flagged",
  noteWarnings({ prescriptions: [{ drug: "Fluxywoxitab 250mg" }] }, formulary, []).drugWarnings,
  ["Fluxywoxitab 250mg"],
);

// The scribe writes the strength into the name, so a dose-suffixed formulary drug
// must resolve. This is the case that made the warning fire on nearly every real
// note and taught everyone to ignore it.
const flagged = (...names: string[]) =>
  noteWarnings({ prescriptions: names.map((drug) => ({ drug })) }, formulary, []).drugWarnings;

check("dose-suffixed generic resolves", flagged("Amoxicillin 500mg"), []);
check("dose without a space", flagged("Ibuprofen 400mg"), []);
check("space between number and unit", flagged("Paracetamol 1 g"), []);
check("dose-suffixed brand resolves", flagged("Augmentin 625mg"), []);
check("strength plus dosage form", flagged("Chlorhexidine gluconate 0.2% mouthwash"), []);
check("dose in parentheses", flagged("Amoxicillin (500mg)"), []);
check("compound strength", flagged("Amoxicillin 250mg/5ml suspension"), []);
check("multi-word generic keeps its name", flagged("Mefenamic acid 500 mg"), []);

// A brand ending in a bare letter must survive peeling — "C" is not a unit.
check("brand with a trailing letter", flagged("Dalacin C"), []);

// A combination that IS in the formulary, written with its dose.
check(
  "formulary combination with a dose",
  flagged("Amoxicillin + Clavulanic acid 625mg"),
  [],
);

// The reason this peels only trailing tokens instead of matching on prefix: a
// combination product is NOT the single drug it starts with, and must still warn.
check(
  "combination product is still flagged",
  flagged("Ibuprofen + Codeine 400mg"),
  ["Ibuprofen + Codeine 400mg"],
);
check("unknown drug with a dose is still flagged", flagged("Zerodol-SP 100mg"), ["Zerodol-SP 100mg"]);
check("a bare dose is not a drug", flagged("500mg"), ["500mg"]);

check(
  "known and unknown together",
  flagged("Zerodol-SP", "Amoxicillin 500mg"),
  ["Zerodol-SP"],
);

// An allergy recorded AFTER the dictation is the reason resuming recomputes rather
// than replaying: the same note must warn once the allergy exists.
const note = { prescriptions: [{ drug: "Amoxicillin 500mg" }] };
check(
  "no allergy on file, no allergy warning",
  noteWarnings(note, formulary, []).allergyWarnings,
  [],
);

const allergies: Allergy[] = [{ substance: "amoxicillin", reaction: "rash" }];
const withAllergy = noteWarnings(note, formulary, allergies).allergyWarnings;
check("allergy recorded later now warns", withAllergy.length, 1);
console.log(`        → ${JSON.stringify(withAllergy[0])}`);

// Malformed / absent notes must not throw — the AI can return anything.
check("note with no prescriptions", noteWarnings({}, formulary, []).drugWarnings, []);
check(
  "prescriptions not an array",
  noteWarnings({ prescriptions: "amoxil" }, formulary, []).drugWarnings,
  [],
);
check(
  "prescription entries missing drug",
  noteWarnings({ prescriptions: [{}, { drug: null }] }, formulary, []).drugWarnings,
  [],
);

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
