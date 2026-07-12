import type { ModuleDefinition } from "@/core/types/module";
import { dentalScribePrompt } from "@/modules/dental/prompts/scribe";
import { dentalRecallRules } from "@/modules/dental/recall-rules";
import { dentalDrugFormulary } from "@/modules/dental/drug-formulary";
import { dentalProcedureTemplates } from "@/modules/dental/procedure-templates";

/**
 * The Dental module — the first (and, for now, only) built specialty.
 *
 * This is the whole contract a module fulfils (CLAUDE.md §4/§13). To add derma
 * later you create /modules/derma/config.ts exporting the same shape and
 * register it in /config/modules.ts — with ZERO changes to core.
 *
 * A module MAY import from /core. Core must NEVER import from here.
 */
export const dentalModule: ModuleDefinition = {
  id: "dental",
  name: "Dental",
  scribePrompt: dentalScribePrompt,
  recallRules: dentalRecallRules,
  drugFormulary: dentalDrugFormulary,
  procedureTemplates: dentalProcedureTemplates,
  navItems: [
    { label: "Patients", href: "/doctor/patients", icon: "users" },
    { label: "Voice Scribe", href: "/doctor/scribe", icon: "mic" },
    { label: "Prescriptions", href: "/doctor/prescriptions", icon: "pill" },
  ],
};
