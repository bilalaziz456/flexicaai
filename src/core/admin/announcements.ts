import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, ilike, inArray, isNull, or, gt, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { announcements, clinics, type Announcement } from "@/core/db/schema";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

/**
 * Super-admin → clinic announcements (Feature 10). A platform table read both
 * cross-clinic (super-admin admin page) and clinic-plus-global (the clinic notice
 * bar), so every access opts out of the tenant guard. `clinic_id` NULL = broadcast
 * to all clinics.
 */

export type AnnouncementInput = {
  /**
   * Which clinics see it. An EMPTY array means every clinic — one row with a NULL
   * `clinic_id`, exactly as a broadcast has always been stored. Several ids write
   * several rows sharing a `batch_id`.
   */
  clinicIds: string[];
  level: "info" | "warning";
  title: string;
  body: string;
  /** Clinic role codes. Empty/undefined = every staff member (stored as NULL). */
  audience?: string[] | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

/**
 * Active announcements to show ONE PERSON right now — their clinic's plus the global
 * ones, inside the start/end window, and aimed at their role.
 *
 * The role filter runs in SQL rather than after the fetch, so a notice a receptionist
 * may not see never reaches the process rendering their page.
 */
export async function listActiveForClinic(
  clinicId: string,
  role: string,
): Promise<Announcement[]> {
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
          // NULL audience = everyone. Parameterised, so the role never reaches the SQL
          // as text (Drizzle binds it), and an unrecognised role simply matches nothing
          // rather than widening the audience.
          sql`(${announcements.audience} is null or ${role} = any(${announcements.audience}))`,
        ),
      )
      .orderBy(desc(announcements.createdAt));
  });
}

export type AnnouncementRow = Announcement & {
  /** Every clinic this post went to. Empty = all clinics. */
  clinicNames: string[];
};

/** What the announcements list can be narrowed by. */
export type AnnouncementFilters = {
  /** Free text over title and body. */
  q?: string;
  /**
   * Lifecycle, which is NOT the same as the `active` flag — `active` only means "not
   * switched off", so an active notice can still be invisible because its window has
   * not opened or has closed. Those are the states someone actually looks for.
   */
  state?: "showing" | "scheduled" | "ended" | "inactive";
  level?: string;
  /** A clinic id, or "broadcast" for the posts that went to every clinic. */
  clinic?: string;
  /** Only posts narrowed to this role. */
  audience?: string;
  /**
   * Local days, "YYYY-MM-DD". Keeps the posts whose display WINDOW overlaps the range —
   * "what was on screen during September" — rather than those merely posted in it.
   *
   * Overlap, not containment: a notice running all quarter was showing in September
   * and a filter that dropped it would answer a question nobody asked. An open-ended
   * side (NULL) extends forever in that direction and so always overlaps.
   */
  from?: string;
  to?: string;
};

/** The identity of a POST: its batch when it has one, else its own id. */
const postId = sql`coalesce(${announcements.batchId}, ${announcements.id})`;

