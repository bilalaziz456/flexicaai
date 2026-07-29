import "server-only";

import { commitPatients, previewPatients } from "./patients";
import { commitProcedures, previewProcedures } from "./procedures";
import { commitVisits, previewVisits } from "./visits";
import { commitFinancial, previewFinancial } from "./financial";
import { isFinancialEntity, type ImportEntity, type ImportPreview, type ImportResult } from "./types";

export { listBatches, undoBatch, type BatchRow } from "./batches";
export { FIELDS, type ImportField } from "./fields";
export { FINANCIAL_ENTITIES, isFinancialEntity } from "./types";
export type { ImportEntity, ImportPreview, ImportResult } from "./types";

/** Options threaded to a commit (financial only for now). */
export type ImportOptions = { deriveOpeningBalance?: boolean };

/** Dry-run: validate a file without writing. `mapping` overrides column auto-detection. */
export function previewImport(
  clinicId: string,
  entity: ImportEntity,
  filename: string,
  buf: ArrayBuffer,
  mapping?: Record<string, string> | null,
): Promise<ImportPreview> {
  if (isFinancialEntity(entity)) return previewFinancial(clinicId, entity, filename, buf, mapping);
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
  opts?: ImportOptions,
): Promise<ImportResult> {
  if (isFinancialEntity(entity)) return commitFinancial(clinicId, entity, filename, buf, actor, mapping, opts);
  if (entity === "procedures") return commitProcedures(clinicId, filename, buf, actor, mapping);
  if (entity === "visits") return commitVisits(clinicId, filename, buf, actor, mapping);
  return commitPatients(clinicId, filename, buf, actor, mapping);
}
