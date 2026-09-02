import type { VocabularyRow } from "@/core/db/vocabulary-seed";

/**
 * The dental module's own closed vocabularies (migration `0094`).
 *
 * Declared here, contributed through `ModuleDefinition.vocabularies`, aggregated by
 * `config/modules.ts` and injected into `core/db/vocabulary-cache.ts` at start-up.
 * Core never imports this file — it could not, without knowing that a specialty called
 * "dental" exists (ADR-001).
 *
 * Same rules as core's: **ids are written out and never renumbered**, because an
 * integer surrogate key only means anything if the same number means the same thing in
 * every environment. Adding a value takes the next free id here AND in a migration;
 * retiring one sets `is_active = false` so historical rows still resolve.
 *
 * NOT here: the TOOTH vocabulary. It lives in a jsonb chart, which cannot carry a
 * foreign key, so `tooth-status.ts` stays the source and a compile-time exhaustiveness
 * check keeps it in step with the `ToothStatus` union instead.
 */

/** `lab_cases.status` — where a case is in its round trip to the lab. */
export const LAB_STATUS_ROWS = [
  { id: 1, code: "sent", label: "Sent to lab", sortOrder: 1 },
  { id: 2, code: "in_lab", label: "In lab", sortOrder: 2 },
  { id: 3, code: "received", label: "Received back", sortOrder: 3 },
  { id: 4, code: "fitted", label: "Fitted", sortOrder: 4 },
  { id: 5, code: "remake", label: "Remake", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `lab_cases.item` — what was sent. */
export const LAB_ITEM_ROWS = [
  { id: 1, code: "crown", label: "Crown", sortOrder: 1 },
  { id: 2, code: "bridge", label: "Bridge", sortOrder: 2 },
  { id: 3, code: "denture", label: "Denture", sortOrder: 3 },
  { id: 4, code: "veneer", label: "Veneer", sortOrder: 4 },
  { id: 5, code: "inlay/onlay", label: "Inlay / onlay", sortOrder: 5 },
  { id: 6, code: "implant crown", label: "Implant crown", sortOrder: 6 },
  { id: 7, code: "retainer", label: "Retainer", sortOrder: 7 },
  { id: 8, code: "other", label: "Other", sortOrder: 8 },
] as const satisfies readonly VocabularyRow[];

export type LabStatusCode = (typeof LAB_STATUS_ROWS)[number]["code"];
export type LabItemCode = (typeof LAB_ITEM_ROWS)[number]["code"];

/** What the module contributes to the registry. Keyed by lookup-table name. */
export const DENTAL_VOCABULARIES: Record<string, readonly VocabularyRow[]> = {
  dental_lab_statuses: LAB_STATUS_ROWS,
  dental_lab_items: LAB_ITEM_ROWS,
};