function announcementWhere(f: AnnouncementFilters, now: Date): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(announcements.title, like), ilike(announcements.body, like)));
  }
  if (f.level) conds.push(eq(announcements.level, f.level as "info" | "warning"));
  if (f.clinic === "broadcast") conds.push(isNull(announcements.clinicId));
  else if (f.clinic) conds.push(eq(announcements.clinicId, f.clinic));
  // `= any(audience)` deliberately, not overlap: this asks "narrowed to this role",
  // and an unnarrowed notice (NULL) is not an answer to that question.
  if (f.audience) conds.push(sql`${f.audience} = any(${announcements.audience})`);

  // Local days, built from the parts — `new Date("2026-09-15")` is UTC midnight, which
  // is the wrong instant everywhere but Greenwich (the bug that hid a notice for five
  // hours). `to` is the END of its day, since the range is inclusive to whoever typed it.
  const localDay = (s: string, endOfDay = false): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const fromAt = f.from ? localDay(f.from) : null;
  const toAt = f.to ? localDay(f.to, true) : null;
  // A window overlaps the range when it starts before the range ends AND ends after the
  // range begins. A NULL on either side is open-ended and satisfies its half outright.
  if (toAt) conds.push(or(isNull(announcements.startsAt), lte(announcements.startsAt, toAt)));
  if (fromAt) conds.push(or(isNull(announcements.endsAt), gte(announcements.endsAt, fromAt)));

  const started = or(isNull(announcements.startsAt), lte(announcements.startsAt, now));
  const notEnded = or(isNull(announcements.endsAt), gt(announcements.endsAt, now));
  if (f.state === "inactive") conds.push(eq(announcements.active, false));
  if (f.state === "showing") conds.push(and(eq(announcements.active, true), started, notEnded));
  if (f.state === "scheduled") {
    conds.push(and(eq(announcements.active, true), gt(announcements.startsAt, now)));
  }
  if (f.state === "ended") {
    conds.push(and(eq(announcements.active, true), lte(announcements.endsAt, now)));
  }
  return conds.length ? and(...conds) : undefined;
}

/**
 * One page of announcements for the super-admin screen, newest first, with a
 * multi-clinic post FOLDED BACK into the single entry it was.
 *
 * PAGING IS OVER POSTS, NOT ROWS, and that is the whole shape of this query. A notice
 * sent to twelve clinics is twelve rows; paging those would put one announcement across
 * two pages and make "47 announcements" a number nothing on screen agrees with. So the
 * page is chosen by grouping on the post id first, and only then are that page's rows
 * fetched — bounded by the page either way, however many clinics a post went to.
 *
 * Every filter is pushed into SQL rather than applied after the fetch: a filter applied
 * to an already-cut page returns short pages and a lying total (ADR-024).
 *
 * Folding lives here, not in the page, because the count shown ("3 clinics") and the row
 * the Deactivate button acts on have to come from the same place — otherwise the screen
 * lists one post and the button silences another.
 */
export async function listAnnouncementsPage(
  filters: AnnouncementFilters,
  paging: { offset: number; limit: number },
  now: Date = new Date(),
): Promise<{ rows: AnnouncementRow[]; total: number }> {
  return unscoped("admin: announcements page", async () => {
    const where = announcementWhere(filters, now);

    const [pageIds, [totalRow]] = await Promise.all([
      db
        // Only the post id is selected: the ordering aggregate need not be in the
        // SELECT list, and a `sql<Date>` that nothing reads is a type assertion with
        // nothing behind it (scripts/test-date-mapping.ts rightly rejects one).
        .select({ post: postId })
        .from(announcements)
        .where(where)
        .groupBy(postId)
        .orderBy(desc(sql`max(${announcements.createdAt})`))
        .limit(paging.limit)
        .offset(paging.offset),
      db
        .select({ total: sql<number>`count(distinct ${postId})` })
        .from(announcements)
        .where(where),
    ]);
    const total = Number(totalRow?.total ?? 0);
    if (pageIds.length === 0) return { rows: [], total };

    // The page's rows in full — including the sibling rows of a batch, which the
    // grouped query above collapsed. NOT re-filtered: a clinic filter must not hide the
    // other clinics of a post it matched, or the entry would under-report its own reach.
    const ids = pageIds.map((p) => String(p.post));
    const rows = await db
      .select({ a: announcements, clinicName: clinics.name })
      .from(announcements)
      .leftJoin(clinics, eq(announcements.clinicId, clinics.id))
      .where(inArray(postId, ids))
      .orderBy(desc(announcements.createdAt));

    const byPost = new Map<string, AnnouncementRow>();
    for (const r of rows) {
      const key = r.a.batchId ?? r.a.id;
      const seen = byPost.get(key);
      if (seen) {
        if (r.clinicName) seen.clinicNames.push(r.clinicName);
        continue;
      }
      // The first row of a batch stands for it, so the id the row actions carry is a
      // real row — `batchScope` widens it to the rest.
      byPost.set(key, { ...r.a, clinicNames: r.clinicName ? [r.clinicName] : [] });
    }
    for (const a of byPost.values()) a.clinicNames.sort((x, y) => x.localeCompare(y));
    // Ordered by the PAGE query, not by the map: a Map preserves insertion order, which
    // is the second query's order, and only the first query knows where the page sits.
    return { rows: ids.map((id) => byPost.get(id)).filter((r) => r !== undefined), total };
  });
}

