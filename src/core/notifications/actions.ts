"use server";

import { requireUser } from "@/core/auth/user";
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
} from "@/core/notifications/in-app";
import type { BellItem } from "@/core/notifications/types";

/**
 * Server actions for the notification bell. Every action is SELF-scoped: it reads the
 * current user and only ever touches that user's own notifications, in their own
 * clinic. Super admin has no clinic (v1) → returns empty.
 */
async function scope(): Promise<{ clinicId: string; userId: string } | null> {
  const u = await requireUser();
  return u.clinicId ? { clinicId: u.clinicId, userId: u.id } : null;
}

/** The badge count — cheap, for the 60s poll / on-focus refresh. */
export async function getUnreadCountAction(): Promise<number> {
  const s = await scope();
  return s ? getUnreadCount(s.clinicId, s.userId) : 0;
}

/** The dropdown payload — recent items + the current unread count. */
export async function fetchNotifications(): Promise<{ unread: number; items: BellItem[] }> {
  const s = await scope();
  if (!s) return { unread: 0, items: [] };
  const [unread, list] = await Promise.all([
    getUnreadCount(s.clinicId, s.userId),
    listNotifications(s.clinicId, s.userId, { limit: 20 }),
  ]);
  return {
    unread,
    items: list.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      link: n.link,
      read: n.read,
      createdAtMs: n.createdAt.getTime(),
    })),
  };
}

/** Mark specific notifications read; returns the fresh unread count. */
export async function markNotificationsReadAction(ids: string[]): Promise<{ unread: number }> {
  const s = await scope();
  if (!s) return { unread: 0 };
  await markRead(s.clinicId, s.userId, ids);
  return { unread: await getUnreadCount(s.clinicId, s.userId) };
}

/** Mark all read; unread becomes 0. */
export async function markAllNotificationsReadAction(): Promise<{ unread: number }> {
  const s = await scope();
  if (!s) return { unread: 0 };
  await markAllRead(s.clinicId, s.userId);
  return { unread: 0 };
}
