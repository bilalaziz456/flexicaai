import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/core/lib/env";
import { report } from "@/core/observability";

/**
 * File storage — CORE, specialty-agnostic. Local filesystem for now; the whole
 * app goes through these functions so we can swap to an S3-compatible store
 * later by changing only this file (CLAUDE.md §2).
 *
 * Files are namespaced by clinic so tenant data never mingles on disk, mirroring
 * the clinic_id boundary in the database.
 */

const BASE = path.resolve(process.cwd(), serverEnv.STORAGE_DIR);

/** Resolve a relative storage key to an absolute path, guarding against escape. */
function resolveKey(key: string): string {
  const full = path.resolve(BASE, key);
  if (full !== BASE && !full.startsWith(BASE + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return full;
}

/**
 * Persist a file for a clinic and return its opaque storage key. `subdir`
 * groups files by kind (e.g. "audio"); `ext` is the file extension (e.g. "webm").
 */
export async function saveClinicFile(
  clinicId: string,
  subdir: string,
  data: Buffer,
  ext: string,
): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const key = path.posix.join(clinicId, subdir, `${randomUUID()}.${safeExt}`);
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

/** Read a previously stored file by its key. */
export async function readClinicFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/**
 * Persist a file for a USER (e.g. their avatar) and return its opaque key. Users
 * can be super_admin (no clinic), so avatars are namespaced by user id, not clinic.
 */
export async function saveUserFile(
  userId: string,
  subdir: string,
  data: Buffer,
  ext: string,
): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const key = path.posix.join("users", userId, subdir, `${randomUUID()}.${safeExt}`);
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

/** Read any stored file by its key (same base + escape guard as clinic files). */
export async function readFileByKey(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/** Best-effort delete of a stored file (e.g. replacing an avatar). Never throws. */
export async function deleteFileByKey(key: string): Promise<void> {
  try {
    await rm(resolveKey(key), { force: true });
  } catch (e) {
    // Orphaned file: harmless per occurrence, but it never self-heals and the disk
    // only grows. Warn — the caller (replacing an avatar) genuinely succeeded.
    report(e, { op: "storage.deleteFileByKey", severity: "warn", ids: { key } });
  }
}
