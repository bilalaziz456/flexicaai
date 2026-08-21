import { z } from "zod";
import { TOOTH_STATUSES } from "@/modules/dental/tooth-status";
import type { ToothStatus } from "@/modules/dental/db/schema";

/**
 * Dental note + chart shapes — MODULE-owned, and deliberately the counterpart to
 * `prompts/scribe.ts`: the prompt asks the model for a shape, this checks the shape
 * arrived. Keeping the two side by side in the module is the point — core validates
 * BOUNDS, the specialty validates MEANING (`core/clinical/note-schema.ts`).
 *
 * PURE (no DB, no `server-only`) — `TOOTH_STATUSES` is the shared vocabulary and the
 * `ToothStatus` import is type-only, so nothing server-side is pulled in.
 *
 * PERMISSIVE BY DESIGN. Every field is optional and unknown keys pass through,
 * because more than one valid note shape already exists — the scribe's, and imported
 * historical visits (`{ imported: true, summary }`) — and a strict schema would
 * reject real records the moment a doctor opened one to edit.
 *
 * What is NOT permissive: the type of a field the app actually READS. A
 * `prescriptions` that is a string instead of an array is a prescription that
 * disappears from the printed PDF; a `nextVisit.afterDays` that is a string is a
 * recall that is never scheduled. Those fail loudly at the boundary rather than
 * silently at render — which is the entire reason to validate a medical record.
 */

/** The tooth-status vocabulary as a zod enum, derived so it can't drift from the UI. */
const STATUS_VALUES = TOOTH_STATUSES.map((s) => s.value) as [ToothStatus, ...ToothStatus[]];

/** A tooth reference as the prompt asks for it (FDI, e.g. "16"). */
const toothRef = z.string().max(8).nullish();

export const dentalNoteSchema = z
  .object({
    chiefComplaint: z.string().nullish(),
    diagnosis: z.string().nullish(),
    findings: z
      .array(z.object({ tooth: toothRef, finding: z.string().nullish() }).loose())
      .nullish(),
    treatmentPerformed: z.array(z.string()).nullish(),
    treatmentPlan: z.array(z.string()).nullish(),
    prescriptions: z
      .array(
        z
          .object({
            drug: z.string().nullish(),
            dosage: z.string().nullish(),
            duration: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
    // Drives recall capture on approval, so `afterDays` must really be a number.
    nextVisit: z
      .object({ reason: z.string().nullish(), afterDays: z.number().finite().nullish() })
      .loose()
      .nullish(),
    flags: z.array(z.string()).nullish(),
    // Imported historical visits, written by the admin-side importer.
    imported: z.boolean().optional(),
    summary: z.string().nullish(),
    doctorName: z.string().nullish(),
  })
  // Anything the model — or a future field — adds is KEPT, not stripped. Discarding a
  // clinician's content because we didn't anticipate the key is worse than storing it.
  .loose();

/** One tooth's state in the living chart. Mirrors `ChartTooth` in `db/schema.ts`. */
const chartToothSchema = z
  .object({
    status: z.enum(STATUS_VALUES),
    surfaces: z.array(z.string().max(8)).max(8).optional(),
    endo: z.boolean().optional(),
    note: z.string().max(2000).nullish(),
    updatedVisitId: z.string().nullish(),
  })
  .loose();

/**
 * FDI tooth number → state. The KEY is validated as well as the value: the chart is
 * rendered by iterating its keys, so an arbitrary key would draw a phantom tooth.
 * `status` is the one strictly-enumerated field in either schema — an unknown status
 * has no colour, no abbreviation and no clinical meaning.
 */
export const dentalChartSchema = z.record(
  z.string().regex(/^[1-8][1-8]$/, "Not an FDI tooth number."),
  chartToothSchema,
);
