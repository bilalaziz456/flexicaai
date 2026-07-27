import "server-only";

import { commitPatients, previewPatients } from "./patients";
import { commitProcedures, previewProcedures } from "./procedures";
import { commitVisits, previewVisits } from "./visits";
import type { ImportEntity, ImportPreview, ImportResult } from "./types";

export { listBatches, undoBatch, type BatchRow } from "./batches";
export { FIELDS, type ImportField } from "./fields";
export type { ImportEntity, ImportPreview, ImportResult } from "./types";

/** Dry-run: validate a file without writing. `mapping` overrides column auto-detection. */
export function previewImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  mapping?: Record<string, string> | null,
): Promise<ImportPreview> {
  if (entity === "procedures") return previewProcedures(clinicId, filename, buf, mapping);
  if (entity === "visits") return previewVisits(clinicId, filename, buf, mapping);
  return previewPatients(clinicId, filename, buf, mapping);
}

/** Commit: insert the valid rows in one transaction, tagged with an undoable batch. */
export function commitImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
  mapping?: Record<string, string> | null,
): Promise<ImportResult> {
  if (entity === "procedures") return commitProcedures(clinicId, filename, buf, actor, mapping);
  if (entity === "visits") return commitVisits(clinicId, filename, buf, actor, mapping);
  return commitPatients(clinicId, filename, buf, actor, mapping);
}
