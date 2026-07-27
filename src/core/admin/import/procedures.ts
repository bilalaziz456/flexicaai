import "server-only";

import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { importBatches, procedures } from "@/core/db/schema";
import { parseImportFile, pick, type ImportRow } from "./parse";
import { applyMapping, resolveMapping } from "./fields";
import { parseAmount, summarize, type ImportPreview, type ImportResult, type RowResult } from "./types";

type ProcInput = { name: string; price: number; module: string | null; isActive: boolean };

function validateRow(row: ImportRow): RowResult<ProcInput> {
  const name = pick(row, "name", "procedure", "service", "treatment");
  if (!name) return { kind: "error", reason: "Missing procedure name" };
  const warnings: string[] = [];

  let price = 0;
  const rawPrice = pick(row, "price", "amount", "fee", "cost", "charges", "rate");
  if (rawPrice) {
    const n = parseAmount(rawPrice);
    if (n != null && n >= 0) price = n;
    else warnings.push(`Unrecognised price "${rawPrice}" — treated as 0`);
  }

  const activeRaw = pick(row, "is_active", "active", "status").toLowerCase();
  const isActive = !["no", "false", "0", "inactive", "off"].includes(activeRaw);

  return {
    kind: "ready",
    warnings,
    data: { name: name.slice(0, 200), price, module: pick(row, "module", "specialty") || null, isActive },
  };
}

async function analyze(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  override?: Record<string, string> | null,
): Promise<{
  headers: string[];
  mapping: Record<string, string>;
  total: number;
  results: { row: number; res: RowResult<ProcInput> }[];
}> {
  const { rows, headers } = await parseImportFile(filename, buf);
  const mapping = resolveMapping("procedures", headers, override);
  const mapped = applyMapping(rows, mapping);
  const existing = await db
    .select({ name: procedures.name })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)));
  const seen = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const results = mapped.map((row, i) => {
    let res = validateRow(row);
    if (res.kind === "ready") {
      const key = res.data.name.trim().toLowerCase();
      if (seen.has(key)) res = { kind: "duplicate", reason: `A procedure "${res.data.name}" already exists` };
      else seen.add(key);
    }
    return { row: i + 2, res };
  });

  return { headers, mapping, total: mapped.length, results };
}

export async function previewProcedures(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  override?: Record<string, string> | null,
): Promise<ImportPreview> {
  const { headers, mapping, total, results } = await analyze(clinicId, filename, buf, override);
  return summarize("procedures", headers, mapping, total, results);
}

export async function commitProcedures(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
  override?: Record<string, string> | null,
): Promise<ImportResult> {
  const { results } = await analyze(clinicId, filename, buf, override);
  const ready = results.flatMap((r) => (r.res.kind === "ready" ? [r.res.data] : []));
  const skipped = results.filter((r) => r.res.kind === "duplicate").length;
  const errored = results.filter((r) => r.res.kind === "error").length;
  const warnings = results.filter((r) => r.res.kind === "ready" && r.res.warnings.length > 0).length;

  if (ready.length === 0) return { batchId: "", imported: 0, skipped, errored, warnings };

  const batchId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        clinicId,
        entity: "procedures",
        filename,
        counts: { imported: ready.length, skipped, errored, warnings },
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning({ id: importBatches.id });

    const values = ready.map((p) => ({
      clinicId,
      importBatchId: batch.id,
      name: p.name,
      price: p.price,
      module: p.module,
      isActive: p.isActive,
    }));
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(procedures).values(values.slice(i, i + 500));
    }
    return batch.id;
  });

  return { batchId, imported: ready.length, skipped, errored, warnings };
}
