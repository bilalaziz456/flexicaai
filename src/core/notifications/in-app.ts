import "server-only";

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { notifications, users } from "@/core/db/schema";
import { can, type PermAction } from "@/core/auth/permissions";
import type { UserRole } from "@/core/types/auth";
import { report } from "@/core/observability";

/**
 * In-app notifications — CORE, specialty-agnostic (the bell). One ROW per recipient;
 * fan-out writes many rows. Writes are BEST-EFFORT (never throw/block the triggering
 * action, like `logActivity`); reads are self-scoped (`user_id = self`) AND clinic-
 * scoped. Targeting respects existing permissions (no new ACL resource) — see
 * docs/notifications-plan.md.
 */

export type NotifyPayload = {
  /** Free-text category, e.g. "discount.approval_needed" | "whatsapp.inbound". */
  type: string;
  title: string;
  body?: string | null;
  /** Deep-link context. */
  entity?: string | null;
  entityId?: string | null;
  /** Precomputed in-app URL the bell navigates to. */
  link?: string | null;
  /** Who triggered it (snapshot); omit for system events. */
  actor?: { userId: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
};

function rowFor(clinicId: string, userId: string, p: NotifyPayload) {
  return {
    clinicId,
    userId,
    type: p.type,
    title: p.title,
    body: p.body ?? null,
    entity: p.entity ?? null,
    entityId: p.entityId ?? null,
    link: p.link ?? null,
    actorUserId: p.actor?.userId ?? null,
    actorName: p.actor?.name ?? null,
    metadata: p.metadata ?? null,
  };
}

function failed(where: string, e: unknown): void {
  // Best-effort: a notification never breaks the action that triggered it.
  report(e, { op: `notifications.inApp.${where}` });
}

// ---- Writes ---------------------------------------------------------------

/** Notify ONE user. */
export async function notify(clinicId: string, userId: string, p: NotifyPayload): Promise<void> {
  try {
    await db.insert(notifications).values(rowFor(clinicId, userId, p));
  } catch (e) {
    failed("notify", e);
  }
}

/** Notify MANY users (deduped) in one insert. No-op on an empty list. */
export async function notifyMany(clinicId: string, userIds: string[], p: NotifyPayload): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;
  try {
    await db.insert(notifications).values(ids.map((uid) => rowFor(clinicId, uid, p)));
  } catch (e) {
    failed("notifyMany", e);
  }
}

/**
 * The clinic's active users who hold `resource:action` — used to TARGET a notification
 * at exactly the people allowed to act on it. (super_admin/clinic_admin implicitly hold
 * everything, so they always match — that's intended oversight.)
 */
export async function usersWithPermission(
  clinicId: string,
  resource: string,
  action: PermAction,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      permissions: users.permissions,
      fullName: users.fullName,
      username: users.username,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.isActive, true)));
  return rows
    .filter((u) => can({ role: u.role as UserRole, permissions: u.permissions }, resource, action))
    .map((u) => ({ id: u.id, name: u.fullName ?? u.username }));
}

/** Notify every clinic user holding `resource:action` (optionally excluding the actor). */
export async function notifyUsersWithPermission(
  clinicId: string,
  resource: string,
  action: PermAction,
  p: NotifyPayload,
  opts: { excludeUserId?: string } = {},
): Promise<void> {
  const targets = await usersWithPermission(clinicId, resource, action);
  const ids = targets.map((t) => t.id).filter((id) => id !== opts.excludeUserId);
  await notifyMany(clinicId, ids, p);
}

// ---- Reads (self-scoped) --------------------------------------------------

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity: string | null;
  entityId: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: Date;
};

/** Unread count for the badge — served by the partial `WHERE read_at IS NULL` index. */
export async function getUnreadCount(clinicId: string, userId: string): Promise<number> {
  const [r] = await db
    .select({ v: count() })
    .from(notifications)
    .where(byClinic(notifications.clinicId, clinicId, eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.v ?? 0);
}

/** A user's recent notifications (read + unread), newest first. */
export async function listNotifications(
  clinicId: string,
  userId: string,
  opts: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      entity: notifications.entity,
      entityId: notifications.entityId,
      actorName: notifications.actorName,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(byClinic(notifications.clinicId, clinicId, eq(notifications.userId, userId)))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 20, 50));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    entity: r.entity,
    entityId: r.entityId,
    actorName: r.actorName,
    read: r.readAt !== null,
    createdAt: r.createdAt,
  }));
}

/** Mark specific notifications read (only the caller's own, only if still unread). */
export async function markRead(clinicId: string, userId: string, ids: string[]): Promise<void> {
  const clean = [...new Set(ids)].filter(Boolean);
  if (clean.length === 0) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      byClinic(
        notifications.clinicId,
        clinicId,
        eq(notifications.userId, userId),
        inArray(notifications.id, clean),
        isNull(notifications.readAt),
      ),
    );
}

/** Mark all of the caller's unread notifications read. */
export async function markAllRead(clinicId: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(byClinic(notifications.clinicId, clinicId, eq(notifications.userId, userId), isNull(notifications.readAt)));
}
