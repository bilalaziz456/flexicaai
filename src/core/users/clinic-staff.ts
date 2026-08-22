import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { sessions, users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import type { DayAvailability } from "@/core/lib/availability";

/** The roles a CLINIC ADMIN may manage — deliberately excludes `clinic_admin`, which
 *  is what stops one admin editing or deleting another. */
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
 * Every write takes `clinicId` first and filters on it. Most also narrow to
 * `STAFF_ROLES`, which is what stops a clinic admin editing ANOTHER admin — a rule
 * that would be easy to lose if it lived only at the call site.
 */

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
 * so a clinic admin can never delete another admin.
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
 * Distinct from `listClinicStaff`, which narrows to `STAFF_ROLES` because a clinic
 * admin must not see or edit another admin. The company has no such limit: it is
 * looking at the whole account, and hiding the owner from that view would make the
 * page lie about who can sign in.
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
