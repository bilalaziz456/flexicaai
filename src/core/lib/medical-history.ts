/**
 * Medical history — CORE, specialty-agnostic (every specialty needs it).
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

/** How a medicine is taken — the "type" on the history form (owner's call, 2026-10-14). */
export const MEDICATION_FORMS = [
  { value: "oral", label: "Tablet / capsule (oral)" },
  { value: "syrup", label: "Syrup" },
  { value: "injection", label: "Injection" },
  { value: "inhaler", label: "Inhaler" },
  { value: "topical", label: "Cream / ointment" },
  { value: "drops", label: "Eye / ear drops" },
  { value: "nasal", label: "Nasal spray" },
  { value: "patch", label: "Patch" },
  { value: "other", label: "Other" },
] as const;
export type MedicationForm = (typeof MEDICATION_FORMS)[number]["value"];

/** How often — with the 1-0-1 notation the desk reads off a Pakistani prescription. */
export const MEDICATION_FREQUENCIES = [
  { value: "od", label: "Once daily (1-0-0)" },
  { value: "bd", label: "Twice daily (1-0-1)" },
  { value: "tds", label: "Three times (1-1-1)" },
  { value: "qid", label: "Four times daily" },
  { value: "hs", label: "At night (0-0-1)" },
  { value: "prn", label: "When needed" },
  { value: "weekly", label: "Weekly" },
  // Anything else — "2-2-2", "0-0-2", "½-0-½" — typed as written on the prescription
  // into `frequencyOther`.
  { value: "other", label: "Other (type it)" },
] as const;
export type MedicationFrequency = (typeof MEDICATION_FREQUENCIES)[number]["value"];

export const DURATION_UNITS = [
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]["value"];

/**
 * A medication the patient takes or took. Everything but the name is optional, and the
 * fields added on 2026-10-14 (form, frequency, duration, ongoing) are simply absent
 * from entries saved before — those keep working unchanged.
 *
 * `ongoing` is the one that matters most before treatment: "is the patient on this
 * NOW?" — blood thinners, bisphosphonates and diabetes medicines change what is safe.
 */
export type Medication = {
  name: string;
  dose?: string;
  note?: string;
  form?: MedicationForm;
  frequency?: MedicationFrequency;
  /** The pattern typed when `frequency` is "other" ("2-2-2", "0-0-2"). */
  frequencyOther?: string;
  /** How long it has been / was taken: `durationValue` `durationUnit` ("2 years"). */
  durationValue?: number;
  durationUnit?: DurationUnit;
  ongoing?: boolean;
};

const labelOf = <T extends { value: string; label: string }>(list: readonly T[], v: string | undefined) =>
  list.find((o) => o.value === v)?.label;

/** "Tablet / capsule (oral) · Twice daily (1-0-1) · for 2 years" — the details after the name. */
export function describeMedication(m: Medication): string {
  const parts: string[] = [];
  const form = labelOf(MEDICATION_FORMS, m.form);
  if (form) parts.push(form);
  // A typed pattern is shown as written; "Other" on its own says nothing, so it is left out.
  if (m.frequency === "other") {
    if (m.frequencyOther) parts.push(m.frequencyOther);
  } else {
    const freq = labelOf(MEDICATION_FREQUENCIES, m.frequency);
    if (freq) parts.push(freq);
  }
  if (m.durationValue && m.durationUnit) {
    const unit = m.durationValue === 1 ? m.durationUnit.replace(/s$/, "") : m.durationUnit;
    parts.push(`for ${m.durationValue} ${unit}`);
  }
  return parts.join(" · ");
}

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

/** A bounded string, or undefined — jsonb from a browser is not an exemption (conventions §4). */
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const oneOf = <T extends string>(list: readonly { value: T }[], v: unknown): T | undefined =>
  list.some((o) => o.value === v) ? (v as T) : undefined;
const MAX_ITEMS = 50;

function asAllergy(v: unknown): Allergy | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const substance = typeof o.substance === "string" ? o.substance.slice(0, 120) : "";
  return { substance, reaction: str(o.reaction, 200), severity: str(o.severity, 20) };
}

/** One medication, checked and bounded (also used for prescription lines). */
export function asMedication(v: unknown): Medication | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.slice(0, 120) : "";
  const value = Number(o.durationValue);
  const durationValue = Number.isInteger(value) && value > 0 && value <= 999 ? value : undefined;
  return {
    name,
    dose: str(o.dose, 60),
    note: str(o.note, 300),
    form: oneOf(MEDICATION_FORMS, o.form),
    frequency: oneOf(MEDICATION_FREQUENCIES, o.frequency),
    frequencyOther: o.frequency === "other" ? str(o.frequencyOther, 30) : undefined,
    durationValue,
    durationUnit: durationValue ? oneOf(DURATION_UNITS, o.durationUnit) : undefined,
    ongoing: o.ongoing === true ? true : undefined,
  };
}

/**
 * Normalise an unknown (jsonb — read back, or sent by the browser) into a well-formed
 * MedicalHistoryData. Every field is checked and BOUNDED, not passed through: the save
 * used to store whatever object the browser sent, which conventions §4 forbids for
 * jsonb. Unknown keys are dropped; entries saved before the medication fields existed
 * come through with those fields simply unset.
 */
export function asMedicalHistory(v: unknown): MedicalHistoryData {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.slice(0, MAX_ITEMS) : []);
  return {
    allergies: list(o.allergies).map(asAllergy).filter((a): a is Allergy => a !== null),
    conditions: list(o.conditions).filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 80)),
    medications: list(o.medications).map(asMedication).filter((m): m is Medication => m !== null),
    smoking: str(o.smoking, 120) ?? "",
    alcohol: str(o.alcohol, 120) ?? "",
    notes: str(o.notes, 2000) ?? "",
  };
}
