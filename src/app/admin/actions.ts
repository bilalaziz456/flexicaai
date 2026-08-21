"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { setSessionImpersonation } from "@/core/auth/session";
import { consumeBackupCode, verifyTotp } from "@/core/auth/totp";
import { logActivityAs } from "@/core/audit/log";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  appointments,
  clinics,
  doctorLeaves,
  patients,
  discountSettlements,
  procedures,
  recalls,
  sales,
  saleShares,
  sessions,
  users,
  visits,
} from "@/core/db/schema";
import { availableSpecialtyIds } from "@/config/modules";
import { CLINIC_FEATURE_IDS } from "@/core/lib/features";
import { isClinicStatus, isClinicUsable, type ClinicStatus } from "@/core/clinics/status";
import { permId, resourcesForClinic, sanitizePermissions } from "@/core/auth/permissions";
import { recordClinicPayment, setPaymentCommitment, setPaymentNoticeEnabled, setPaymentReminderDays, syncClinicBillingStatus, voidClinicPayment } from "@/core/admin/billing";
import { setHealthFollowup } from "@/core/admin/health";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { saveClinicFile, deleteFileByKey } from "@/core/integrations/storage";
import { LOGO_EXT, MAX_LOGO_BYTES } from "@/core/clinics/logo-limits";
import { backfillClinicSales } from "@/core/sales/ledger";
import { logActivity } from "@/core/audit/log";
import { sanitizeLogAccess } from "@/core/audit/access";
import { USERNAME_REGEX } from "@/core/types/auth";

export type AdminActionState = { error?: string; saved?: boolean; needsTotp?: boolean };

/** True for a Postgres unique-constraint violation (e.g. duplicate username). */
function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the pg error, so the Postgres code (23505 = unique_violation)
  // may sit on `err` OR on a nested `err.cause`. Walk the cause chain.
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "23505"
    ) {
      return true;
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return false;
}

const createClinicSchema = z.object({
  clinicName: z.string().trim().min(2, "Clinic name is required."),
  adminFullName: z.string().trim().min(2, "Admin name is required."),
  adminUsername: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32, "Username must be at most 32 characters.")
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), {
      message: "Username may use lowercase letters, digits, and . _ - only.",
    }),
  adminPassword: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Creates a clinic with its selected specialties, plus that clinic's first
 * Clinic Admin — the core B2B onboarding action (CLAUDE.md §6, Product decision).
 * Both rows are written in ONE transaction so we never leave a clinic without an
 * admin (or vice-versa).
 *
 * DRIZZLE: straightforward inserts in a transaction — the query builder's job.
 */
