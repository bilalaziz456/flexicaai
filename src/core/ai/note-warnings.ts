import type { Drug } from "@/core/types/module";
import type { Allergy } from "@/core/lib/medical-history";
import { allergyConflicts } from "@/core/lib/medical-history";

/** Units a strength is written in. Bare `g`/`l`/`u` are here but only ever consumed
 *  when a number sits immediately before them, so a brand like "Dalacin C" is safe. */
const UNIT = "mg|mcg|ug|µg|g|kg|ml|l|iu|u|units?|%";

/** One token that is entirely a strength: "500mg", "0.2%", "250mg/5ml", "1:100000". */
const STRENGTH_TOKEN = new RegExp(
  `^\\d+(?:\\.\\d+)?\\s*(?:${UNIT})?(?:\\s*/\\s*\\d+(?:\\.\\d+)?\\s*(?:${UNIT})?)?$|^\\d+:\\d+$`,
  "i",
);

/** A token that is only a unit ("mg"), valid to drop when a number precedes it. */
const UNIT_ONLY = new RegExp(`^(?:${UNIT})$`, "i");

/** How the drug is presented, never part of its name. */
const DOSAGE_FORM =
  /^(?:tabs?|tablets?|caps?|capsules?|syrups?|susp|suspensions?|inj|injections?|gels?|creams?|ointments?|drops?|mouthwash(?:es)?|rinses?|pastes?|solutions?|sachets?|lotions?|sprays?)$/i;

/**
 * A prescribed drug reduced to just its name, for formulary lookup.
 *
 * The scribe transcribes what the dentist says, so a prescription arrives as
 * "Amoxicillin 500mg" while the formulary lists "Amoxicillin". Compared literally
 * those differ, so the "not in the formulary" warning fired on essentially every
 * prescription — and a safety warning that fires every time is one nobody reads.
 *
 * Only TRAILING strength and dosage-form tokens are removed, and the result must
 * still match a formulary entry exactly. That distinction matters: it is why
 * "Ibuprofen 400mg" resolves to a known drug while "Ibuprofen + Codeine 400mg" does
 * not, and is still flagged. A prefix match would have quietly accepted the second.
 */
export function drugNameOnly(raw: string): string {
  // A parenthetical is a strength or a note, never the name: "Amoxicillin (500mg)".
  let tokens = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Peel from the right until what remains is the name.
  for (let changed = true; changed && tokens.length > 1; ) {
    changed = false;
    const last = tokens[tokens.length - 1];
    if (DOSAGE_FORM.test(last) || STRENGTH_TOKEN.test(last)) {
      tokens = tokens.slice(0, -1);
      changed = true;
    } else if (
      UNIT_ONLY.test(last) &&
      tokens.length > 2 &&
      /^\d+(?:\.\d+)?$/.test(tokens[tokens.length - 2])
    ) {
      // "paracetamol 1 g" — the unit is only safe to drop with its number.
      tokens = tokens.slice(0, -2);
      changed = true;
    }
  }

  // Trailing joiners left behind by peeling, e.g. "amoxicillin +".
  return tokens.join(" ").replace(/[\s+,\-/]+$/, "").trim();
}

/**
 * The two warnings a doctor sees above an AI draft: drugs the note prescribes that
 * are not in the module formulary, and drugs that conflict with a recorded allergy.
 * Both are warnings, never a hard block (CLAUDE.md §8) — the clinician decides.
 *
 * Lives here because it is computed twice: once when the scribe first drafts a note,
 * and again when a draft is resumed unapproved. Nothing stores the warnings on the
 * visit, so the resume path has to recompute them, and two copies of this would
 * eventually disagree about what is safe to prescribe.
 *
 * Core-safe: the caller passes the formulary in, so this never learns a specialty.
 */
export function noteWarnings(
  note: Record<string, unknown>,
  formulary: Drug[],
  allergies: Allergy[],
): { drugWarnings: string[]; allergyWarnings: string[] } {
  const entries = formulary.flatMap((d) => [d.name, ...d.brands]);
  // Both sides are normalised, so a formulary that ever gains a dose-bearing brand
  // ("Augmentin 625mg") keeps matching.
  const known = new Set([
    ...entries.map((s) => s.toLowerCase().trim()),
    ...entries.map(drugNameOnly),
  ]);

  const prescriptions = Array.isArray(note.prescriptions)
    ? (note.prescriptions as { drug?: string }[])
    : [];
  const drugs = prescriptions
    .map((p) => p?.drug)
    .filter((drug): drug is string => typeof drug === "string");

  return {
    drugWarnings: drugs.filter((drug) => {
      const lower = drug.toLowerCase().trim();
      return !known.has(lower) && !known.has(drugNameOnly(drug));
    }),
    allergyWarnings: drugs.flatMap((drug) => {
      const hits = allergyConflicts(allergies, drug);
      return hits.length ? [`${drug}. Allergy: ${hits.join(", ")}`] : [];
    }),
  };
}
