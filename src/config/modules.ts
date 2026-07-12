import type {
  ModuleDefinition,
  ModuleId,
  NavItem,
  ProcedureTemplate,
  SpecialtyCatalogEntry,
} from "@/core/types/module";
import { dentalModule } from "@/modules/dental/config";

/**
 * THE MODULE REGISTRY (CLAUDE.md §4). The single source of truth for which
 * specialties the platform knows about. This file — and only this file — is
 * allowed to import concrete modules from /modules. Core never does.
 *
 * To add a specialty later: implement /modules/<id>/config.ts, import it here,
 * add it to MODULES, and flip its catalog entry to "available". Nothing in
 * /core changes.
 */

/** Fully-built modules (implementations exist). Only dental for now. */
export const MODULES: Record<ModuleId, ModuleDefinition> = {
  [dentalModule.id]: dentalModule,
};

/**
 * The specialty catalog that powers the Super Admin "create clinic" checkboxes
 * (Step 5). Derma/Hair are ARCHITECTED, not built — they appear as "coming_soon"
 * so the UI can show them disabled. When their modules land, add them to MODULES
 * and set status to "available"; the checkbox lights up with no UI change.
 */
export const SPECIALTY_CATALOG: SpecialtyCatalogEntry[] = [
  {
    id: "dental",
    name: "Dental",
    description: "Dentistry — scribe, tooth chart, dental recalls.",
    status: "available",
  },
  {
    id: "derma",
    name: "Dermatology",
    description: "Skin, cosmetic and medical dermatology.",
    status: "coming_soon",
  },
  {
    id: "hair_transplant",
    name: "Hair Transplant",
    description: "Hair restoration and transplant workflows.",
    status: "coming_soon",
  },
];

/** A module definition by id, or undefined if not a built module. */
export function getModule(id: ModuleId): ModuleDefinition | undefined {
  return MODULES[id];
}

/**
 * Suggested procedure templates from a clinic's enabled modules (deduped by
 * name). Core reads only `clinic.modules_enabled` — it never asks "is this
 * dental?". Empty when no enabled module ships templates.
 */
export function procedureTemplatesFor(
  modulesEnabled: readonly ModuleId[],
): ProcedureTemplate[] {
  const seen = new Set<string>();
  const out: ProcedureTemplate[] = [];
  for (const m of loadModules(modulesEnabled)) {
    for (const t of m.procedureTemplates ?? []) {
      const key = t.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

/** True if the id corresponds to a fully-built, enable-able module. */
export function isModuleAvailable(id: ModuleId): boolean {
  return id in MODULES;
}

/** The specialty ids a clinic is allowed to enable right now. */
export function availableSpecialtyIds(): ModuleId[] {
  return SPECIALTY_CATALOG.filter((s) => s.status === "available").map(
    (s) => s.id,
  );
}

/** Resolve a clinic's enabled ids to definitions, skipping any unknown/unbuilt. */
export function loadModules(ids: readonly ModuleId[]): ModuleDefinition[] {
  return ids
    .map(getModule)
    .filter((m): m is ModuleDefinition => m !== undefined);
}

/**
 * Everything a clinic's enabled modules contribute, aggregated for the panels
 * (CLAUDE.md §4). Core reads only `clinic.modules_enabled` and calls this — it
 * never asks "is this dental?".
 */
export function getClinicWorkspace(modulesEnabled: readonly ModuleId[]) {
  const modules = loadModules(modulesEnabled);
  return {
    modules,
    navItems: modules.flatMap((m): NavItem[] => m.navItems),
    scribePrompts: Object.fromEntries(
      modules.map((m) => [m.id, m.scribePrompt]),
    ) as Record<ModuleId, string>,
    drugFormulary: modules.flatMap((m) => m.drugFormulary),
    recallRules: modules.flatMap((m) => m.recallRules),
  };
}
