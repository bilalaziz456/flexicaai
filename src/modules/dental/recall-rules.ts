import type { RecallRule } from "@/core/types/module";

/**
 * Dental recall intervals. The CORE recall engine reads a clinic's enabled
 * modules, pulls these rules, and schedules reminders — it doesn't know they're
 * "dental". Intervals are in days.
 */
export const dentalRecallRules: RecallRule[] = [
  {
    id: "dental-checkup-6m",
    label: "6-month check-up & cleaning",
    intervalDays: 182,
    reason: "Routine dental examination and scaling.",
  },
  {
    id: "dental-perio-3m",
    label: "3-month periodontal maintenance",
    intervalDays: 91,
    reason: "Periodontal maintenance for gum-disease patients.",
  },
  {
    id: "dental-ortho-1m",
    label: "Monthly orthodontic adjustment",
    intervalDays: 30,
    reason: "Braces/aligner adjustment.",
  },
];
