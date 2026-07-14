import "server-only";

import { randomUUID } from "node:crypto";

/**
 * Soft-delete write helpers — CORE. Nothing is ever hard-deleted (except a
 * super-admin legal purge). Instead of `db.delete(...)`, a delete action `UPDATE`s
 * the row(s) with these values. See schema `softDeleteColumns()` and
 * `core/db/tenant.ts#notDeleted`.
 */

export type SoftDeleteValues = {
  deletedAt: Date;
  deletedBy: string | null;
  deleteGroup: string;
  deletedByCascade: boolean;
};

/**
 * The column values that mark a row trashed. A single delete action shares ONE
 * `group` across the directly-deleted row (cascade=false) and every child row its
 * deletion hides (cascade=true), so Restore can revert exactly that batch.
 *
 * Call `newDeleteGroup()` once per user action, then pass the same group to the
 * parent (`cascade:false`, the default) and each child (`cascade:true`).
 */
export function softDeleteValues(
  deletedBy: string | null,
  group: string,
  cascade = false,
): SoftDeleteValues {
  return {
    deletedAt: new Date(),
    deletedBy,
    deleteGroup: group,
    deletedByCascade: cascade,
  };
}

/** A fresh delete-group id (one per user delete action). */
export function newDeleteGroup(): string {
  return randomUUID();
}

/** The column values that clear a soft delete (Restore). */
export function restoreValues(): {
  deletedAt: null;
  deletedBy: null;
  deleteGroup: null;
  deletedByCascade: false;
} {
  return {
    deletedAt: null,
    deletedBy: null,
    deleteGroup: null,
    deletedByCascade: false,
  };
}
