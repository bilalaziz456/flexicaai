"use server";

import { revalidatePath } from "next/cache";
import { requireAdminCapability } from "@/core/auth/user";
import { displayStaffName } from "@/core/types/auth";
import { commitImport, previewImport, undoBatch } from "@/core/admin/import";
import type { ImportEntity, ImportPreview, ImportResult } from "@/core/admin/import";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function entityOf(v: FormDataEntryValue | null): ImportEntity {
  return v === "procedures" ? "procedures" : v === "visits" ? "visits" : "patients";
}

async function fileFrom(
  formData: FormData,
): Promise<{ name: string; buf: ArrayBuffer } | { error: string }> {
  const f = formData.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "Choose a CSV or Excel file." };
  if (f.size > MAX_BYTES) return { error: "File too large (max 15 MB)." };
  return { name: f.name, buf: await f.arrayBuffer() };
}

/** Dry-run: validate the file and return the preview. Never writes. */
export async function previewImportAction(
  clinicId: string,
  formData: FormData,
): Promise<ImportPreview | { error: string }> {
  await requireAdminCapability("import:create");
  const entity = entityOf(formData.get("entity"));
  const file = await fileFrom(formData);
  if ("error" in file) return file;
  try {
    return await previewImport(clinicId, entity, file.name, file.buf);
  } catch (e) {
    return { error: e instanceof Error ? `Couldn't read the file: ${e.message}` : "Couldn't read the file." };
  }
}

/** Commit the valid rows (one transaction, tagged with an undoable batch). */
export async function commitImportAction(
  clinicId: string,
  formData: FormData,
): Promise<ImportResult | { error: string }> {
  const admin = await requireAdminCapability("import:create");
  const entity = entityOf(formData.get("entity"));
  const file = await fileFrom(formData);
  if ("error" in file) return file;
  try {
    const name = displayStaffName(admin.prefix, admin.fullName, admin.username);
    const result = await commitImport(clinicId, entity, file.name, file.buf, { id: admin.id, name });
    revalidatePath(`/admin/clinics/${clinicId}/import`);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed." };
  }
}

/** Undo an import (soft-delete the whole batch). */
export async function undoImportAction(clinicId: string, batchId: string): Promise<{ ok: boolean }> {
  const admin = await requireAdminCapability("import:create");
  const ok = await undoBatch(clinicId, batchId, { id: admin.id });
  revalidatePath(`/admin/clinics/${clinicId}/import`);
  return { ok };
}
