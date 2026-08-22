import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/user";
import { report } from "@/core/observability";

/**
 * Window for de-duplicating record VIEWS: if the same user re-opens/refreshes
 * the same record within this many minutes, it's not logged again — so a working
 * session on one record doesn't spam the log with repeated "view" rows.
 */
export const VIEW_DEDUPE_MINUTES = 30;

export type LogInput = {
  action: string; // create | update | delete | login | view | status | …
  entity?: string; // patient | appointment | staff | clinic | settings | session
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  /** Override the clinic the log belongs to (e.g. a super-admin acting ON a clinic). */
  clinicId?: string | null;
};

/**
 * Records an activity-log row for the CURRENT signed-in user. Best-effort — a
 * logging failure must NEVER break the action that triggered it, so this always
 * swallows errors and never throws. No-ops when signed out (login is logged
 * explicitly via `logActivityAs`, before the session exists on this render).
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    await db.insert(activityLogs).values({
      clinicId: input.clinicId !== undefined ? input.clinicId : user.clinicId,
      actorUserId: user.id,
      actorName: user.username,
      actorRole: user.role,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
    });
  } catch (e) {
    // Still best-effort — logging must never break the action it records. But
    // CLAUDE.md §10 requires an audit trail over patient data, so a DROPPED audit
    // row is a compliance gap, and one nobody could previously see. The summary is
    // omitted from the report: it is human prose that can name a patient.
    report(e, {
      op: "audit.logActivity",
      ids: { entityId: input.entityId, action: input.action, entity: input.entity },
    });
  }
}

/**
 * Records a record "view" for the current user, but SKIPS it when the same user has
 * already viewed the same record within `VIEW_DEDUPE_MINUTES` — so opening or
 * refreshing a record repeatedly in one sitting logs a single view.
 *
 * ONE statement (`INSERT … SELECT … WHERE NOT EXISTS`), not a SELECT then an INSERT.
 * This is the hottest write in the app — it runs on every record open — and the
 * separate lookup had two problems beyond the extra round trip:
 *
 *   - No index served it, so Postgres walked the global `created_at` index across the
 *     dedupe window and filtered. One user opening one patient therefore cost more as
 *     OTHER clinics got busier. Fixed by `activity_logs_view_dedupe_idx` (migration
 *     0081), which this statement's NOT EXISTS uses too.
 *   - The check and the insert could interleave, so two concurrent renders both saw
 *     "not logged" and both inserted. Harmless, but it made the dedupe a suggestion.
 *     Evaluated inside one statement it is no longer racy in the usual case.
 *
 * The null `entity_id` case still needs its own branch — see the comment on it; the
 * one-expression alternative silently costs the index this exists to use.
 *
 * Still best-effort: logging must never break the action it records.
 */
export async function logView(
  entity: string,
  entityId: string | null,
  summary: string,
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const since = new Date(Date.now() - VIEW_DEDUPE_MINUTES * 60_000);
    const id = entityId ?? null;
    // Two branches, NOT `is not distinct from`. The tidier operator reads better and
    // handles the null in one expression — but it is not btree-indexable, so Postgres
    // abandons `activity_logs_view_dedupe_idx` and falls back to a bitmap scan over
    // two indexes plus a filter. Verified on 60k rows: `=` gives an Index Only Scan,
    // `is not distinct from` does not. Both forms below stay indexable.
    const priorEntity = id ? sql`prior.entity_id = ${id}::uuid` : sql`prior.entity_id is null`;
    await db.execute(sql`
      insert into ${activityLogs}
        (clinic_id, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary)
      select ${user.clinicId}::uuid, ${user.id}::uuid, ${user.username}, ${user.role},
             'view', ${entity}, ${id}::uuid, ${summary}
       where not exists (
         select 1 from ${activityLogs} prior
          where prior.actor_user_id = ${user.id}::uuid
            and prior.action = 'view'
            and prior.entity = ${entity}
            and ${priorEntity}
            and prior.created_at >= ${since}
       )`);
  } catch (e) {
    report(e, { op: "audit.logView", ids: { entity, entityId } });
  }
}

/**
 * Records a log with an EXPLICIT actor — used at login, where the session isn't
 * established on the current render yet. Best-effort; never throws.
 */
export async function logActivityAs(
  actor: {
    clinicId: string | null;
    userId: string | null;
    name: string;
    role: string | null;
  },
  input: Omit<LogInput, "clinicId">,
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      clinicId: actor.clinicId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
    });
  } catch (e) {
    // The login path. A dropped row here means a sign-in with no audit record.
    report(e, {
      op: "audit.logActivityAs",
      userId: actor.userId,
      clinicId: actor.clinicId,
      ids: { entityId: input.entityId, action: input.action, entity: input.entity },
    });
  }
}
