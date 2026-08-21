import "server-only";
import { getClinic } from "@/core/clinics/get-clinic";

import { clinicalRecordFor, moduleTrashProviders } from "@/config/modules";
import type { ModuleTrash, ModuleTrashRow } from "@/core/types/module";

/**
 * Bridges the enabled module's Trash provider to the core Trash.
 *
 * `/core` must never import a specialty table, so it cannot query trashed dental
 * records itself. It takes them as data instead, and this app-layer helper is what
 * fetches them — the same indirection every other module call already uses.
 */
export async function clinicTrashProvider(clinicId: string): Promise<ModuleTrash | undefined> {
  const row = await getClinic(clinicId);
  return clinicalRecordFor(row?.modulesEnabled ?? [])?.trash;
}

/** Trashed module rows for one clinic's Trash, within its retention window. */
export async function clinicModuleTrashRows(
  clinicId: string,
  retentionDays: number,
): Promise<ModuleTrashRow[]> {
  const provider = await clinicTrashProvider(clinicId);
  if (!provider) return [];
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return provider.list({ kind: "clinic", clinicId, cutoff });
}

/**
 * Trashed module rows across every clinic, for the super admin. Asks each registered
 * module once — a clinic's enabled list doesn't narrow this, since the super admin
 * sees everything and a module's rows only exist where it was in use anyway.
 */
export async function allModuleTrashRows(clinicId?: string): Promise<ModuleTrashRow[]> {
  const rows = await Promise.all(
    moduleTrashProviders().map((t) => t.list({ kind: "all", clinicId })),
  );
  return rows.flat();
}

/** Every registered module's Trash provider, for a super-admin restore or purge. */
export function allModuleTrash(): ModuleTrash {
  const providers = moduleTrashProviders();
  return {
    list: async () => [],
    restore: async (group, cid) => {
      for (const p of providers) await p.restore(group, cid);
    },
    purge: async (group) => {
      for (const p of providers) await p.purge(group);
    },
  };
}
