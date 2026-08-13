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

// CURRENT BEHAVIOUR, and it is worth staring at: matching is exact, but the scribe
// writes the strength into the name ("Amoxicillin 500mg"), while the formulary lists
// "Amoxicillin". So a perfectly ordinary prescription is reported as not in the
// formulary. Every real note in the database looks like this, which means the warning
// fires almost every time and stops meaning anything. Asserted here so the day someone
// makes matching dose-aware, this test fails loudly and on purpose.
check(
  "exact matching flags a dose-suffixed formulary drug",
  noteWarnings(
    {
      prescriptions: [
        { drug: "Zerodol-SP" }, // genuinely not in the formulary
        { drug: "Amoxicillin 500mg" }, // IS in the formulary, as "Amoxicillin"
      ],
    },
    formulary,
    [],
  ).drugWarnings,
  ["Zerodol-SP", "Amoxicillin 500mg"],
);

// An allergy recorded AFTER the dictation is the reason resuming recomputes rather
// than replaying: the same note must warn once the allergy exists.
const note = { prescriptions: [{ drug: "Amoxicillin 500mg" }] };
check(
  "no allergy on file, no allergy warning",
  noteWarnings(note, formulary, []).allergyWarnings,
  [],
);

const allergies: Allergy[] = [{ substance: "amoxicillin", reaction: "rash", severity: null }];
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
