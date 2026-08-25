import "server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  discountSettlements,
  doctorLeaves,
  patients,
  procedures,
  recalls,
  saleShares,
  sales,
  sessions,
  users,
  visits,
} from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { unscoped } from "@/core/db/tenant-guard";

/**
 * The COMPANY writing to a clinic's record — CORE per ADR-014.
 *
 * Distinct from `core/clinics/settings`, which is a clinic changing its own settings.
 * Same table again, different authority: this file can suspend an account, grant
 * capabilities and set a price, and none of that should be reachable from a
 * clinic-side action. Cross-tenant by definition, so every function says `unscoped`
 * with its reason rather than leaving the guard to flag it (ADR-005 / ADR-018).
 */

/**
 * A LIVE clinic's full row — the read every admin action makes before it writes, both
 * to build the audit line ("status X → Y") and as a guard.
 *
 * `notDeleted` is that guard, and it is why this is not `getClinic`: a trashed clinic
 * belongs in the admin Trash, and letting a stale form act on one would edit a record
 * the company has already retired.
 */
export async function getLiveClinic(clinicId: string) {
  return unscoped("super admin reads one clinic", async () => {
    const [row] = await db
      .select()
      .from(clinics)
      .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Applies field changes to a clinic.
 *
 * Takes an opaque `values` object deliberately: the caller has already validated the
 * form and worked out the patch (a status change computes several dependent fields at
 * once), and re-listing those columns here would be a second place for them to drift.
 */
export async function updateClinicFields(
  clinicId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await unscoped("super admin updates one clinic", async () => {
    await db
      .update(clinics)
      .set(values)
      .where(eq(clinics.id, clinicId));
  });
}

/**
 * Creates a clinic and its first admin in ONE transaction.
 *
 * They belong together: a clinic with no way to sign in is not an account, it is a row
 * nobody can reach, and the failure that produces it (a duplicate username) is common
 * enough that the caller catches it by name.
 */
export async function createClinicWithAdmin(input: {
  clinicName: string;
  modulesEnabled: string[];
  assignedTo: string | null;
  adminUsername: string;
  adminPasswordHash: string;
  adminFullName: string;
}): Promise<string> {
  return unscoped("super admin creates a clinic", async () =>
    db.transaction(async (tx) => {
      const [clinic] = await tx
        .insert(clinics)
        .values({
          name: input.clinicName,
          modulesEnabled: input.modulesEnabled,
          assignedTo: input.assignedTo,
        })
        .returning({ id: clinics.id });

      await tx.insert(users).values({
        clinicId: clinic.id,
        username: input.adminUsername,
        passwordHash: input.adminPasswordHash,
        role: "clinic_admin",
        fullName: input.adminFullName,
        // Temp password — force them to set their own on first login.
        mustChangePassword: true,
      });
      return clinic.id;
    }),
  );
}

/**
 * Sets a clinic's lifecycle status, revoking every staff session in the SAME
 * transaction when the new status is not usable.
 *
 * That pairing is the point. `requireRole` blocks a suspended clinic on the next
 * request, but a session that survived the status change is a user still working
 * inside an account the company has just cut off — so the two facts become true
 * together or not at all.
 */
export async function setClinicStatusFields(
  clinicId: string,
  patch: Record<string, unknown>,
  revokeSessions: boolean,
): Promise<void> {
  await unscoped("super admin changes a clinic's status", async () => {
    await db.transaction(async (tx) => {
      await tx.update(clinics).set(patch).where(eq(clinics.id, clinicId));
      if (!revokeSessions) return;
      const staff = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clinicId, clinicId));
      const ids = staff.map((s) => s.id);
      if (ids.length) await tx.delete(sessions).where(inArray(sessions.userId, ids));
    });
  });
}

/** An ACTIVE super admin, for validating an account-manager choice. */
export async function findAssignableManager(userId: string): Promise<string | null> {
  return unscoped("super admin assigns an account manager", async () => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, userId), eq(users.role, "super_admin"), notDeleted(users.deletedAt)),
      )
      .limit(1);
    return row?.id ?? null;
  });
}

/** The admin's own 2FA backup hashes — impersonation asks for a step-up code. */
export async function getAdminTotpBackup(userId: string): Promise<string[] | null> {
  const [row] = await db
    .select({ backup: users.totpBackup })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.backup ?? null;
}

/** Consumes one backup code by storing the remaining hashes. */
export async function setAdminTotpBackup(userId: string, remaining: string[]): Promise<void> {
  await db.update(users).set({ totpBackup: remaining }).where(eq(users.id, userId));
}

/**
 * The COMPANY editing a clinic's staff account — a fourth authority over `users`,
 * alongside self-service, the company's own team, and a clinic editing its employees.
 *
 * Deliberately NOT clinic-scoped: the super admin is helping a clinic that cannot help
 * itself (a locked-out owner, a forgotten password), so the id comes from the admin's
 * own clinic-detail page rather than from a tenant context.
 */
