import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/core/db";
import { sessions, users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import type { DayAvailability } from "@/core/lib/availability";

/** The roles a CLINIC ADMIN may manage. Includes `clinic_admin` since 2026-08-26 —
 *  admins are peers. What keeps that safe is `assertNotLastAdmin`, never this list. */
const STAFF_ROLES = [...CLINIC_STAFF_ROLES];

/**
 * A clinic managing its OWN staff — CORE per ADR-014.
 *
 * Three modules now touch `users`, and the split is by AUTHORITY, not by table:
 * `core/users/profile` is a person editing themselves, `core/admin/team` is the
 * company editing its own super admins, and this is a clinic admin editing their
 * employees. Each is scoped to what its caller is allowed to reach, so no function
 * here can be handed an id from another tenant and do something with it.
 *
 * Every write takes `clinicId` first and filters on it, and narrows to `STAFF_ROLES`
 * so no function here can be handed the id of a super admin.
 */

/**
 * Refuses an action that would leave the clinic with NO active admin.
 *
 * This one predicate is what makes peer admins safe (`CLINIC_STAFF_ROLES`). Admins can
 * suspend and delete each other, which is the point — but the floor is one. Without
 * it: two admins suspend each other, or the only admin deletes themselves, and the
 * clinic can no longer reach its own staff or settings pages. Nothing in the product
 * recovers from that; it takes a super admin.
 *
 * Counts ACTIVE, non-deleted admins other than the target. `is_active` matters as much
 * as `deleted_at` — a suspended admin cannot log in, so leaving one behind is the same
 * as leaving none.
 *
 * Returns an error STRING rather than throwing: every caller is a Server Action whose
 * contract is `{ error }` for an expected outcome (conventions §5), and being the last
 * admin is expected, not exceptional.
 */
export async function assertNotLastAdmin(
  clinicId: string,
  targetUserId: string,
  what: "suspend" | "delete",
): Promise<string | null> {
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, targetUserId)))
    .limit(1);
  // Only admins are load-bearing here; anyone else can go without stranding a clinic.
  if (target?.role !== "clinic_admin") return null;

  const others = await db
    .select({ id: users.id })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        eq(users.role, "clinic_admin"),
        eq(users.isActive, true),
        ne(users.id, targetUserId),
      ),
    )
    .limit(1);
  if (others.length > 0) return null;

  return what === "delete"
    ? "This is the clinic's only active admin. Add another admin first — deleting this one would lock the clinic out of staff and settings."
    : "This is the clinic's only active admin. Suspending them would lock the clinic out of staff and settings.";
}

/** Active, non-deleted admins in a clinic — used by the super-admin suspend cascade. */
export async function countActiveClinicAdmins(clinicId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        eq(users.role, "clinic_admin"),
        eq(users.isActive, true),
      ),
    );
  return rows.length;
}

/**
 * The clinic-scoped, EDITABLE staff member behind an id from a form.
 *
 * Four actions repeated this lookup verbatim. It returns the role because the callers
 * branch on it (a doctor's form carries a schedule and a fee that others do not), and
 * it returns null both when the member does not exist and when they are out of bounds
 * — the caller says "not found" either way rather than confirming an admin exists.
 */
