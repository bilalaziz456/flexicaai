import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import type { ResolvedRange } from "@/core/sales/report";

/**
 * No-show reporting — CORE, specialty-agnostic. A "no-show" is an appointment the
 * patient didn't turn up for (`status = 'no_show'`). The rate is measured against
 * appointments that were meant to happen — completed + no_show — so a proactively
 * CANCELLED appointment doesn't inflate or deflate it (shown separately as context).
 * Bucketed by `scheduled_at` in the range; clinic-scoped.
 */
export type NoShowDoctorRow = {
  doctorId: string | null;
  name: string;
  noShow: number;
  completed: number;
  attended: number; // completed + no_show (the rate denominator)
  rate: number; // 0..1
};

export type NoShowStats = {
  noShow: number;
  completed: number;
  cancelled: number;
  attended: number; // completed + no_show
  rate: number; // noShow / attended, 0 when attended === 0
  byDoctor: NoShowDoctorRow[];
};

const rateOf = (noShow: number, attended: number): number =>
  attended > 0 ? noShow / attended : 0;

export async function getNoShowStats(
  clinicId: string,
  range: ResolvedRange,
): Promise<NoShowStats> {
  // One grouped scan: per doctor, count each finished status in the window. Statuses
  // filtered to the three "the appointment time has passed" outcomes.
  const rows = await db
    .select({
      doctorId: appointments.doctorId,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      noShow: sql<number>`sum(case when ${appointments.status} = 'no_show' then 1 else 0 end)::int`,
      completed: sql<number>`sum(case when ${appointments.status} = 'completed' then 1 else 0 end)::int`,
      cancelled: sql<number>`sum(case when ${appointments.status} = 'cancelled' then 1 else 0 end)::int`,
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        and(
          inArray(appointments.status, ["completed", "no_show", "cancelled"]),
          gte(appointments.scheduledAt, range.start),
          lt(appointments.scheduledAt, range.end),
        ),
      ),
    )
    .groupBy(appointments.doctorId, users.fullName, users.username, users.prefix);

  let noShow = 0;
  let completed = 0;
  let cancelled = 0;
  const byDoctor: NoShowDoctorRow[] = rows.map((r) => {
    noShow += r.noShow;
    completed += r.completed;
    cancelled += r.cancelled;
    const attended = r.completed + r.noShow;
    const name =
      r.doctorName || r.doctorUsername
        ? `${r.doctorPrefix ? `${r.doctorPrefix}. ` : ""}${r.doctorName ?? r.doctorUsername}`
        : "Unassigned";
    return { doctorId: r.doctorId, name, noShow: r.noShow, completed: r.completed, attended, rate: rateOf(r.noShow, attended) };
  });
  // Only doctors with attended appointments matter for a no-show rate; sort worst first.
  const byDoctorRanked = byDoctor
    .filter((d) => d.attended > 0)
    .sort((a, b) => b.rate - a.rate || b.noShow - a.noShow);

  const attended = completed + noShow;
  return { noShow, completed, cancelled, attended, rate: rateOf(noShow, attended), byDoctor: byDoctorRanked };
}