export async function updateClinicUserProfile(
  userId: string,
  input: { fullName: string; username: string },
): Promise<void> {
  await unscoped("super admin edits a clinic user", async () => {
    await db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });
}

/** New password + forced change, revoking their sessions in the same transaction. */
export async function resetClinicUserPassword(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await unscoped("super admin resets a clinic user's password", async () => {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
  });
}

/**
 * Suspends or reactivates one account — and CASCADES when that account is the clinic's
 * LAST admin.
 *
 * Suspending a clinic's only admin takes the clinic offline in one action (staff
 * suspended and logged out); reactivating brings it back. That cascade is the whole
 * reason this is a transaction: an owner suspended while their staff stay logged in
 * has not been taken offline, they have just lost their own login.
 *
 * **"Last" is the load-bearing word, and it was added when clinics gained more than one
 * admin (2026-08-26).** This function originally cascaded on ANY `clinic_admin`, which
 * was correct while a clinic had exactly one — the admin WAS the clinic. With peer
 * admins that reading breaks badly: suspending one partner would have suspended every
 * doctor and receptionist and thrown them out mid-shift, while the other admin sat
 * there able to sign in. So the cascade now fires only when nobody is left who can
 * administer the clinic, which is the condition it always actually meant.
 *
 * Sessions are revoked only on SUSPEND. Reactivating gives people their access back;
 * it has no business ending sessions that were never cut.
 */
export async function setClinicUserActive(userId: string, isActive: boolean): Promise<void> {
  await unscoped("super admin suspends or reactivates a clinic user", async () => {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ role: users.role, clinicId: users.clinicId });

      if (!isActive) await tx.delete(sessions).where(eq(sessions.userId, userId));
      if (target?.role !== "clinic_admin" || !target.clinicId) return;

      // Read through the SAME transaction (ADR-016 / core/db/tx.ts): the target's own
      // row was just updated above, and on the pool this count would still see the
      // pre-update value and mis-decide the cascade.
      const otherAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.clinicId, target.clinicId),
            eq(users.role, "clinic_admin"),
            eq(users.isActive, true),
            isNull(users.deletedAt),
            ne(users.id, userId),
          ),
        )
        .limit(1);
      // Another admin can still run the clinic — this was one account, not the clinic.
      if (otherAdmins.length > 0) return;

      const staff = await tx
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(users.clinicId, target.clinicId),
            inArray(users.role, ["doctor", "receptionist"]),
          ),
        )
        .returning({ id: users.id });
      if (!isActive) {
        const ids = staff.map((s) => s.id);
        if (ids.length) await tx.delete(sessions).where(inArray(sessions.userId, ids));
      }
    });
  });
}

/**
 * Trashes a whole clinic: the row, every live child of it, its staff's sessions and
 * its realised-revenue ledgers — in ONE transaction.
 *
 * Three rules, and each is the reason a step is where it is:
 *
 * - The cascade touches only rows still LIVE, under one `delete_group`, so Restore
 *   reverts exactly this batch and a record trashed earlier on its own keeps its own
 *   group rather than being revived along with the clinic.
 * - Sessions are DELETED, not soft-deleted: they are ephemeral, and a clinic whose
 *   staff stay signed in after the account is retired has not been retired.
 * - `sales`, `sale_shares` and `discount_settlements` are hard-deleted because they
 *   are derived state (ADR-016), re-backfilled if the clinic comes back. Trashed
 *   copies would just be a second source of truth for money.
 *
 * Returns false when no live clinic matched, so the caller can say "not found" rather
 * than reporting success over nothing.
 */
export async function softDeleteClinic(clinicId: string, actorId: string): Promise<boolean> {
  const group = newDeleteGroup();
  const parent = softDeleteValues(actorId, group);
  const child = softDeleteValues(actorId, group, true);

  return unscoped("super admin trashes a whole clinic", async () => {
    let found = true;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(clinics)
        .set(parent)
        .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
        .returning({ id: clinics.id });
      if (!row) {
        found = false;
        return;
      }

      for (const [table, deletedAt] of [
        [users, users.deletedAt],
        [patients, patients.deletedAt],
        [appointments, appointments.deletedAt],
        [visits, visits.deletedAt],
        [recalls, recalls.deletedAt],
        [procedures, procedures.deletedAt],
        [doctorLeaves, doctorLeaves.deletedAt],
      ] as const) {
        await tx
          .update(table)
          .set(child)
          .where(and(eq(table.clinicId, clinicId), notDeleted(deletedAt)));
      }

      const staff = await tx.select({ id: users.id }).from(users).where(eq(users.clinicId, clinicId));
      const staffIds = staff.map((s) => s.id);
      if (staffIds.length) await tx.delete(sessions).where(inArray(sessions.userId, staffIds));

      await tx.delete(sales).where(eq(sales.clinicId, clinicId));
      await tx.delete(saleShares).where(eq(saleShares.clinicId, clinicId));
      await tx.delete(discountSettlements).where(eq(discountSettlements.clinicId, clinicId));
    });
    return found;
  });
}
