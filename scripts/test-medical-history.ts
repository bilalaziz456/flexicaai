/**
 * Unit tests for the medical-history allergy gate (pure, no DB).
 * Run: `npm run test:unit` (chained) or `tsx scripts/test-medical-history.ts`.
 */
import { allergyConflicts, asMedicalHistory } from "../src/core/lib/medical-history";
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

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
