import type { Drug } from "@/core/types/module";
import type { Allergy } from "@/core/lib/medical-history";
import { allergyConflicts } from "@/core/lib/medical-history";

/**
 * The two warnings a doctor sees above an AI draft: drugs the note prescribes that
 * are not in the module formulary, and drugs that conflict with a recorded allergy.
 * Both are warnings, never a hard block (CLAUDE.md §8) — the doctor decides.
 *
 * Lives here because it is computed twice: once when the scribe first drafts a note,
 * and again when a doctor resumes a draft they left unapproved. Nothing stores the
 * warnings on the visit, so the resume path has to recompute them, and two copies of
 * this would eventually disagree about what is safe to prescribe.
 *
 * Core-safe: the caller passes the formulary in, so this never learns a specialty.
 */
export function noteWarnings(
  note: Record<string, unknown>,
  formulary: Drug[],
  allergies: Allergy[],
): { drugWarnings: string[]; allergyWarnings: string[] } {
  const known = new Set(
    formulary.flatMap((d) => [d.name, ...d.brands]).map((s) => s.toLowerCase()),
  );
  const prescriptions = Array.isArray(note.prescriptions)
    ? (note.prescriptions as { drug?: string }[])
    : [];
  const drugs = prescriptions
    .map((p) => p?.drug)
    .filter((drug): drug is string => typeof drug === "string");

  return {
    drugWarnings: drugs.filter((drug) => !known.has(drug.toLowerCase())),
    allergyWarnings: drugs.flatMap((drug) => {
      const hits = allergyConflicts(allergies, drug);
      return hits.length ? [`${drug}. Allergy: ${hits.join(", ")}`] : [];
    }),
  };
}
