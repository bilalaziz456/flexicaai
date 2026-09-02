import "server-only";

import { clinicalSchemasFor, getClinicWorkspace } from "@/config/modules";
import type { ScribeConfigResolver } from "@/core/types/module";

/**
 * Bridges the enabled module's scribe contribution to the core scribe job.
 *
 * `core/ai/scribe-job.ts` used to call `getClinicWorkspace` and `clinicalSchemasFor`
 * itself, which meant a core module imported the registry — a `core → config/modules`
 * edge that lets core see the list of specialties (ADR-001) and points the dependency
 * graph the wrong way (architecture §3). The job takes a resolver now; this is it, and
 * it lives at the registry layer because that is the only layer allowed to name
 * modules. Exactly the shape of `config/module-trash.ts`.
 *
 * A FUNCTION rather than a resolved value, deliberately: the job CLAIMS its visit row
 * before it does anything else (ADR-020), so which module a run belongs to is not
 * known until after the caller has handed control over.
 */
export const scribeModuleConfig: ScribeConfigResolver = (modulesEnabled, moduleId) => {
  if (!moduleId) return null;
  const scribePrompt = getClinicWorkspace(modulesEnabled).scribePrompts[moduleId];
  if (!scribePrompt) return null;
  return { scribePrompt, noteSchema: clinicalSchemasFor(modulesEnabled).noteSchema };
};
