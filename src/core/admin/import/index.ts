import "server-only";

import { commitPatients, previewPatients } from "./patients";
import { commitProcedures, previewProcedures } from "./procedures";
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
  return entity === "procedures"
    ? previewProcedures(clinicId, filename, buf)
    : previewPatients(clinicId, filename, buf);
}

/** Commit: insert the valid rows in one transaction, tagged with an undoable batch. */
export function commitImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
): Promise<ImportResult> {
  return entity === "procedures"
    ? commitProcedures(clinicId, filename, buf, actor)
    : commitPatients(clinicId, filename, buf, actor);
}