/**
 * Posts one announcement, to one clinic, several clinics, or all of them.
 *
 * Several clinics = several rows sharing a `batch_id`, written in ONE statement so a
 * post can never land on three clinics and miss the fourth. One row per clinic keeps
 * `clinic_id` a real foreign key and leaves the clinic-side read untouched; the batch
 * id is what lets the admin screen treat them as the single post they were.
 *
 * @returns the batch id when it wrote more than one row, else null.
 */
export async function createAnnouncement(input: AnnouncementInput): Promise<string | null> {
  // Ticking every role means "everyone", which is NULL — never the full list. Stored as
  // a list, a role added to the product later would be silently left out of notices
  // whose author meant all staff. Both ends collapse to NULL: none ticked and all
  // ticked describe the same audience.
  const picked = input.audience ?? [];
  const everyRole = CLINIC_STAFF_ROLES.every((r) => picked.includes(r));
  const audience = picked.length === 0 || everyRole ? null : picked;
  const batchId = input.clinicIds.length > 1 ? randomUUID() : null;
  // No ids at all = the broadcast row, which is how a global notice has always been
  // stored: a single row whose clinic_id is NULL.
  const targets: (string | null)[] = input.clinicIds.length ? input.clinicIds : [null];

  await unscoped("admin: create announcement", async () => {
    await db.insert(announcements).values(
      targets.map((clinicId) => ({
        clinicId,
        level: input.level,
        title: input.title,
        body: input.body,
        audience,
        batchId,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        createdBy: input.createdBy ?? null,
        createdByName: input.createdByName ?? null,
      })),
    );
  });
  return batchId;
}

