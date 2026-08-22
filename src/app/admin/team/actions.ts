"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import {
  ADMIN_CAPABILITY_IDS,
  ADMIN_SUBROLE_PRESETS,
  canGrantAdminCapabilities,
  isOwner,
  sanitizeAdminCapabilities,
  type AssignableSubRole,
} from "@/core/auth/admin-permissions";
import type { CurrentUser } from "@/core/types/auth";
import {
  createSuperAdmin,
  deactivateTeamMember,
  findActiveTeamMember,
  getTeamMemberIdentity,
  reactivateTeamMember,
  reassignClinics,
  resetTeamMemberPassword,
  setTeamMemberCapabilities,
  softDeleteTeamMember,
  suspendTeamMember,
  updateTeamMemberProfile,
} from "@/core/admin/team";
import { logActivity } from "@/core/audit/log";
import { USERNAME_REGEX } from "@/core/types/auth";
import { report } from "@/core/observability";

export type TeamActionState = { error?: string; saved?: boolean };

/** A sub-role stores its capability preset (super_admin = all slugs). */
function permsForSubRole(role: AssignableSubRole): string[] {
  return [...ADMIN_SUBROLE_PRESETS[role]];
}

/**
 * OWNER PROTECTION: the owner account may be managed ONLY by the owner. A
 * super_admin acting on a target must be blocked when the target is an owner and
 * the actor is not. Returns an error message, or null if allowed.
 */
async function ownerGuard(actor: CurrentUser, targetUserId: string): Promise<string | null> {
  if (isOwner(actor)) return null; // the owner may manage anyone
  const t = await getTeamMemberIdentity(targetUserId);
  if (t && isOwner({ role: t.role, permissions: t.permissions })) {
    return "Only the owner can manage the owner account.";
  }
  return null;
}

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required.").max(120),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32)
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), { message: "Invalid username." }),
  password: z.string().min(8, "Password must be at least 8 characters."),
  subRole: z.enum(["super_admin", "support", "sales", "billing"]),
});

/** Creates another super-admin with a sub-role (owner-only). */
export async function createSuperAdminAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:create");
  const parsed = createSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    password: formData.get("password"),
    subRole: formData.get("subRole") ?? "support",
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Can't create someone with more access than you have (no escalation).
  if (!canGrantAdminCapabilities(actor, permsForSubRole(parsed.data.subRole))) {
    return { error: "You can only create a member with capabilities you have yourself." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await createSuperAdmin({
      username: parsed.data.username,
      passwordHash,
      fullName: parsed.data.fullName,
      permissions: permsForSubRole(parsed.data.subRole),
    });
  } catch (e) {
    // Assumed to be a unique-violation, and nearly always is — but a connection or
    // constraint error would also surface to the operator as "username in use".
    report(e, { op: "admin.team.createMember", severity: "warn" });
    return { error: "That username is already in use." };
  }

  await logActivity({
    action: "create",
    entity: "staff",
    clinicId: null,
    summary: `Added super-admin @${parsed.data.username} (${parsed.data.subRole})`,
  });
  revalidatePath("/admin/team");
  return { saved: true };
}

/** Shared guard for the state actions: team:edit, not self, not the owner. */
async function guardStateChange(userId: string) {
  const actor = await requireAdminCapability("team:edit");
  if (userId === actor.id) return { error: "You can't change your own account state." as const };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };
  return { actor };
}

/** SUSPEND — temporary: block login (revoke sessions), KEEP their clinics. */
export async function suspendMemberAction(userId: string): Promise<TeamActionState> {
  const g = await guardStateChange(userId);
  if ("error" in g) return { error: g.error };
  await suspendTeamMember(userId);
  await logActivity({ action: "update", entity: "staff", entityId: userId, summary: "Suspended a team member" });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** DEACTIVATE — stronger: block login AND unassign every clinic they managed. */
export async function deactivateMemberAction(userId: string): Promise<TeamActionState> {
  const g = await guardStateChange(userId);
  if ("error" in g) return { error: g.error };
  await deactivateTeamMember(userId);
  await logActivity({ action: "update", entity: "staff", entityId: userId, summary: "Deactivated a team member (clinics unassigned)" });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  revalidatePath("/admin");
  return { saved: true };
}

/** REACTIVATE — restore login (clinics stay wherever they are now). */
export async function reactivateMemberAction(userId: string): Promise<TeamActionState> {
  const g = await guardStateChange(userId);
  if ("error" in g) return { error: g.error };
  await reactivateTeamMember(userId);
  await logActivity({ action: "update", entity: "staff", entityId: userId, summary: "Reactivated a team member" });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required.").max(120),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32)
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), { message: "Invalid username." }),
});

