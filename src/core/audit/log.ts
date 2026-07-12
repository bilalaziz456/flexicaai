import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/user";

/** How long a log stays visible to the clinic admin before the cron hides it. */
export const LOG_VISIBLE_DAYS = 5;

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

/**
 * Hides logs older than `LOG_VISIBLE_DAYS` from the clinic admin by flipping
 * `visible` to false (super admin still sees them). Idempotent — only touches
 * still-visible rows. Returns how many were hidden. Runs from the daily cron.
 */
export async function hideOldLogs(
  now: Date = new Date(),
): Promise<{ hidden: number }> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - LOG_VISIBLE_DAYS);

  const rows = await db
    .update(activityLogs)
    .set({ visible: false })
    .where(and(eq(activityLogs.visible, true), lt(activityLogs.createdAt, cutoff)))
    .returning({ id: activityLogs.id });

  return { hidden: rows.length };
}
