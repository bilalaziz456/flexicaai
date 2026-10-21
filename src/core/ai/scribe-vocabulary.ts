import "server-only";
import { medicineSuggestions, mostPrescribedMedicineNames } from "@/core/clinical/medicines";

/**
 * The vocabulary hint for speech-to-text: words a dictation is likely to contain, so
 * Whisper spells them right instead of reaching for a common word that sounds alike
 * ("Augmentin" heard as "argument in"). Whisper's `prompt` field is its documented way
 * to do this (owner's call, 2026-10-20).
 *
 * LAYERED like everything else here, and core names no specialty:
 *   1. core's general clinical words (below), the same for every specialty;
 *   2. the enabled module's own terms (ModuleDefinition.scribeVocabulary), handed in;
 *   3. medicine names — the clinic's own first, then its specialty's, then the rest,
 *      exactly the order the prescription form suggests them (core/clinical/medicines).
 *
 * THE BUDGET IS THE CONSTRAINT. Whisper reads at most ~224 tokens of hint and, when
 * given more, keeps the END and drops the start — so this is cut to a size it reads
 * whole, filling with medicines only after the words that matter most are in.
 */

/** Said in every specialty's dictation, and easy to mishear. */
const CORE_TERMS = [
  "patient", "complaining of", "on examination", "diagnosis", "treatment plan",
  "prescribed", "mg", "twice daily", "three times daily", "after meals",
  "follow-up", "allergic to", "diabetic", "hypertensive",
];

/**
 * Each layer's share, in characters, so none can crowd out the next — the first
 * version gave the module's terms the whole budget and no medicine was ever included.
 * Measured with Whisper's own tokenizer (2026-10-20): clinical words run ~3.6
 * characters per token, brand names only ~2.2 (the tokenizer splits "Augmentin" into
 * pieces). These come to roughly 55 + 85 + 70 = 210 tokens, under the ~224 it reads.
 */
const BUDGET = { core: 200, module: 300, medicines: 160 } as const;

export async function buildScribeVocabulary(
  clinicId: string,
  modulesEnabled: readonly string[],
  moduleTerms: readonly string[] = [],
): Promise<string> {
  const words: string[] = [];
  const seen = new Set<string>();
  // Fills one layer up to its share; a word that does not fit is skipped, not cut.
  const fill = (candidates: Iterable<string>, budget: number) => {
    let used = 0;
    for (const w of candidates) {
      const word = w.trim();
      const key = word.toLowerCase();
      if (!word || seen.has(key) || used + word.length + 2 > budget) continue;
      seen.add(key);
      words.push(word);
      used += word.length + 2;
    }
  };

  fill(CORE_TERMS, BUDGET.core);
  fill(moduleTerms, BUDGET.module);
  // What this clinic actually prescribes most comes first — alphabetical order spent
  // the budget on Acyclovir and Adrenaline and left out Brufen and Flagyl. Then the
  // suggestion order. "Amoxicillin (suspension)" is the same spoken word as
  // "Amoxicillin"; the bracket only tells two list entries apart.
  const [usual, suggested] = await Promise.all([
    mostPrescribedMedicineNames(clinicId),
    medicineSuggestions(clinicId, modulesEnabled),
  ]);
  const medicines = [...usual, ...suggested.map((s) => s.value)].map((v) => v.replace(/\s*\(.*\)\s*$/, ""));
  fill(medicines, BUDGET.medicines);
  return `${words.join(", ")}.`;
}