/** Edits a team member's name + login username (owner-only). */
export async function editTeamMemberProfileAction(
  userId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:edit");
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  try {
    await updateTeamMemberProfile(userId, {
      fullName: parsed.data.fullName,
      username: parsed.data.username,
    });
  } catch (e) {
    report(e, { op: "admin.team.updateMember", severity: "warn", ids: { userId } });
    return { error: "That username is already in use." };
  }
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Edited team member profile (@${parsed.data.username})`,
  });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** Resets a team member's password to a temporary one (owner-only). Use /account
 *  for your OWN password (this would log you out). */
export async function resetTeamMemberPasswordAction(
  userId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:edit");
  if (userId === actor.id) return { error: "Change your own password in Account settings." };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const passwordHash = await hashPassword(password);
  await resetTeamMemberPassword(userId, passwordHash);
  await logActivity({ action: "update", entity: "staff", entityId: userId, summary: "Reset a team member's password" });
  return { saved: true };
}

/** Sets a team member's GRANULAR admin capabilities. Full set = super_admin
 *  (stored as the explicit slug list — NEVER NULL, which is reserved for the
 *  owner). The owner's access is immutable. You can't reduce your own access. */
export async function setSuperAdminCapabilitiesAction(
  userId: string,
  slugs: string[],
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:edit");
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  // The owner account (NULL perms) always has full access — not editable here.
  const target = await getTeamMemberIdentity(userId);
  if (target && isOwner({ role: target.role, permissions: target.permissions })) {
    return { error: "The owner always has full access." };
  }

  const caps = sanitizeAdminCapabilities(slugs);
  // No escalation: you can only grant capabilities you hold yourself.
  if (!canGrantAdminCapabilities(actor, caps)) {
    return { error: "You can only grant capabilities you have yourself." };
  }
  const isFull = caps.length === ADMIN_CAPABILITY_IDS.length;
  if (userId === actor.id && !isFull) {
    return { error: "You can't reduce your own access." };
  }
  await setTeamMemberCapabilities(userId, caps);
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Set team member capabilities (${isFull ? "super admin / all" : `${caps.length} caps`})`,
  });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** Bulk-reassign every clinic managed by `fromUserId` to another team member
 *  (or unassign when `toAssigneeId` is null). Owner/super-admin only. */
export async function reassignClinicsAction(
  fromUserId: string,
  toAssigneeId: string | null,
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:edit");
  const blocked = await ownerGuard(actor, fromUserId);
  if (blocked) return { error: blocked };

  let target: string | null = null;
  if (toAssigneeId) {
    if (toAssigneeId === fromUserId) return { error: "Pick a different team member." };
    const found = await findActiveTeamMember(toAssigneeId);
    if (!found) return { error: "Not a valid (active) team member." };
    target = found;
  }

  const movedCount = await reassignClinics(fromUserId, target);

  await logActivity({
    action: "update",
    entity: "clinic",
    summary: `Reassigned ${movedCount} clinic${movedCount === 1 ? "" : "s"} ${target ? "to another manager" : "to unassigned"}`,
  });
  revalidatePath(`/admin/team/${fromUserId}`);
  revalidatePath("/admin");
  return { saved: true };
}

/** Deletes a super-admin (needs `team:delete`). SOFT delete + revoke sessions;
 *  frees the username. Requires the actor to re-type their OWN password (step-up
 *  auth). Can't delete yourself (guarantees at least one owner remains). */
export async function deleteSuperAdminAction(
  userId: string,
  password: string,
): Promise<TeamActionState> {
  const actor = await requireAdminCapability("team:delete");
  if (userId === actor.id) return { error: "You can't delete your own account." };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };
  // Step-up: re-prove the signed-in admin's password before a destructive delete.
  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await softDeleteTeamMember(userId, actor.id);
  await logActivity({
    action: "delete",
    entity: "staff",
    entityId: userId,
    summary: "Deleted a super-admin",
  });
  revalidatePath("/admin/team");
  return { saved: true };
}
