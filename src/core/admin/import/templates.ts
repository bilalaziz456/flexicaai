import type { ImportEntity } from "./types";

/**
 * Downloadable template definitions — CLIENT-SAFE (no server-only/DB) so the import
 * UI can build a template file to hand the clinic. Column headers match the aliases
 * the validators accept (see patients.ts / procedures.ts). docs/import-plan.md.
 */
export const IMPORT_TEMPLATES: Record<ImportEntity, { columns: string[]; sample: string[]; note: string }> = {
  patients: {
    columns: ["full_name", "phone", "age", "gender", "address", "external_ref", "opening_balance", "registered_on", "reference"],
    sample: ["Ayesha Khan", "03001234567", "32", "female", "12 Mall Rd, Lahore", "OLD-1001", "5000", "2024-03-15", "Instagram"],
    note: "full_name is required. Use age OR a date_of_birth column. external_ref = the clinic's old patient number. opening_balance = current dues in PKR. registered_on = original first-visit date.",
  },
  procedures: {
    columns: ["name", "price", "module", "is_active"],
    sample: ["Scaling & polishing", "3000", "dental", "yes"],
    note: "name is required. price in PKR. is_active yes/no (default yes).",
  },
  visits: {
    columns: ["external_ref", "patient_name", "phone", "visit_date", "doctor", "diagnosis", "treatment", "note"],
    sample: ["OLD-1001", "Ayesha Khan", "03001234567", "2024-03-15", "Dr Bilal", "Caries 26", "Composite filling on 26", "Advised soft diet; review in 2 weeks"],
    note: "Identify the patient by external_ref (old number), phone, OR exact name. visit_date is optional (defaults to today). doctor is matched to staff by name if it exists. The note text is diagnosis + treatment + note combined; at least one is required.",
  },
};

/** A ready-to-fill CSV (header + one sample row). */
export function templateCsv(entity: ImportEntity): string {
  const t = IMPORT_TEMPLATES[entity];
  return `${t.columns.join(",")}\r\n${t.sample.join(",")}\r\n`;
}
