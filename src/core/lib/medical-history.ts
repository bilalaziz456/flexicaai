/**
 * Medical & dental history — CORE, specialty-agnostic (every specialty needs it).
 * PURE (no DB / no server-only) so the schema types, the allergy gate in the scribe,
 * and client forms all share one source of truth. See docs/dental-clinical-plan.md §3.
 */

/** A recorded allergy (drug or material). */
export type Allergy = {
  substance: string;
  reaction?: string;
  /** free text: mild | moderate | severe */
  severity?: string;
};

/** A current medication the patient takes. */
export type Medication = {
  name: string;
  dose?: string;
  note?: string;
};

/** The medical-history payload (jsonb-shaped). */
export type MedicalHistoryData = {
  allergies: Allergy[];
  /** Checked conditions from `MEDICAL_CONDITIONS` (by label). */
  conditions: string[];
  medications: Medication[];
  smoking?: string;
  alcohol?: string;
  notes?: string;
};

/** Common medical conditions that matter for dental treatment / prescribing. */
export const MEDICAL_CONDITIONS: string[] = [
  "Diabetes",
  "Hypertension",
  "Heart disease / valve / stent",
  "Bleeding disorder / blood thinners",
  "Bisphosphonates",
  "Asthma / COPD",
  "Epilepsy / seizures",
  "Hepatitis / liver disease",
  "Kidney disease",
  "Thyroid disorder",
  "Pregnancy",
  "Immunocompromised",
];

/**
 * Drug-class links: an allergy substance matching `match` conflicts with any drug
 * whose name matches `drugs`. Best-effort (the doctor confirms) — covers the common
 * dental cross-reactions (penicillins, sulfa, NSAIDs) that a plain substring misses.
 */
const ALLERGY_CLASSES: { match: RegExp; drugs: RegExp; label: string }[] = [
  { label: "penicillin", match: /penicillin|amoxicillin|augmentin|ampicillin/i, drugs: /cillin|penicillin|amoxi|ampi|augmentin|co-?amoxiclav/i },
  { label: "sulfa", match: /sulfa|sulph|cotrimoxazole|septran|bactrim/i, drugs: /sulfa|sulph|cotrimoxazole|septran|bactrim/i },
  { label: "NSAID", match: /nsaid|ibuprofen|aspirin|diclofenac|naproxen|brufen/i, drugs: /ibuprofen|aspirin|diclofenac|naproxen|brufen|mefenamic|ketorolac/i },
  { label: "cephalosporin", match: /cephalosporin|cef|ceph/i, drugs: /\bcef|\bceph/i },
  { label: "metronidazole", match: /metronidazole|flagyl/i, drugs: /metronidazole|flagyl/i },
];

/**
 * The recorded allergies that conflict with a prescribed drug — by direct substance
 * match OR a shared drug class. Returns the conflicting substance labels (empty = safe).
 */
export function allergyConflicts(allergies: Allergy[], drugName: string): string[] {
  const dn = (drugName ?? "").toLowerCase().trim();
  if (!dn) return [];
  const hits = new Set<string>();
  for (const a of allergies) {
    const sub = (a.substance ?? "").toLowerCase().trim();
    if (!sub) continue;
    if (dn.includes(sub) || sub.includes(dn)) {
      hits.add(a.substance);
      continue;
    }
    for (const c of ALLERGY_CLASSES) {
      if (c.match.test(sub) && c.drugs.test(dn)) {
        hits.add(a.substance);
        break;
      }
    }
  }
  return [...hits];
}

/** Normalise an unknown (jsonb) into a well-formed MedicalHistoryData. */
export function asMedicalHistory(v: unknown): MedicalHistoryData {
  const o = (v && typeof v === "object" ? v : {}) as Partial<MedicalHistoryData>;
  return {
    allergies: Array.isArray(o.allergies) ? o.allergies : [],
    conditions: Array.isArray(o.conditions) ? o.conditions : [],
    medications: Array.isArray(o.medications) ? o.medications : [],
    smoking: typeof o.smoking === "string" ? o.smoking : "",
    alcohol: typeof o.alcohol === "string" ? o.alcohol : "",
    notes: typeof o.notes === "string" ? o.notes : "",
  };
}
