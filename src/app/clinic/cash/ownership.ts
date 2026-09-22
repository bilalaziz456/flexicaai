import type { CurrentUser } from "@/core/types/auth";

/**
 * Who may CHANGE a drawer entry, as opposed to read one.
 *
 * Everybody holding `cash:view` sees every entry — a drawer is shared, and a history
 * with rows missing from it cannot be reconciled against the box. What differs is who
 * may rewrite one: a clinic admin may correct anybody's, and everyone else only their
 * own (owner's decision, 2026-09-23).
 *
 * The reasoning is the same one behind snapshotting a variance. A count is somebody's
 * signed assertion about a moment; letting a colleague on the next shift retype it
 * turns a record of who found what into a record of who edited last. The admin is the
 * exception because somebody has to be able to fix a mistake made by a person who has
 * since left.
 *
 * ONE PREDICATE, USED IN TWO PLACES — the page hides the buttons and the action
 * refuses the write. Both matter and neither is enough alone: hiding a control is a
 * courtesy, and the server is what makes it true.
 */
export function mayModifyEntry(user: CurrentUser, ownerId: string | null): boolean {
  if (user.role === "clinic_admin") return true;
  return Boolean(ownerId) && ownerId === user.id;
}

/** The message, in one place, so the toast and the server agree word for word. */
export const NOT_YOURS = "You can only change entries you recorded yourself.";
