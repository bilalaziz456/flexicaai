import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, users } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { displayStaffName } from "@/core/types/auth";
import { getCompanySupportContact } from "@/core/admin/company-settings";

/**
 * The clinic's account manager, as the CLINIC sees it — who looks after this account
 * on our side, and how to reach them.
 *
 * The company half of this (assigning, reassigning, the team roster) lives in
 * `core/admin`. What lives here is the clinic-facing answer to "who do I call?", plus
 * the one helper that guarantees the two columns behind it are written together.
 */

/**
 * How long the clinic-side "your account manager is now X" notice shows for.
 *
 * A WINDOW rather than a dismiss button, on purpose: dismissal needs per-user state —
 * a new table, or a column per user — for a notice that expires by itself and costs a
 * line of screen while it lasts. After the window the settings card is the permanent
 * answer, which is the point: the notice reports an event, the card holds the state.
 */
export const ACCOUNT_MANAGER_NOTICE_DAYS = 14;

/**
 * The ONLY sanctioned way to write `clinics.assigned_to`.
 *
 * Both columns move together or not at all. This is the `paymentKindFields()` shape
 * (ADR-027) applied to a different pair, and for the same reason: an assignment whose
 * date was not updated alongside it is a silent wrong answer, not an error.
 *
 * Five call sites change a clinic's manager — the per-clinic assign action, clinic
 * creation, the bulk `reassignClinics`, and the two that clear it when a member is
 * deactivated or deleted. ADR-032's lesson is that a correctness property carried by
 * an optional argument is one three of five callers will not pass, so there is no
 * optional argument: the fields come as a unit or the write does not compile into
 * anything sensible.
 *
 * **NULL in, NULL out.** Clearing the manager clears the date, which is what makes
 * "say nothing when a clinic is left unassigned" true by CONSTRUCTION rather than by a
 * condition in the view that somebody could later simplify away. A clinic being told
 * it no longer has an account manager is alarming, un-actionable, and usually internal
 * churn it should never have seen.
 */
export function accountManagerFields(userId: string | null): {
  assignedTo: string | null;
  assignedAt: Date | null;
  updatedAt: Date;
} {
  const now = new Date();
  return { assignedTo: userId, assignedAt: userId ? now : null, updatedAt: now };
}

/** Who the clinic should contact, and whether that is a person or the company. */
export type AccountManagerContact = {
  /** `manager` = a named person with a number. `support` = the company fallback. */
  kind: "manager" | "support";
  /** The manager's display name. NULL for the company fallback. */
  name: string | null;
  phone: string | null;
  email: string | null;
  /**
   * When this assignment began — `manager` only, and NULL for one assigned before the
   * column existed (migration 0116 backfills nothing on purpose).
   */
  assignedAt: Date | null;
};

/**
 * Resolves the contact a clinic should be shown.
 *
 * ONE rule, and it is the reason this is a function rather than two fields on the
 * page: show the manager only when there is a manager AND a number to reach them on;
 * otherwise show the company. A name printed above a blank line is worse than the
 * generic number, because it looks like an answer and is not one — and until every
 * pre-existing team member has been given a number, that is a state the data can
 * really be in.
 *
 * A SUSPENDED or DEACTIVATED manager also falls back. Someone who cannot sign in is
 * not going to answer on behalf of the company, and a clinic that rings them and gets
 * nowhere is worse off than one that rang support to begin with. (Suspension keeps the
 * assignment deliberately — see `suspendTeamMember` — so the row is still there.)
 */
export async function getAccountManagerContact(clinicId: string): Promise<AccountManagerContact> {
  // `unscoped` because the joined user is a COMPANY account: a super-admin carries
  // `clinic_id = NULL`, so a tenant filter on `users` would match nobody and the
  // clinic would never learn who its manager is. The read is still bounded to one
  // clinic by its primary key.
  const [row] = await unscoped("clinic reads its own account manager's contact", async () =>
    db
      .select({
        assignedAt: clinics.assignedAt,
        prefix: users.prefix,
        fullName: users.fullName,
        username: users.username,
        phone: users.phone,
        email: users.email,
        isActive: users.isActive,
      })
      .from(clinics)
      // LEFT, and filtered on the USER's soft-delete rather than joined through it: a
      // clinic whose manager was deleted still needs an answer, it is just the
      // company one.
      .leftJoin(users, and(eq(clinics.assignedTo, users.id), isNull(users.deletedAt)))
      .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
      .limit(1),
  );

  const name = row ? displayStaffName(row.prefix, row.fullName, row.username ?? "") : "";
  if (row?.phone && row.isActive && name) {
    return {
      kind: "manager",
      name,
      phone: row.phone,
      email: row.email ?? null,
      assignedAt: row.assignedAt ?? null,
    };
  }

  const support = await getCompanySupportContact();
  return { kind: "support", name: null, phone: support.phone, email: support.email, assignedAt: null };
}

/**
 * Is this assignment recent enough to still be worth announcing?
 *
 * PURE and exported so the clinic layout can ask the question without a query. The
 * layout already holds the clinic row, so the common answer — "no, nothing changed" —
 * costs nothing, and `getAccountManagerContact` only runs inside the window. Otherwise
 * every page view in the workspace would pay a join to be told nothing happened.
 */
export function isRecentAssignment(assignedAt: Date | null | undefined, now = new Date()): boolean {
  if (!assignedAt) return false;
  const age = now.getTime() - assignedAt.getTime();
  // A future date is not "recent", it is a clock problem — and treating it as recent
  // would pin the notice open indefinitely.
  return age >= 0 && age < ACCOUNT_MANAGER_NOTICE_DAYS * 24 * 60 * 60 * 1000;
}
