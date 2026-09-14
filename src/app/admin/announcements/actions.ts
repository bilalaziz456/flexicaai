"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import {
  createAnnouncement,
  deleteAnnouncement,
  setAnnouncementActive,
  updateAnnouncement,
} from "@/core/admin/announcements";
import { logActivity } from "@/core/audit/log";
import { ANNOUNCEMENT_LEVEL_CODES } from "@/core/db/vocabulary-seed";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

export type AnnouncementActionState = { error?: string; saved?: boolean };

const schema = z
  .object({
    /** "all" = every clinic; "selected" = exactly the ids listed. */
    scope: z.enum(["all", "selected"]),
    clinicIds: z.array(z.string().uuid()).max(500),
    /** Clinic roles that see it. At least one; all of them means everyone. */
    audience: z.array(z.enum(CLINIC_STAFF_ROLES)).min(1, "Pick at least one role."),
    level: z.enum(ANNOUNCEMENT_LEVEL_CODES),
    title: z.string().trim().min(1, "Title is required.").max(160),
    body: z.string().trim().min(1, "Message is required.").max(2000),
    startDate: z.string().trim().optional(),
    startTime: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    endTime: z.string().trim().optional(),
  })
  // A superRefine rather than a field rule, because the requirement spans two fields:
  // "selected" with nothing selected is an empty audience wearing a broadcast's shape,
  // and without this it would post to every clinic on the platform — the one mistake
  // here that cannot be taken back once staff have read it.
  .superRefine((v, ctx) => {
    if (v.scope === "selected" && v.clinicIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "Pick at least one clinic.", path: ["clinicIds"] });
    }
  });

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * Combines a date field and an optional time field into a SERVER-LOCAL instant.
 * No date → undefined (that side of the window is open). Unparseable → null.
 *
 * Built from the parts, never `new Date("2026-09-15")`, which the spec parses as **UTC**
 * midnight. In Pakistan (UTC+5) that made a notice starting "today" invisible until 5am
 * — posted at 00:57 on the 15th, it sat waiting five hours while the admin screen
 * cheerfully called it active. Everything else in the app (availability, leave, the day
 * book, log filters) reads server-local days, so a UTC one disagreed with all of them.
 *
 * THE TIME DEFAULT IS THE WHOLE POINT of splitting date and time: a date with no time
 * means the WHOLE of that day. So a missing start time is 00:00:00 and a missing end
 * time is 23:59:59.999 — not midnight, which would retire a notice a day early, since
 * the reader compares `ends_at > now`.
 */
function parseWhen(
  date: string | undefined,
  time: string | undefined,
  edge: "start" | "end",
): Date | null | undefined {
  if (!date) return undefined;
  const d = DATE_RE.exec(date.trim());
  if (!d) return null;
  const t = time ? TIME_RE.exec(time.trim()) : null;
  if (time && !t) return null;

  const endOfDay = !t && edge === "end";
  const out = new Date(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    t ? Number(t[1]) : endOfDay ? 23 : 0,
    t ? Number(t[2]) : endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  // Catches a date that does not exist (31 Feb silently rolls into March) and an
  // out-of-range time, neither of which the regexes can see.
  if (Number.isNaN(out.getTime()) || out.getDate() !== Number(d[3])) return null;
  if (t && (Number(t[1]) > 23 || Number(t[2]) > 59)) return null;
  return out;
}

type Parsed = {
  clinicIds: string[];
  audience: string[];
  level: (typeof ANNOUNCEMENT_LEVEL_CODES)[number];
  title: string;
  body: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Everything both the create and the edit action validate, in one place. */
function readForm(formData: FormData): { error: string } | { ok: Parsed } {
  const parsed = schema.safeParse({
    scope: formData.get("scope") === "selected" ? "selected" : "all",
    clinicIds: formData.getAll("clinicIds").filter((v) => typeof v === "string" && v),
    audience: formData.getAll("audience").filter((v) => typeof v === "string" && v),
    level: formData.get("level") ?? "info",
    title: formData.get("title"),
    body: formData.get("body"),
    startDate: formData.get("startDate") ?? undefined,
    startTime: formData.get("startTime") ?? undefined,
    endDate: formData.get("endDate") ?? undefined,
    endTime: formData.get("endTime") ?? undefined,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const d = parsed.data;

  // A time with no date is a half-written window. Ignoring it silently would give a
  // notice that does not end when whoever typed "17:00" believes it does.
  if (d.startTime && !d.startDate) return { error: "Pick a start date, or clear the start time." };
  if (d.endTime && !d.endDate) return { error: "Pick an end date, or clear the end time." };

  const startsAt = parseWhen(d.startDate, d.startTime, "start");
  if (startsAt === null) return { error: "Invalid start date or time." };
  const endsAt = parseWhen(d.endDate, d.endTime, "end");
  if (endsAt === null) return { error: "Invalid end date or time." };
  // Caught here rather than left to produce a notice nobody ever sees: a window that
  // closes before it opens is silent, and silence looks exactly like "posted fine".
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { error: "The end must be after the start." };
  }

  return {
    ok: {
      // "all" ignores whatever is ticked — the picker stays populated while you switch
      // back and forth, and only the chosen scope decides where it goes.
      clinicIds: d.scope === "selected" ? d.clinicIds : [],
      audience: d.audience,
      level: d.level,
      title: d.title,
      body: d.body,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    },
  };
}

/** How a post's reach and audience read on an audit line. */
function describe(p: Parsed): string {
  const where =
    p.clinicIds.length === 0
      ? " (all clinics)"
      : p.clinicIds.length > 1
        ? ` (${p.clinicIds.length} clinics)`
        : "";
  const who =
    p.audience.length < CLINIC_STAFF_ROLES.length ? ` for ${p.audience.join(", ")}` : "";
  return `${where}${who}`;
}

/** Posts a super-admin announcement — broadcast, one clinic, or several. */
export async function createAnnouncementAction(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const admin = await requireAdminCapability("announcements:create");
  const read = readForm(formData);
  if ("error" in read) return read;
  const p = read.ok;

  await createAnnouncement({ ...p, createdBy: admin.id, createdByName: admin.username });

  await logActivity({
    action: "create",
    entity: "clinic",
    // One clinic named on the log row only when there IS one; a multi-clinic post
    // belongs to no single clinic and the count is in the summary instead.
    clinicId: p.clinicIds.length === 1 ? p.clinicIds[0] : null,
    summary: `Posted announcement “${p.title}”${describe(p)}`,
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/clinic", "layout");
  // Redirect rather than stay put: this is its own page now, and the list is where you
  // confirm the post landed the way you meant. The flash param is the same pattern the
  // clinic create flow uses.
  redirect("/admin/announcements?posted=1");
}

/** Edits an existing announcement, including which clinics and roles it reaches. */
export async function updateAnnouncementAction(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  await requireAdminCapability("announcements:edit");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing announcement." };
  const read = readForm(formData);
  if ("error" in read) return read;
  const p = read.ok;

  const result = await updateAnnouncement(id, p);
  if ("error" in result) return result;

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: id,
    clinicId: p.clinicIds.length === 1 ? p.clinicIds[0] : null,
    summary: `Edited announcement “${p.title}”${describe(p)}`,
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/clinic", "layout");
  redirect("/admin/announcements?saved=1");
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
