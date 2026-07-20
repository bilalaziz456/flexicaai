import type { TreatmentTemplate } from "@/core/types/module";

/**
 * Suggested dental treatment-plan templates. `items` are procedure NAMES; the plan
 * builder matches them to the clinic's priced `procedures` for snapshot prices. The
 * clinic edits freely after applying a template.
 */
export const dentalTreatmentTemplates: TreatmentTemplate[] = [
  { name: "Root canal + crown", items: ["Root canal treatment (RCT)", "Dental crown"] },
  { name: "Extraction + implant", items: ["Surgical extraction", "Implant"] },
  { name: "Scaling + fillings", items: ["Scaling & polishing (cleaning)", "Composite filling", "Composite filling"] },
  { name: "Full denture (upper + lower)", items: ["Denture (per arch)", "Denture (per arch)"] },
  { name: "Whitening course", items: ["Scaling & polishing (cleaning)", "Teeth whitening"] },
];
