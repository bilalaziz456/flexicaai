import "server-only";

import { commitPatients, previewPatients } from "./patients";
import { commitProcedures, previewProcedures } from "./procedures";
import { commitVisits, previewVisits } from "./visits";
import type { ImportEntity, ImportPreview, ImportResult } from "./types";

export { listBatches, undoBatch, type BatchRow } from "./batches";
export type { ImportEntity, ImportPreview, ImportResult } from "./types";

/** Dry-run: validate a file without writing. */
export function previewImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
): Promise<ImportPreview> {
  if (entity === "procedures") return previewProcedures(clinicId, filename, buf);
  if (entity === "visits") return previewVisits(clinicId, filename, buf);
  return previewPatients(clinicId, filename, buf);
}

/** Commit: insert the valid rows in one transaction, tagged with an undoable batch. */
export function commitImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
): Promise<ImportResult> {
  if (entity === "procedures") return commitProcedures(clinicId, filename, buf, actor);
  if (entity === "visits") return commitVisits(clinicId, filename, buf, actor);
  return commitPatients(clinicId, filename, buf, actor);
}