export async function createClinicWithAdmin(
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:create");

  const parsed = createClinicSchema.safeParse({
    clinicName: formData.get("clinicName"),
    adminFullName: formData.get("adminFullName"),
    adminUsername: formData.get("adminUsername"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  // Only "available" specialties may be enabled; anything else is dropped.
  const allowed = new Set(availableSpecialtyIds());
  const modulesEnabled = formData
    .getAll("modules")
    .map(String)
    .filter((id) => allowed.has(id));

  // Optional account manager (a valid, non-deleted super-admin).
  const assigneeId = String(formData.get("assignedTo") ?? "").trim() || null;
  let assignedTo: string | null = null;
  if (assigneeId) {
    const [m] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, assigneeId), eq(users.role, "super_admin"), notDeleted(users.deletedAt)))
      .limit(1);
    if (!m) return { error: "Not a valid team member for account manager." };
    assignedTo = m.id;
  }

  const passwordHash = await hashPassword(parsed.data.adminPassword);

  let newClinicId: string | undefined;
  try {
    await db.transaction(async (tx) => {
      const [clinic] = await tx
        .insert(clinics)
        .values({ name: parsed.data.clinicName, modulesEnabled, assignedTo })
        .returning({ id: clinics.id });
      newClinicId = clinic.id;

      await tx.insert(users).values({
        clinicId: clinic.id,
        username: parsed.data.adminUsername,
        passwordHash,
        role: "clinic_admin",
        fullName: parsed.data.adminFullName,
        // Temp password — force them to set their own on first login.
        mustChangePassword: true,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  // Optional logo picked at creation — save it now the clinic has an id. Invalid
  // files are skipped silently (the clinic is already created; it can be fixed on
  // the clinic's Logo card).
  const logoFile = formData.get("logo");
  if (newClinicId && logoFile instanceof File && logoFile.size > 0) {
    const ext = LOGO_EXT[logoFile.type];
    if (ext && logoFile.size <= MAX_LOGO_BYTES) {
      const key = await saveClinicFile(newClinicId, "logo", Buffer.from(await logoFile.arrayBuffer()), ext);
      await db.update(clinics).set({ logoKey: key }).where(eq(clinics.id, newClinicId));
    }
  }

  await logActivity({
    action: "create",
    entity: "clinic",
    entityId: newClinicId,
    clinicId: newClinicId ?? null,
    summary: `Created clinic “${parsed.data.clinicName}” with admin @${parsed.data.adminUsername}`,
  });
  // Back to the clinics list (refreshed so the new clinic appears immediately)
  // with a flash flag so it can show a success toast.
  revalidatePath("/admin");
  redirect("/admin?created=1");
}

const clinicSettingsSchema = z.object({
  name: z.string().trim().min(2, "Clinic name is required."),
  // How long trashed records stay in the clinic-level Trash (super-admin-set).
  trashRetentionDays: z.coerce
    .number({ message: "Enter a number of days." })
    .int("Whole days only.")
    .min(1, "At least 1 day.")
    .max(3650, "That's too long (max 3650 days)."),
  // Per-clinic WhatsApp SENDER (Meta Cloud API) — provisioned by the super admin.
  whatsappPhoneNumberId: z.string().trim().max(64).optional(),
  whatsappDisplayNumber: z.string().trim().max(32).optional(),
  whatsappSenderName: z.string().trim().max(120).optional(),
});

/**
 * Saves a clinic's core super-admin settings in one call — name, specialties
 * (`modules`), optional features (`features`), trash retention and the WhatsApp
 * sender. Unknown ids in any group are dropped. Access control (capabilities +
 * log access) has its own saves. Only the super admin can change these.
 */
export async function updateClinic(
  clinicId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const parsed = clinicSettingsSchema.safeParse({
    name: formData.get("name"),
    trashRetentionDays: formData.get("trashRetentionDays") ?? 30,
    whatsappPhoneNumberId: formData.get("whatsappPhoneNumberId") ?? undefined,
    whatsappDisplayNumber: formData.get("whatsappDisplayNumber") ?? undefined,
    whatsappSenderName: formData.get("whatsappSenderName") ?? undefined,
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const specialtyAllowed = new Set(availableSpecialtyIds());
  const modulesEnabled = formData
    .getAll("modules")
    .map(String)
    .filter((id) => specialtyAllowed.has(id));

  const featureAllowed = new Set<string>(CLINIC_FEATURE_IDS);
  const featuresEnabled = formData
    .getAll("features")
    .map(String)
    .filter((id) => featureAllowed.has(id));

  // Was the sales feature off before this save? If so, and it's on now, we backfill
  // the ledger below so the report shows history the moment the feature is enabled.
  const [before] = await db
    .select({
      featuresEnabled: clinics.featuresEnabled,
      capabilities: clinics.capabilities,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const salesNewlyEnabled =
    featuresEnabled.includes("sales") &&
    !(before?.featuresEnabled ?? []).includes("sales");

  // Capability upkeep: if this clinic has a RESTRICTED capability whitelist and a
  // feature is newly enabled, allow that feature's slugs by default — otherwise
  // the new feature's actions would be silently disabled. (No-op when capabilities
  // is NULL = all allowed, the common case.)
  let capabilities = before?.capabilities ?? null;
  if (capabilities) {
    const newlyUsable = usableCapabilitySlugs(featuresEnabled).filter(
      (s) => !usableCapabilitySlugs(before?.featuresEnabled ?? null).includes(s),
    );
    if (newlyUsable.length) {
      capabilities = sanitizePermissions([...capabilities, ...newlyUsable]);
    }
  }

  try {
    await db
      .update(clinics)
      .set({
        name: parsed.data.name,
        modulesEnabled,
        featuresEnabled,
        capabilities,
        trashRetentionDays: parsed.data.trashRetentionDays,
        // Per-clinic WhatsApp sender (empty → cleared). phone_number_id is unique
        // across clinics (the inbound routing key) — a duplicate is rejected below.
        whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId || null,
        whatsappDisplayNumber: parsed.data.whatsappDisplayNumber || null,
        whatsappSenderName: parsed.data.whatsappSenderName || null,
        updatedAt: new Date(),
      })
      .where(eq(clinics.id, clinicId));
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === "23505") {
      return { error: "That WhatsApp number id is already assigned to another clinic." };
    }
    throw err;
  }

  // Snapshot sales for the clinic's already-completed appointments (idempotent).
  if (salesNewlyEnabled) {
    await backfillClinicSales(clinicId);
  }

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Updated settings for clinic “${parsed.data.name}”`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  // Features + log access change what the clinic admin's own panel/nav shows.
  revalidatePath("/clinic", "layout");
  redirect("/admin?updated=1");
}

/** Revoke every session of a clinic's staff (immediate lock-out) inside a tx. */
async function revokeClinicSessions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  clinicId: string,
): Promise<void> {
  const staff = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clinicId, clinicId));
  const ids = staff.map((s) => s.id);
  if (ids.length) await tx.delete(sessions).where(inArray(sessions.userId, ids));
}

/**
 * Sets a clinic's lifecycle status (super-admin control plane, Feature 2). Moving
 * to a NON-usable status (suspended / past_due / cancelled) revokes all staff
 * sessions so access is cut immediately — the `requireRole` login-block then keeps
 * them out on every subsequent request. Moving to `active` clears the suspend
 * fields. super-admin only; audited.
 */
export async function setClinicStatus(
  clinicId: string,
  status: string,
  reason?: string,
  password?: string,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("clinics:edit");
  if (!isClinicStatus(status)) return { error: "Unknown status." };
  const target = status as ClinicStatus;

  const [before] = await db
    .select({ name: clinics.name, status: clinics.status, trialStartAt: clinics.trialStartAt })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  const now = new Date();
  const nowUnusable = !isClinicUsable({ status: target, trialEndsAt: null });

  // PAUSING access (any transition to an unusable status — suspend / past_due /
  // cancel) is deliberately restricted: only the owner / a full super-admin may do
  // it (NOT an account manager), and it requires a password step-up. Overdue clinics
  // are never auto-paused — this is the only path that locks a clinic out.
  if (nowUnusable) {
    if (!canManageTeam(admin)) {
      return { error: "Only the owner or a super admin can pause a clinic’s access." };
    }
    if (!(await verifyCurrentUserPassword(password ?? ""))) {
      return { error: "Incorrect password." };
    }
  }

  // Field bookkeeping: record when suspended (+ why), and when (re)activated.
  const patch: Record<string, unknown> = { status: target, updatedAt: now };
  // First time it enters trial → stamp the trial start (never overwrite an earlier one).
  if (target === "trial" && !before.trialStartAt) patch.trialStartAt = now;
  if (target === "suspended") {
    patch.suspendedAt = now;
    patch.suspendReason = reason?.trim() || null;
  } else if (target === "active") {
    patch.activatedAt = now;
    patch.suspendedAt = null;
    patch.suspendReason = null;
  } else if (target === "past_due" || target === "cancelled") {
    patch.suspendReason = reason?.trim() || null;
  }

  await db.transaction(async (tx) => {
    await tx.update(clinics).set(patch).where(eq(clinics.id, clinicId));
    if (nowUnusable) await revokeClinicSessions(tx, clinicId);
  });

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Set clinic “${before.name}” status ${before.status} → ${target}${
      reason?.trim() ? ` (${reason.trim()})` : ""
    }`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  revalidatePath("/clinic", "layout");
  return { saved: true };
}

/**
 * Extends (or starts) a clinic's trial by N days and sets status to `trial`.
 * Base is the later of now / the current trial end, so extending never shortens
 * an active trial. Re-enables a suspended clinic (status becomes usable). Audited.
 */
export async function extendTrial(
  clinicId: string,
  days: number,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");
  const n = Math.trunc(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 365) {
    return { error: "Enter 1–365 days." };
  }

  const [before] = await db
    .select({ name: clinics.name, trialEndsAt: clinics.trialEndsAt, trialStartAt: clinics.trialStartAt })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  const now = Date.now();
  const base = Math.max(now, before.trialEndsAt?.getTime() ?? now);
  const newEnd = new Date(base + n * 24 * 60 * 60 * 1000);

  await db
    .update(clinics)
    .set({
      status: "trial",
      // Stamp the trial start the first time (starting or extending a fresh trial).
      trialStartAt: before.trialStartAt ?? new Date(),
      trialEndsAt: newEnd,
      // Extending re-enables access — clear any suspension.
      suspendedAt: null,
      suspendReason: null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Extended trial for “${before.name}” by ${n} day${n === 1 ? "" : "s"} (until ${newEnd.toISOString().slice(0, 10)})`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  revalidatePath("/clinic", "layout");
  return { saved: true };
}

/** Every `resource:action` slug a clinic with these features can use. */
function usableCapabilitySlugs(featuresEnabled: string[] | null): string[] {
  return resourcesForClinic(featuresEnabled).flatMap((r) =>
    r.actions.map((a) => permId(r.id, a)),
  );
}

/**
 * Sets a clinic's capability WHITELIST (super-admin granular control, Feature 3):
 * the `resource:action` slugs the clinic is allowed to use. `can()` intersects
 * these with each user's own permissions, so dropping a slug disables that action
 * for EVERY user in the clinic. When ALL usable slugs are allowed we store NULL
 * ("all") — the clean default that also lets a later-enabled feature work without
 * revisiting. super-admin only; audited.
 */
export async function setClinicCapabilities(
  clinicId: string,
  slugs: string[],
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const [before] = await db
    .select({ name: clinics.name, featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  const usable = usableCapabilitySlugs(before.featuresEnabled);
  const usableSet = new Set(usable);
  // Keep only recognised slugs the clinic can actually use.
  const checked = sanitizePermissions(slugs).filter((s) => usableSet.has(s));
  // All usable allowed → NULL (unrestricted); otherwise store the explicit whitelist.
  const capabilities = checked.length >= usable.length ? null : checked;

  await db
    .update(clinics)
    .set({ capabilities, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: capabilities
      ? `Restricted clinic “${before.name}” capabilities (${capabilities.length}/${usable.length} actions allowed)`
      : `Cleared clinic “${before.name}” capability restrictions (all allowed)`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  // Capabilities change what every staff member's nav + buttons show.
  revalidatePath("/clinic", "layout");
  return { saved: true };
}

/**
 * Sets a clinic's ACTIVITY-LOG ACCESS — the log ACTION categories the clinic admin
 * may see on /clinic/logs. Empty = no log access at all. Part of "Access control"
 * alongside capabilities. super-admin only; audited.
 */
export async function setClinicLogAccess(
  clinicId: string,
  ids: string[],
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const [before] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  const logAccess = sanitizeLogAccess(ids);
  await db
    .update(clinics)
    .set({ logAccess, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: logAccess.length
      ? `Set clinic “${before.name}” log access (${logAccess.length} categor${logAccess.length === 1 ? "y" : "ies"})`
      : `Removed clinic “${before.name}” log access`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/clinic", "layout");
  return { saved: true };
}

const contactSchema = z.object({
  ownerName: z.string().trim().max(160).optional(),
  ownerEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, {
      message: "Enter a valid email address.",
    }),
  ownerPhone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  region: z.string().trim().max(40).optional(),
  timezone: z.string().trim().min(1).max(64),
  notes: z.string().trim().max(4000).optional(),
});

/**
 * Saves a clinic's owner / contact / region / timezone / internal notes
 * (super-admin control plane, Feature 4). Empty fields are stored as NULL. The
 * timezone is used for availability + reminder day-bounds (see the deploy caveat
 * in .claude/database.md). super-admin only; audited.
 */
export async function updateClinicContact(
  clinicId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const parsed = contactSchema.safeParse({
    ownerName: formData.get("ownerName") ?? undefined,
    ownerEmail: formData.get("ownerEmail") ?? undefined,
    ownerPhone: formData.get("ownerPhone") ?? undefined,
    country: formData.get("country") ?? undefined,
    city: formData.get("city") ?? undefined,
    address: formData.get("address") ?? undefined,
    region: formData.get("region") ?? undefined,
    timezone: formData.get("timezone") ?? "Asia/Karachi",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }
  const d = parsed.data;
  const orNull = (v?: string) => (v && v.length ? v : null);

  const [before] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  await db
    .update(clinics)
    .set({
      ownerName: orNull(d.ownerName),
      ownerEmail: orNull(d.ownerEmail),
      ownerPhone: orNull(d.ownerPhone),
      country: orNull(d.country),
      city: orNull(d.city),
      address: orNull(d.address),
      region: orNull(d.region),
      timezone: d.timezone,
      notes: orNull(d.notes),
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Updated owner & contact for clinic “${before.name}”`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/**
 * Starts a READ-ONLY impersonation ("view as clinic", Feature 5): the super-admin's
 * session gets `impersonated_clinic_id`, so they resolve as a view-only clinic_admin
 * of that clinic (see getCurrentUser). STEP-UP: re-enter the password, plus a TOTP /
 * backup code when the super-admin has 2FA (Feature 1). Heavily audited — patient
 * data. Redirects into the clinic workspace on success.
 */
export async function startImpersonation(
  clinicId: string,
  password: string,
  totp?: string,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("impersonate:view");

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  // 2FA step-up for a super-admin who enrolled it (Feature 1 deferred item).
  const [me] = await db
    .select({
      totpEnabled: users.totpEnabled,
      totpSecret: users.totpSecret,
      totpBackup: users.totpBackup,
    })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1);
  if (me?.totpEnabled && me.totpSecret) {
    const code = (totp ?? "").trim();
    if (!code) return { error: "Enter your 6-digit authenticator code.", needsTotp: true };
    let ok = verifyTotp(me.totpSecret, code);
    if (!ok) {
      const remaining = consumeBackupCode(me.totpBackup ?? [], code);
      if (remaining) {
        ok = true;
        await db.update(users).set({ totpBackup: remaining }).where(eq(users.id, admin.id));
      }
    }
    if (!ok) return { error: "Invalid authentication code.", needsTotp: true };
  }

  const [clinic] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!clinic) return { error: "Clinic not found." };

  await setSessionImpersonation(clinicId);

  // Log against the clinic (transparency in its own log) as the REAL super-admin.
  await logActivityAs(
    { clinicId, userId: admin.id, name: admin.username, role: "super_admin" },
    {
      action: "login",
      entity: "clinic",
      entityId: clinicId,
      summary: `Started viewing clinic “${clinic.name}” as support (impersonation)`,
    },
  );
  revalidatePath("/clinic", "layout");
  redirect("/clinic");
}


const priceSchema = z.object({
  monthlyPrice: z.coerce.number().int("Whole PKR only.").min(0, "Cannot be negative.").max(100_000_000),
  billingCycle: z.enum(["monthly", "2m", "quarter", "half", "annual"]),
  graceDays: z.coerce.number().int().min(0, "Cannot be negative.").max(365),
});

/** Sets a clinic's subscription price / expected cycle / grace days (Feature 6).
 *  Re-syncs the billing status (a price/grace change can flip active↔past_due). */
export async function setClinicPrice(
  clinicId: string,
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("billing:edit");
  const parsed = priceSchema.safeParse({
    monthlyPrice: formData.get("monthlyPrice") ?? 0,
    billingCycle: formData.get("billingCycle") ?? "monthly",
    graceDays: formData.get("graceDays") ?? 7,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const [before] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!before) return { error: "Clinic not found." };

  await db
    .update(clinics)
    .set({
      monthlyPrice: parsed.data.monthlyPrice,
      billingCycle: parsed.data.billingCycle,
      graceDays: parsed.data.graceDays,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  await syncClinicBillingStatus(clinicId);

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Set billing for “${before.name}”: ${parsed.data.monthlyPrice} PKR / ${parsed.data.billingCycle}, grace ${parsed.data.graceDays}d`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}

const clinicPaymentSchema = z.object({
  amount: z.coerce.number().int("Whole PKR only.").positive("Amount must be positive."),
  kind: z.enum(["payment", "refund", "credit"]).optional(),
  method: z.enum(["bank", "cash", "cheque", "other"]).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  occurredAt: z.string().trim().optional(),
  // Follow-up: when the clinic promised to clear any REMAINING balance.
  commitmentAt: z.string().trim().optional(),
  commitmentNote: z.string().trim().max(300).optional(),
});

/** Records a manual clinic→FlexicaAI payment (extends paid-through) — Feature 6. */
export async function recordClinicPaymentAction(
  clinicId: string,
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("billing:create");
  const parsed = clinicPaymentSchema.safeParse({
    amount: formData.get("amount"),
    kind: formData.get("kind") || undefined,
    method: formData.get("method") || undefined,
    reference: formData.get("reference") || undefined,
    note: formData.get("note") || undefined,
    occurredAt: formData.get("occurredAt") || undefined,
    commitmentAt: formData.get("commitmentAt") || undefined,
    commitmentNote: formData.get("commitmentNote") || undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) return { error: "Invalid date." };
  const commitmentAt = parsed.data.commitmentAt ? new Date(parsed.data.commitmentAt) : null;
  if (commitmentAt && Number.isNaN(commitmentAt.getTime())) return { error: "Invalid follow-up date." };
  const kind = parsed.data.kind ?? "payment";

  const res = await recordClinicPayment({
    clinicId,
    amount: parsed.data.amount,
    kind,
    method: parsed.data.method,
    reference: parsed.data.reference,
    note: parsed.data.note,
    occurredAt,
    recordedBy: admin.id,
    recordedByName: admin.username,
    // A refund/credit isn't a promise to pay — only carry a follow-up on a payment.
    commitmentAt: kind === "payment" ? commitmentAt : null,
    commitmentNote: kind === "payment" ? parsed.data.commitmentNote : undefined,
  });
  if ("error" in res) return { error: res.error };

  const verb = kind === "refund" ? "Refunded" : kind === "credit" ? "Credited" : "Recorded payment";
  await logActivity({
    action: "create",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `${verb} clinic ${parsed.data.amount} PKR`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}

/** Assigns (or clears) a clinic's account manager — a team member (super-admin). */
export async function setClinicAssigneeAction(
  clinicId: string,
  assigneeId: string | null,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  let assigned: string | null = null;
  let name = "unassigned";
  if (assigneeId) {
    const [m] = await db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(and(eq(users.id, assigneeId), eq(users.role, "super_admin"), notDeleted(users.deletedAt)))
      .limit(1);
    if (!m) return { error: "Not a valid team member." };
    assigned = m.id;
    name = m.fullName ?? m.username;
  }

  await db.update(clinics).set({ assignedTo: assigned, updatedAt: new Date() }).where(eq(clinics.id, clinicId));
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Assigned clinic to ${name}`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}

/**
 * Set or clear a clinic's health follow-up (the churn / usage-flag snooze on the
 * Owner Overview). A future date parks the clinic under "Following up"; an empty
 * date clears it. Gated by `metrics:view` (whoever sees the alerts); a scoped team
 * member may only action clinics assigned to them.
 */
export async function setHealthFollowupAction(
  clinicId: string,
  input: { at?: string | null; note?: string | null },
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("metrics:view");

  // Scope: a non-full admin (account manager) may only action their own clinics.
  const [c] = await db
    .select({ name: clinics.name, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c) return { error: "Clinic not found." };
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return { error: "You can only follow up on clinics assigned to you." };
  }

  const at = input.at ? new Date(input.at) : null;
  if (at && Number.isNaN(at.getTime())) return { error: "Invalid follow-up date." };
  const note = input.note?.trim() || null;

  await setHealthFollowup(clinicId, at, note);
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: at ? `Set health follow-up for ${c.name}` : `Cleared health follow-up for ${c.name}`,
  });
  revalidatePath("/admin/overview");
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/**
 * Set or clear a clinic's PAYMENT follow-up (the promised-payment date + note on an
 * overdue subscription) from the Overview dues list — no payment recorded. Gated by
 * `billing:edit`; a scoped team member may only action clinics assigned to them.
 */
export async function setPaymentCommitmentAction(
  clinicId: string,
  input: { at?: string | null; note?: string | null },
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("billing:edit");

  const [c] = await db
    .select({ name: clinics.name, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c) return { error: "Clinic not found." };
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return { error: "You can only follow up on clinics assigned to you." };
  }

  const at = input.at ? new Date(input.at) : null;
  if (at && Number.isNaN(at.getTime())) return { error: "Invalid follow-up date." };
  const note = input.note?.trim() || null;

  await setPaymentCommitment(clinicId, at, note);
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: at ? `Set payment follow-up for ${c.name}` : `Cleared payment follow-up for ${c.name}`,
  });
  revalidatePath("/admin/overview");
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/**
 * Enable/disable the SOFT payment-due/overdue notice shown to a clinic's own staff.
 * Available to the owner / full super-admin and the clinic's ACCOUNT MANAGER (scoped),
 * mirroring the follow-up actions. Does not affect the super-admin dues list or the
 * hard `past_due` lock. Gated by `metrics:view` (every admin sub-role holds it).
 */
export async function setPaymentNoticeEnabledAction(
  clinicId: string,
  enabled: boolean,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("metrics:view");

  const [c] = await db
    .select({ name: clinics.name, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c) return { error: "Clinic not found." };
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return { error: "You can only change clinics assigned to you." };
  }

  await setPaymentNoticeEnabled(clinicId, enabled);
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `${enabled ? "Enabled" : "Disabled"} the payment-due notice for ${c.name}`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/**
 * Set how many days before the paid-through date a clinic shows in the "payment coming
 * up" list. Same audience/scope as the payment-notice toggle (owner / full super-admin /
 * the clinic's account manager). 0 disables the pre-due heads-up for the clinic.
 */
export async function setPaymentReminderDaysAction(
  clinicId: string,
  days: number,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("metrics:view");

  const [c] = await db
    .select({ name: clinics.name, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c) return { error: "Clinic not found." };
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return { error: "You can only change clinics assigned to you." };
  }

  const n = Math.trunc(Number(days));
  if (!Number.isFinite(n) || n < 0 || n > 90) return { error: "Enter 0–90 days." };

  await setPaymentReminderDays(clinicId, n);
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Set payment reminder to ${n} day${n === 1 ? "" : "s"} before due for ${c.name}`,
  });
  revalidatePath("/admin/overview");
  revalidatePath("/admin");
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/** Owner/super-admin/account-manager: shared access check for editing a clinic's
 *  logo — full admin OR the clinic's assigned account manager. */
async function assertCanEditClinicLogo(
  clinicId: string,
): Promise<{ error: string } | { logoKey: string | null }> {
  const admin = await requireAdminCapability("clinics:edit");
  const [c] = await db
    .select({ assignedTo: clinics.assignedTo, logoKey: clinics.logoKey })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c) return { error: "Clinic not found." };
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return { error: "You can only change clinics assigned to you." };
  }
  return { logoKey: c.logoKey };
}

/** Upload / replace a clinic's logo (owner/super-admin/account-manager). B&W in print. */
export async function uploadClinicLogo(
  clinicId: string,
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const gate = await assertCanEditClinicLogo(clinicId);
  if ("error" in gate) return gate;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  const ext = LOGO_EXT[file.type];
  if (!ext) return { error: "Use a JPG, PNG or WebP image." };
  if (file.size > MAX_LOGO_BYTES) return { error: "Image must be under 2 MB." };

  const data = Buffer.from(await file.arrayBuffer());
  const key = await saveClinicFile(clinicId, "logo", data, ext);
  await db.update(clinics).set({ logoKey: key, updatedAt: new Date() }).where(eq(clinics.id, clinicId));
  if (gate.logoKey && gate.logoKey !== key) await deleteFileByKey(gate.logoKey);

  await logActivity({ action: "update", entity: "clinic", entityId: clinicId, clinicId, summary: "Updated the clinic logo" });
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/** Remove a clinic's logo (prints revert to no logo). */
export async function removeClinicLogo(clinicId: string): Promise<AdminActionState> {
  const gate = await assertCanEditClinicLogo(clinicId);
  if ("error" in gate) return gate;
  await db.update(clinics).set({ logoKey: null, updatedAt: new Date() }).where(eq(clinics.id, clinicId));
  if (gate.logoKey) await deleteFileByKey(gate.logoKey);
  await logActivity({ action: "update", entity: "clinic", entityId: clinicId, clinicId, summary: "Removed the clinic logo" });
  revalidatePath(`/admin/clinics/${clinicId}`);
  return { saved: true };
}

/** Voids (soft-deletes) a clinic payment — Feature 6. */
export async function voidClinicPaymentAction(
  clinicId: string,
  paymentId: string,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("billing:delete");
  const res = await voidClinicPayment(clinicId, paymentId, admin.id);
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "delete",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: "Voided a clinic payment",
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}

const updateStaffSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required."),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32, "Username must be at most 32 characters.")
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), {
      message: "Username may use lowercase letters, digits, and . _ - only.",
    }),
});

/** Edits a staff member's display name and login username. */
export async function updateStaffProfile(
  userId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const parsed = updateStaffSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  try {
    await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        username: parsed.data.username,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Edited a staff profile (@${parsed.data.username})`,
  });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Resets a user's password to a new temporary one and forces them to change it
 * on next login. Also revokes their existing sessions so the old password (and
 * any active session) can no longer be used.
 */
export async function resetUserPassword(
  userId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminCapability("clinics:edit");

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: "Reset a user's password",
  });
  return { saved: true };
}

/**
 * Suspends or reactivates an account. Suspending also revokes active sessions so
 * access is cut immediately (a disabled user also fails getSessionUser's check).
 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
  _formData: FormData,
): Promise<void> {
  await requireAdminCapability("clinics:edit");

  await db.transaction(async (tx) => {
    const [target] = await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ role: users.role, clinicId: users.clinicId });

    if (!isActive) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }

    // A CLINIC ADMIN's active state cascades to their whole clinic in ONE
    // action: suspending takes the clinic offline (staff suspended + logged
    // out); reactivating brings the whole clinic back (staff re-enabled).
    if (target?.role === "clinic_admin" && target.clinicId) {
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
      // Only on suspend do we revoke staff sessions (log them out now).
      if (!isActive) {
        const staffIds = staff.map((s) => s.id);
        if (staffIds.length > 0) {
          await tx.delete(sessions).where(inArray(sessions.userId, staffIds));
        }
      }
    }
  });

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: isActive ? "Reactivated an account" : "Suspended an account",
  });
  // We don't know the clinic id here; refresh the whole admin area.
  revalidatePath("/admin", "layout");
}

/**
 * Trashes a clinic and everything under it. SOFT delete: the clinic + all its
 * live users, patients, appointments, visits, recalls, procedures and doctor
 * leave are marked deleted under one group (children flagged cascade), so Restore
 * reverts exactly this set. All the clinic's sessions are hard-revoked (staff are
 * locked out) and its sale rows voided. Nothing is physically removed — only a
 * super-admin legal purge (Phase 3) can do that. The UI confirms by name.
 */
export async function deleteClinic(
  clinicId: string,
  password: string,
): Promise<AdminActionState> {
  const admin = await requireAdminCapability("clinics:delete");

  // Step-up auth: re-verify the super admin's own password before wiping a clinic.
  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  const group = newDeleteGroup();
  const parent = softDeleteValues(admin.id, group);
  const child = softDeleteValues(admin.id, group, true);

  let notFound = false;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(clinics)
      .set(parent)
      .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
      .returning({ id: clinics.id });
    if (!row) {
      notFound = true;
      return;
    }

    // Cascade-hide every live child row of this clinic.
    await tx.update(users).set(child).where(and(eq(users.clinicId, clinicId), notDeleted(users.deletedAt)));
    await tx.update(patients).set(child).where(and(eq(patients.clinicId, clinicId), notDeleted(patients.deletedAt)));
    await tx.update(appointments).set(child).where(and(eq(appointments.clinicId, clinicId), notDeleted(appointments.deletedAt)));
    await tx.update(visits).set(child).where(and(eq(visits.clinicId, clinicId), notDeleted(visits.deletedAt)));
    await tx.update(recalls).set(child).where(and(eq(recalls.clinicId, clinicId), notDeleted(recalls.deletedAt)));
    await tx.update(procedures).set(child).where(and(eq(procedures.clinicId, clinicId), notDeleted(procedures.deletedAt)));
    await tx.update(doctorLeaves).set(child).where(and(eq(doctorLeaves.clinicId, clinicId), notDeleted(doctorLeaves.deletedAt)));

    // Lock the clinic's staff out (sessions are ephemeral, not trashed) and void
    // its realised-revenue rows (re-backfilled on restore).
    const staff = await tx.select({ id: users.id }).from(users).where(eq(users.clinicId, clinicId));
    const staffIds = staff.map((s) => s.id);
    if (staffIds.length) await tx.delete(sessions).where(inArray(sessions.userId, staffIds));
    await tx.delete(sales).where(eq(sales.clinicId, clinicId));
    await tx.delete(saleShares).where(eq(saleShares.clinicId, clinicId));
    await tx.delete(discountSettlements).where(eq(discountSettlements.clinicId, clinicId));
  });
  if (notFound) return { error: "Clinic not found." };

  await logActivity({
    action: "delete",
    entity: "clinic",
    entityId: clinicId,
    clinicId: null,
    summary: "Moved a clinic and all its data to Trash",
  });
  revalidatePath("/admin");
  redirect("/admin?deleted=1");
}
