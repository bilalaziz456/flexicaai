import type { ProcedureTemplate } from "@/core/types/module";

/**
 * Suggested dental procedures with indicative PKR prices — a starting point a
 * clinic can one-click import into its own catalog (the `sales` feature) and
 * then edit. Prices are placeholders; every clinic tunes its own.
 */
export const dentalProcedureTemplates: ProcedureTemplate[] = [
  { name: "Consultation", price: 1000 },
  { name: "Scaling & polishing (cleaning)", price: 3000 },
  { name: "Composite filling", price: 4000 },
  { name: "Root canal treatment (RCT)", price: 15000 },
  { name: "Tooth extraction", price: 4000 },
  { name: "Surgical extraction", price: 8000 },
  { name: "Dental crown", price: 18000 },
  { name: "Teeth whitening", price: 12000 },
  { name: "Denture (per arch)", price: 25000 },
  { name: "X-ray (per film)", price: 800 },
];
