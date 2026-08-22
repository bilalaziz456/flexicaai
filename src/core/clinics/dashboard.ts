import "server-only";

import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, patients, recalls, users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

/**
 * The clinic dashboard's numbers — CORE per ADR-014.
 *
 * These were five `count()` queries and two hand-written SQL statements sitting in the
 * page that renders them, which meant the definition of "Revenue Recovered" — the
 * metric the whole product is sold on — lived in a React component and could not be
 * read, reused or tested without rendering a page.
 */

export type DashboardCounts = {
  staff: number;
  patients: number;
  recallsSent: number;
  /** Scheduled or confirmed, from `now` forward. */
  upcoming: number;
  /** Every appointment ever — drives the first-run onboarding checklist. */
  appointmentsEver: number;
};

export async function getClinicDashboardCounts(
  clinicId: string,
  now: Date,
): Promise<DashboardCounts> {
  const [[staff], [pats], [sent], [soon], [ever]] = await Promise.all([
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          notDeleted(users.deletedAt),
          inArray(users.role, [...CLINIC_STAFF_ROLES]),
        ),
      ),
    db
      .select({ value: count() })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt))),
    db
      .select({ value: count() })
      .from(recalls)
      .where(
        byClinic(
          recalls.clinicId,
          clinicId,
          notDeleted(recalls.deletedAt),
          inArray(recalls.status, ["sent", "booked", "completed"]),
        ),
      ),
    db
      .select({ value: count() })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(
            inArray(appointments.status, ["scheduled", "confirmed"]),
            gte(appointments.scheduledAt, now),
          ),
        ),
      ),
    db
      .select({ value: count() })
      .from(appointments)
      .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt))),
  ]);

  return {
    staff: staff?.value ?? 0,
    patients: pats?.value ?? 0,
    recallsSent: sent?.value ?? 0,
    upcoming: soon?.value ?? 0,
    appointmentsEver: ever?.value ?? 0,
  };
}

/**
 * "Revenue Recovered": recalls that were SENT and were followed by a completed
 * appointment for that patient on or after the reminder went out.
 *
 * A correlated EXISTS — the analytics case where hand-written SQL on the same pool is
 * clearest (`core/db/index.ts` policy). `COALESCE(sent_at, due_at)` matters: a recall
 * marked sent without a timestamp would otherwise never match, quietly under-counting
 * the metric the product is sold on.
 */
export async function getRecoveredCount(clinicId: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(DISTINCT r.id)::int AS recovered
    FROM recalls r
    WHERE r.clinic_id = ${clinicId}
      AND r.deleted_at IS NULL
      AND r.status IN ('sent', 'booked', 'completed')
      AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_id = r.patient_id
          AND a.clinic_id = r.clinic_id
          AND a.deleted_at IS NULL
          AND a.status = 'completed'
          AND a.scheduled_at >= COALESCE(r.sent_at, r.due_at)
      )
  `);
  const rows = res.rows as { recovered?: number }[];
  return Number(rows[0]?.recovered ?? 0);
}

/** Recovered return VISITS per month for the last six months — the hero sparkline. */
export async function getRecoveredTrend(
  clinicId: string,
): Promise<{ m: string; n: number }[]> {
  const res = await db.execute(sql`
    SELECT to_char(date_trunc('month', a.scheduled_at), 'YYYY-MM') AS m, count(*)::int AS n
    FROM appointments a
    WHERE a.clinic_id = ${clinicId}
      AND a.deleted_at IS NULL
      AND a.status = 'completed'
      AND a.scheduled_at >= date_trunc('month', now()) - interval '5 months'
      AND EXISTS (
        SELECT 1 FROM recalls r
        WHERE r.patient_id = a.patient_id
          AND r.clinic_id = a.clinic_id
          AND r.deleted_at IS NULL
          AND r.status IN ('sent', 'booked', 'completed')
          AND a.scheduled_at >= COALESCE(r.sent_at, r.due_at)
      )
    GROUP BY m ORDER BY m
  `);
  return res.rows as { m: string; n: number }[];
}
