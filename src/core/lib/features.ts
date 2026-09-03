/**
 * Optional platform features — CORE, specialty-agnostic (CLAUDE.md §1/§4).
 *
 * These are per-clinic capabilities the SUPER ADMIN switches on for a clinic,
 * independent of which specialty modules (dental/derma/hair) it runs. A feature
 * gate answers "may THIS clinic see this option?" — e.g. the owner's Revenue
 * dashboard. Stored on `clinics.features_enabled` (a text[] mirroring
 * `modules_enabled`); empty by default, so every feature is opt-in.
 *
 * This is intentionally a tiny, flat list — NOT a big registry. Add a feature id
 * here + a checkbox in the admin panel + a `clinicHasFeature` gate at the call
 * site. Core never hardcodes a specialty, so these work across all modules.
 */
export interface ClinicFeature {
  id: string;
  name: string;
  description: string;
}

export const CLINIC_FEATURES = [
  {
    id: "revenue_dashboard",
    name: "Revenue dashboard",
    description:
      "Show the owner's “Revenue Recovered” metric and average-visit-value setting on the clinic dashboard.",
  },
  {
    id: "sales",
    name: "Sales & procedures",
    description:
      "Priced procedures the clinic manages, procedure selection on appointments, and the Sales report (revenue from completed visits).",
  },
  {
    id: "finance",
    name: "Finance (expenses & P&L)",
    description:
      "Clinic expenses, the Profit & Loss report, and the unified finance reports/dashboard KPIs. Owner-level, and needs the sales feature for full revenue figures.",
  },
  {
    id: "whatsapp_ai",
    name: "WhatsApp AI assistant",
    description:
      "Understand free-form and Roman Urdu patient messages that the plain-text parser misses, and reply with the request written out for the patient to confirm. BILLABLE: unlike every other feature here, this costs money per message read.",
  },
  {
    id: "whatsapp_prices",
    name: "WhatsApp price replies",
    description:
      "Answer “how much is X?” from this clinic's own price list. Needs the sales feature (that is where priced procedures live). Quotes the procedure line only — never a total, since the consultation fee is per doctor.",
  },
  {
    id: "whatsapp_cancel",
    name: "WhatsApp patient cancellation",
    description:
      "Let a patient cancel their own upcoming appointment by message, no later than the clinic's cancellation cutoff. Works without the AI assistant.",
  },
] as const satisfies readonly ClinicFeature[];

export type ClinicFeatureId = (typeof CLINIC_FEATURES)[number]["id"];

/** Every known feature id — used to validate super-admin toggle input. */
export const CLINIC_FEATURE_IDS: ClinicFeatureId[] = CLINIC_FEATURES.map(
  (f) => f.id,
);

/** True when the clinic has this optional feature switched on. */
export function clinicHasFeature(
  featuresEnabled: readonly string[] | null | undefined,
  id: ClinicFeatureId,
): boolean {
  return (featuresEnabled ?? []).includes(id);
}
