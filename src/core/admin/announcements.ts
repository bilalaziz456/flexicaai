import "server-only";

import { and, desc, eq, isNull, or, gt, lte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { announcements, clinics, type Announcement } from "@/core/db/schema";

/**
 * Super-admin → clinic announcements (Feature 10). A platform table read both
 * cross-clinic (super-admin admin page) and clinic-plus-global (the clinic notice
 * bar), so every access opts out of the tenant guard. `clinic_id` NULL = broadcast
 * to all clinics.
 */

export type AnnouncementInput = {
  clinicId: string | null;
  level: "info" | "warning";
  title: string;
  body: string;
  endsAt?: Date | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

/** Active announcements to show a clinic RIGHT NOW (global + targeted, in window). */
export async function listActiveForClinic(clinicId: string): Promise<Announcement[]> {
  return unscoped("clinic notice bar: announcements", async () => {
    const now = new Date();
    return db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.active, true),
          or(isNull(announcements.clinicId), eq(announcements.clinicId, clinicId)),
          or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
          or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
        ),
      )
      .orderBy(desc(announcements.createdAt));
  });
}

export type AnnouncementRow = Announcement & { clinicName: string | null };

/** All announcements for the super-admin management page (newest first). */
export async function listAllAnnouncements(): Promise<AnnouncementRow[]> {
  return unscoped("admin: all announcements", async () => {
    const rows = await db
      .select({ a: announcements, clinicName: clinics.name })
      .from(announcements)
      .leftJoin(clinics, eq(announcements.clinicId, clinics.id))
      .orderBy(desc(announcements.createdAt));
    return rows.map((r) => ({ ...r.a, clinicName: r.clinicName }));
  });
}

export async function createAnnouncement(input: AnnouncementInput): Promise<void> {
  await unscoped("admin: create announcement", async () => {
    await db.insert(announcements).values({
      clinicId: input.clinicId,
      level: input.level,
      title: input.title,
      body: input.body,
      endsAt: input.endsAt ?? null,
      createdBy: input.createdBy ?? null,
      createdByName: input.createdByName ?? null,
    });
  });
}

export async function setAnnouncementActive(id: string, active: boolean): Promise<void> {
  await unscoped("admin: toggle announcement", async () => {
    await db
      .update(announcements)
      .set({ active, updatedAt: new Date() })
      .where(eq(announcements.id, id));
  });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await unscoped("admin: delete announcement", async () => {
    await db.delete(announcements).where(eq(announcements.id, id));
  });
}

/** Count of currently-active announcements (for a small admin badge). */
export async function countActiveAnnouncements(): Promise<number> {
  return unscoped("admin: active announcement count", async () => {
    const [row] = await db
      .select({ c: sql<number>`count(*)` })
      .from(announcements)
      .where(eq(announcements.active, true));
    return Number(row?.c ?? 0);
  });
}
