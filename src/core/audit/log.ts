import "server-only";

import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/user";

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
  } catch {
    // best-effort
  }
}

/**
 * Records a record "view" for the current user, but SKIPS it when the same user
 * has already viewed the same record within `VIEW_DEDUPE_MINUTES` — so opening
 * or refreshing a record repeatedly in one sitting logs a single view. The
 * dedupe check + insert aren't transactional (a rare concurrent double is
 * harmless noise-reduction, not correctness), and it's best-effort like the rest.
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
    const [recent] = await db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.actorUserId, user.id),
          eq(activityLogs.action, "view"),
          eq(activityLogs.entity, entity),
          entityId
            ? eq(activityLogs.entityId, entityId)
            : isNull(activityLogs.entityId),
          gte(activityLogs.createdAt, since),
        ),
      )
      .limit(1);
    if (recent) return; // already logged this view recently

    await db.insert(activityLogs).values({
      clinicId: user.clinicId,
      actorUserId: user.id,
      actorName: user.username,
      actorRole: user.role,
      action: "view",
      entity,
      entityId: entityId ?? null,
      summary,
    });
  } catch {
    // best-effort
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
  } catch {
    // best-effort
  }
}