/** One post, as the edit form needs it — its content plus every clinic it targets. */
export type AnnouncementPost = {
  id: string;
  batchId: string | null;
  level: string;
  title: string;
  body: string;
  audience: string[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  /** Empty = it went to every clinic. */
  clinicIds: string[];
};

/** Reads a post for editing, gathering its sibling rows so the clinic set is complete. */
export async function getAnnouncementPost(id: string): Promise<AnnouncementPost | null> {
  return unscoped("admin: one announcement", async () => {
    const [head] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    if (!head) return null;
    const rows = head.batchId
      ? await db.select().from(announcements).where(eq(announcements.batchId, head.batchId))
      : [head];
    return {
      id: head.id,
      batchId: head.batchId,
      level: head.level,
      title: head.title,
      body: head.body,
      audience: head.audience,
      startsAt: head.startsAt,
      endsAt: head.endsAt,
      active: head.active,
      clinicIds: rows.map((r) => r.clinicId).filter((c) => c !== null),
    };
  });
}

/**
 * Edits a post in place — content, window, audience AND which clinics it reaches.
 *
 * Re-targeting is a diff, not a delete-and-recreate: clinics that stay keep their row,
 * so an edit does not reset when the notice was posted or who posted it. One
 * TRANSACTION, because a post that reached three clinics with the new wording and two
 * with the old is a worse outcome than the edit failing (ADR-016).
 *
 * The batch id follows the RESULT, not the history: a post narrowed back to one clinic
 * stops being a batch, and one widened to several becomes one.
 */
export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<{ error: string } | { ok: true }> {
  const post = await getAnnouncementPost(id);
  if (!post) return { error: "That announcement no longer exists." };

  const picked = input.audience ?? [];
  const everyRole = CLINIC_STAFF_ROLES.every((r) => picked.includes(r));
  const audience = picked.length === 0 || everyRole ? null : picked;
  const targets: (string | null)[] = input.clinicIds.length ? input.clinicIds : [null];
  const batchId = targets.length > 1 ? (post.batchId ?? randomUUID()) : null;
  const content = {
    level: input.level,
    title: input.title,
    body: input.body,
    audience,
    batchId,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    updatedAt: new Date(),
  };

  await unscoped("admin: update announcement", async () => {
    await db.transaction(async (tx) => {
      const scope = post.batchId
        ? eq(announcements.batchId, post.batchId)
        : eq(announcements.id, post.id);
      const existing = await tx.select().from(announcements).where(scope);

      const wanted = new Set(targets.map((t) => t ?? ""));
      const keep = existing.filter((r) => wanted.has(r.clinicId ?? ""));
      const drop = existing.filter((r) => !wanted.has(r.clinicId ?? ""));
      const have = new Set(keep.map((r) => r.clinicId ?? ""));
      const add = targets.filter((t) => !have.has(t ?? ""));

      if (drop.length) {
        await tx.delete(announcements).where(
          inArray(announcements.id, drop.map((r) => r.id)),
        );
      }
      if (keep.length) {
        await tx.update(announcements).set(content).where(
          inArray(announcements.id, keep.map((r) => r.id)),
        );
      }
      if (add.length) {
        // New rows inherit the ORIGINAL author, not the editor: the post is still the
        // one that was posted, and rewriting authorship on a clinic added later would
        // make the same notice show two different names depending on the clinic.
        const [author] = existing;
        await tx.insert(announcements).values(
          add.map((clinicId) => ({
            ...content,
            clinicId,
            active: post.active,
            createdBy: author?.createdBy ?? null,
            createdByName: author?.createdByName ?? null,
            createdAt: author?.createdAt ?? new Date(),
          })),
        );
      }
    });
  });
  return { ok: true };
}

/**
 * Activates / deactivates an announcement — and its whole batch when it has one.
 *
 * Whole batch deliberately: the admin screen shows a multi-clinic post as one entry, so
 * a Deactivate that silenced it for one clinic and left it running at the other four
 * would contradict what is on screen.
 */
export async function setAnnouncementActive(id: string, active: boolean): Promise<void> {
  await unscoped("admin: toggle announcement", async () => {
    await db
      .update(announcements)
      .set({ active, updatedAt: new Date() })
      .where(await batchScope(id));
  });
}

/** Matches one row, or every row posted with it. */
async function batchScope(id: string) {
  const [row] = await db
    .select({ batchId: announcements.batchId })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1);
  return row?.batchId ? eq(announcements.batchId, row.batchId) : eq(announcements.id, id);
}

/** Deletes an announcement — and its whole batch, for the reason above. */
export async function deleteAnnouncement(id: string): Promise<void> {
  await unscoped("admin: delete announcement", async () => {
    await db.delete(announcements).where(await batchScope(id));
  });
}

/**
 * Count of currently-active announcements (for a small admin badge).
 *
 * Counts POSTS, not rows: a post sent to five clinics is five rows sharing a batch id,
 * and a badge reading "5" for one notice would be a number nothing on the screen agrees
 * with. `coalesce(batch_id, id)` is the post's identity either way.
 */
export async function countActiveAnnouncements(): Promise<number> {
  return unscoped("admin: active announcement count", async () => {
    const [row] = await db
      .select({
        c: sql<number>`count(distinct coalesce(${announcements.batchId}, ${announcements.id}))`,
      })
      .from(announcements)
      .where(eq(announcements.active, true));
    return Number(row?.c ?? 0);
  });
}
