import type {
  ModuleClinicalRecord,
  ModuleDefinition,
  ModuleTrash,
  ModuleId,
  ProcedureTemplate,
  SpecialtyCatalogEntry,
  TreatmentTemplate,
} from "@/core/types/module";
import { dentalModule } from "@/modules/dental/config";
import type { VocabularyRow } from "@/core/db/vocabulary-seed";

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
    description: "Dentistry: scribe, tooth chart, dental recalls.",
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

/** Treatment-plan templates from a clinic's enabled modules (deduped by name). */
export function treatmentTemplatesFor(
  modulesEnabled: readonly ModuleId[],
): TreatmentTemplate[] {
  const seen = new Set<string>();
  const out: TreatmentTemplate[] = [];
  for (const m of loadModules(modulesEnabled)) {
    for (const t of m.treatmentTemplates ?? []) {
      const key = t.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * The structured clinical-record UI (tooth chart, etc.) from a clinic's enabled
 * modules — the first that supplies one. Core reads only `clinic.modules_enabled`
 * and renders the returned components by the contract; it never asks "is this
 * dental?". `undefined` → no specialty chart (fall back to the generic note editor).
 */
export function clinicalRecordFor(
  modulesEnabled: readonly ModuleId[],
): ModuleClinicalRecord | undefined {
  for (const m of loadModules(modulesEnabled)) {
    if (m.clinicalRecord) return m.clinicalRecord;
  }
  return undefined;
}

/**
 * The note + chart shapes contributed by a clinic's enabled modules — the first that
 * supplies them, matching how `clinicalRecordFor` picks the chart UI. Core calls this
 * before writing `visits.note`, so validation follows the clinic's specialty without
 * core ever naming one. `{}` when no enabled module declares a shape: the note then
 * gets core's generic bounds only, which is still a check, never a bypass.
 */
export function clinicalSchemasFor(modulesEnabled: readonly ModuleId[]): {
  noteSchema?: ModuleDefinition["noteSchema"];
  chartSchema?: ModuleDefinition["chartSchema"];
} {
  for (const m of loadModules(modulesEnabled)) {
    if (m.noteSchema || m.chartSchema) {
      return { noteSchema: m.noteSchema, chartSchema: m.chartSchema };
    }
  }
  return {};
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
    scribePrompts: Object.fromEntries(
      modules.map((m) => [m.id, m.scribePrompt]),
    ) as Record<ModuleId, string>,
    drugFormulary: modules.flatMap((m) => m.drugFormulary),
    recallRules: modules.flatMap((m) => m.recallRules),
  };
}

/**
 * Every registered module's Trash provider. The registry is the one place allowed
 * to name modules, so the super-admin Trash asks here rather than guessing.
 */
export function moduleTrashProviders(): ModuleTrash[] {
  return Object.values(MODULES)
    .map((m) => m.clinicalRecord?.trash)
    .filter((t): t is ModuleTrash => Boolean(t));
}

/**
 * Every registered module's vocabularies, merged.
 *
 * The registry is the ONLY layer allowed to name a specialty, so aggregating here is
 * what lets core stay ignorant of them: `core/db/vocabulary-cache.ts` walks what it is
 * GIVEN, and `src/instrumentation.ts` hands it this at start-up. Core importing the
 * registry instead would both breach ADR-001 and close the loop
 * `config/modules → modules → core → config/modules`.
 *
 * Deliberately EVERY registered module, not just a clinic's enabled ones: the cache is
 * process-wide while `modules_enabled` is per clinic, and a lookup table has to resolve
 * for whoever reads a row — including the super admin looking across clinics.
 */
export function moduleVocabularies(): Record<string, readonly VocabularyRow[]> {
  return Object.values(MODULES).reduce<Record<string, readonly VocabularyRow[]>>(
    (all, m) => ({ ...all, ...(m.vocabularies ?? {}) }),
    {},
  );
}
