"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import {
  createAnnouncement,
  deleteAnnouncement,
  setAnnouncementActive,
} from "@/core/admin/announcements";
import { logActivity } from "@/core/audit/log";

export type AnnouncementActionState = { error?: string; saved?: boolean };

const schema = z.object({
  clinicId: z.string().trim().optional(), // "" = all clinics
  level: z.enum(["info", "warning"]),
  title: z.string().trim().min(2, "Title is required.").max(160),
  body: z.string().trim().min(2, "Message is required.").max(2000),
  endsAt: z.string().trim().optional(),
});

/** Creates a super-admin announcement (broadcast, or targeted to one clinic). */
export async function createAnnouncementAction(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const admin = await requireAdminCapability("announcements:create");
  const parsed = schema.safeParse({
    clinicId: formData.get("clinicId") ?? undefined,
    level: formData.get("level") ?? "info",
    title: formData.get("title"),
    body: formData.get("body"),
    endsAt: formData.get("endsAt") ?? undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) return { error: "Invalid end date." };

  await createAnnouncement({
    clinicId: parsed.data.clinicId ? parsed.data.clinicId : null,
    level: parsed.data.level,
    title: parsed.data.title,
    body: parsed.data.body,
    endsAt,
    createdBy: admin.id,
    createdByName: admin.username,
  });

  await logActivity({
    action: "create",
    entity: "clinic",
    clinicId: parsed.data.clinicId || null,
    summary: `Posted announcement “${parsed.data.title}”${parsed.data.clinicId ? "" : " (all clinics)"}`,
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/clinic", "layout");
  return { saved: true };
}

/** Activates / deactivates an announcement. */
export async function toggleAnnouncementAction(id: string, active: boolean): Promise<void> {
  await requireAdminCapability("announcements:edit");
  await setAnnouncementActive(id, active);
  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: id,
    summary: active ? "Activated an announcement" : "Deactivated an announcement",
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/clinic", "layout");
}

/** Deletes an announcement (super-admin platform content, not clinic data). */
export async function deleteAnnouncementAction(id: string): Promise<void> {
  await requireAdminCapability("announcements:delete");
  await deleteAnnouncement(id);
  await logActivity({ action: "delete", entity: "clinic", entityId: id, summary: "Deleted an announcement" });
  revalidatePath("/admin/announcements");
  revalidatePath("/clinic", "layout");
}
