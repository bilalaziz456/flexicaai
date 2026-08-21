import { boolean, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Soft-delete columns — CORE. Nothing in the app is ever hard-deleted (the only
 * exception is a super-admin LEGAL purge). A deleted row keeps `deletedAt` = when
 * it was trashed (NULL = live); every normal read filters `deletedAt IS NULL`.
 *
 * - `deletedBy`  — the user who trashed it (plain uuid, no FK: users are
 *   themselves soft-deleted, so we never lose the referent, and we avoid FK churn).
 * - `deleteGroup` — one id shared by a parent and the child rows its deletion
 *   cascade-hid, so **Restore reverts exactly that batch** (a row trashed on its
 *   own has its own group and is never revived by an unrelated parent restore).
 * - `deletedByCascade` — true for rows hidden ONLY because a parent was trashed;
 *   the Trash list shows only the non-cascade (directly-deleted) rows.
 *
 * Spread `...softDeleteColumns()` into every soft-deletable table. Exported so
 * MODULE-owned tables (e.g. dental_records) reuse the exact same four columns.
 */
export const softDeleteColumns = () => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  deleteGroup: uuid("delete_group"),
  deletedByCascade: boolean("deleted_by_cascade").notNull().default(false),
});