export async function findEditableStaff(
  clinicId: string,
  userId: string,
  /** Narrow further — the share-rate form only edits a `doctor`. */
  opts: { role?: "doctor" } = {},
) {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      // The name comes along because every caller writes it into an audit line, and
      // a second query for one string on a row already in hand is just a round trip.
      fullName: users.fullName,
      username: users.username,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(
          eq(users.id, userId),
          opts.role ? eq(users.role, opts.role) : inArray(users.role, STAFF_ROLES),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type NewStaffInput = {
  username: string;
  passwordHash: string;
  role: (typeof CLINIC_STAFF_ROLES)[number];
  prefix: string | null;
  fullName: string;
  permissions: string[];
  availability: DayAvailability[];
  flexibleHours: boolean;
  dailyAppointmentLimit: number;
  consultationFee: number;
};

/** Creates a staff account. `mustChangePassword` is forced — the admin picked it. */
export async function createClinicStaff(
  clinicId: string,
  input: NewStaffInput,
): Promise<string> {
  const [created] = await db
    .insert(users)
    .values({ clinicId, mustChangePassword: true, ...input })
    .returning({ id: users.id });
  return created.id;
}

/**
 * Suspend or reactivate. Revoking sessions joins the same transaction, because a
 * user marked inactive who is still signed in has not been suspended in any sense
 * the word is used on that screen.
 */
export async function setClinicStaffActive(
  clinicId: string,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(byClinic(users.clinicId, clinicId, eq(users.id, userId)));
    if (!isActive) await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

/**
 * Trashes a staff member: soft delete + hard session revoke, narrowed to STAFF_ROLES
 * so no id from outside the clinic's own staff can reach it. Admins ARE reachable
 * (they are peers) — `assertNotLastAdmin` is what stops the last one going.
 *
 * Appointments and visits keep the now-trashed reference, so history and names
 * survive; pickers drop them because they filter `notDeleted`. Returns whether a row
 * matched, so the caller can tell "done" from "not yours".
 */
export async function softDeleteClinicStaff(
  clinicId: string,
  userId: string,
  actorId: string,
): Promise<boolean> {
  const [row] = await db
    .update(users)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .returning({ id: users.id });
  if (row) await db.delete(sessions).where(eq(sessions.userId, userId));
  return Boolean(row);
}

/** New password + force a change on next sign-in, revoking existing sessions with it. */
export async function resetClinicStaffPassword(
  clinicId: string,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
        ),
      );
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

/**
 * Name/username, plus a doctor's schedule fields when the form carried them.
 * Returns whether a row matched so a unique-violation and a scope miss stay distinct.
 */
export async function updateClinicStaffProfile(
  clinicId: string,
  userId: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Per-user permission slugs. NULL restores the role defaults (`resetPermissions`). */
export async function setClinicStaffPermissions(
  clinicId: string,
  userId: string,
  permissions: string[] | null,
) {
  const [row] = await db
    .update(users)
    .set({ permissions, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .returning({ fullName: users.fullName, username: users.username });
  return row ?? null;
}

/** A doctor's revenue-share rates and their discount-approval switch. */
export async function setDoctorShareRates(
  clinicId: string,
  doctorId: string,
  input: {
    consultationSharePct: number;
    procedureSharePct: number;
    discountNeedsApproval: boolean;
  },
): Promise<void> {
  await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(byClinic(users.clinicId, clinicId, eq(users.id, doctorId)));
}

/**
 * EVERY user of a clinic, including its admin — the super admin's clinic-detail view.
 *
 * Distinct from `listClinicStaff`, which narrows to `STAFF_ROLES`. Since admins became
 * peers (2026-08-26) that list includes them too, so the two now differ only by
 * `super_admin` — but they stay separate functions because the REASON differs: this
 * one is the company looking at a whole account, and it must keep showing everyone who
 * can sign in even if the clinic's own view is ever narrowed again.
 */
export async function listAllClinicUsers(clinicId: string) {
  return db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt)));
}

/**
 * One staff member's full record for their detail page.
 *
 * NOT narrowed to `STAFF_ROLES`, unlike the write functions: a clinic admin may VIEW
 * their own record and their colleagues' here, and the page decides which controls to
 * offer. Editing is where the role limit bites, and that is enforced in the write
 * functions rather than by hiding the row.
 */
export async function getClinicStaffMember(clinicId: string, userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      prefix: users.prefix,
      fullName: users.fullName,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
      permissions: users.permissions,
      consultationSharePct: users.consultationSharePct,
      procedureSharePct: users.procedureSharePct,
      discountNeedsApproval: users.discountNeedsApproval,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, userId)))
    .limit(1);
  return row ?? null;
}
